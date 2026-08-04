/* store.js — localStorage data layer.
   Single source of truth. Points total is always derived from pointsLog,
   so it can never drift out of sync with what earned/spent it. */

var Store = (function () {
  var KEY = 'era:v1';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    var d = new Date();
    var off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function defaultRewards() {
    return rewardPackV2().map(function (r) {
      return { id: uid(), name: r.name, cost: r.cost, redeemed: false };
    });
  }

  // the fuller reward lineup — small treats through big treats, no food.
  function rewardPackV2() {
    return [
      { name: 'New nail set 💅', cost: 800 },
      { name: 'Cute journal or planner 📓', cost: 1200 },
      { name: 'Bath bomb & skincare treat 🛁', cost: 1500 },
      { name: 'Get a blow out 💇‍♀️', cost: 4000 },
      { name: 'Piece of jewelry ✨', cost: 6000 },
      { name: 'New going-out fit 👗', cost: 6000 },
      { name: 'Get a massage 💆‍♀️', cost: 8000 },
      { name: 'Concert or event ticket 🎫', cost: 10000 },
      { name: 'Buy a dress over $100 👗', cost: 15000 },
      { name: 'Weekend trip 🧳', cost: 25000 }
    ];
  }

  // one-time top-up so existing accounts get the expanded reward lineup too
  // (defaultRewards() above only seeds brand-new state).
  function ensureRewardPack() {
    if (state.rewardPackV2) return;
    var have = {};
    state.rewards.forEach(function (r) { have[(r.name || '').trim().toLowerCase()] = true; });
    rewardPackV2().forEach(function (r) {
      var k = r.name.trim().toLowerCase();
      if (!have[k]) state.rewards.push({ id: uid(), name: r.name, cost: r.cost, redeemed: false });
    });
    state.rewardPackV2 = true;
    save();
  }

  function fresh() {
    return {
      profile: {
        name: '',
        sex: 'female',
        age: null,
        heightCm: null,
        weightKg: null,
        activity: 'moderate',
        goal: 'lose',
        units: 'imperial'
      },
      workouts: [],   // {id,date,type,name,durationMin,intensity,calories,notes}
      meals: [],      // {id,date,name,calories,protein,carbs,fat}
      quests: [],     // {id,name,annoyance,points,done,date}
      rewards: defaultRewards(),
      redemptions: [],// {id,rewardId,name,cost,date}
      pointsLog: [],  // {id,date,delta,reason,key}
      vibes: [],      // {date, level: 1-5} — one per day, no correlation to food/exercise
      periodDays: [], // {date, flow: 'light'|'medium'|'heavy'} — self-reported cycle log
      restDays: [],   // [ISO dates] — explicitly marked rest days
      exercises: []   // {id,slotId,name,entries:[{id,date,text}]} — per-exercise progress log
      // no rewardPackV2 flag here on purpose — ensureRewardPack() sets it
      // after actually seeding, and it's idempotent either way.
    };
  }

  var state = load();

  // cloud sync bookkeeping (no-ops until a user is set via setCloudUser)
  var cloudUserId = null;
  var pushTimer = null;
  var suppressPush = false;

  function setCloudUser(id) { cloudUserId = id || null; }

  function scheduleCloudPush() {
    if (suppressPush || !cloudUserId) return;
    if (!window.Cloud || !Cloud.enabled()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      Cloud.push(cloudUserId, state).catch(function (e) {
        console.warn('Cloud push failed (will retry on next change)', e);
      });
    }, 800);
  }

  // push immediately (used for first upload right after sign-in)
  function pushNow() {
    if (!cloudUserId || !window.Cloud || !Cloud.enabled()) return Promise.resolve(false);
    return Cloud.push(cloudUserId, state);
  }

  // overwrite in-memory + local state from a cloud pull, without echoing back
  function replaceState(newState) {
    suppressPush = true;
    state = Object.assign(fresh(), newState || {});
    if (!state.profile) state.profile = fresh().profile;
    save();
    suppressPush = false;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      var parsed = JSON.parse(raw);
      var base = fresh();
      // shallow-merge so new fields survive upgrades
      for (var k in base) if (!(k in parsed)) parsed[k] = base[k];
      if (!parsed.profile) parsed.profile = base.profile;
      return parsed;
    } catch (e) {
      console.warn('Could not read saved data, starting fresh.', e);
      return fresh();
    }
  }

  function save() {
    reconcileDailyBonuses();
    reconcileQuestStreaks();
    reconcileVibeStreaks();
    // logging a meal (or a single day's vibe check-in) isn't worth points
    // itself anymore — strips any old flat per-log points still sitting in
    // history so past changes to the rules don't leave stale point balances.
    state.pointsLog = state.pointsLog.filter(function (e) { return !(e.key && e.key.indexOf('meal:') === 0); });
    state.pointsLog = state.pointsLog.filter(function (e) { return !(e.key && e.key.indexOf('vibe:') === 0); });
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('Save failed', e); }
    scheduleCloudPush();
  }

  // ---- points ---------------------------------------------------------
  function pointsTotal() {
    return state.pointsLog.reduce(function (s, e) { return s + e.delta; }, 0);
  }

  function addPoints(delta, reason, key, date) {
    state.pointsLog.push({ id: uid(), date: date || todayISO(), delta: delta, reason: reason, key: key || null });
  }

  function removePointsByKey(key) {
    state.pointsLog = state.pointsLog.filter(function (e) { return e.key !== key; });
  }

  // Recompute the two auto daily bonuses from scratch every save so they can
  // never double-count and always reflect the current logs.
  function reconcileDailyBonuses() {
    state.pointsLog = state.pointsLog.filter(function (e) {
      return !(e.key && e.key.indexOf('bonus:') === 0);
    });
    var t = Formulas.targets(state.profile);
    if (!t) return;

    var byDay = {};
    state.meals.forEach(function (m) {
      var d = byDay[m.date] || (byDay[m.date] = { cal: 0, protein: 0, count: 0 });
      d.cal += Number(m.calories) || 0;
      d.protein += Number(m.protein) || 0;
      d.count += 1;
    });

    Object.keys(byDay).forEach(function (date) {
      var d = byDay[date];
      if (d.count === 0) return;
      if (d.protein >= t.protein * 0.9) {
        addPoints(Formulas.DAILY_PROTEIN_BONUS, 'Hit protein goal', 'bonus:protein:' + date, date);
      }
      // landed in a healthy band AROUND the target — rewards hitting the goal,
      // NOT under-eating (the lower bound requires eating enough).
      if (d.cal >= t.calories * 0.9 && d.cal <= t.calories * 1.1) {
        addPoints(Formulas.DAILY_CALORIE_BONUS, 'Hit your calorie target', 'bonus:calorie:' + date, date);
      }
    });
  }

  // ---- workouts -------------------------------------------------------
  function addWorkout(w) {
    w.id = uid();
    state.workouts.push(w);
    var pts = Formulas.workoutPoints(w.durationMin);
    addPoints(pts, 'Workout: ' + (w.name || w.type), 'workout:' + w.id);
    save();
    return pts;
  }

  function deleteWorkout(id) {
    state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
    removePointsByKey('workout:' + id);
    save();
  }

  function updateWorkout(id, patch) {
    var w = state.workouts.find(function (x) { return x.id === id; });
    if (!w) return 0;
    Object.assign(w, patch);
    removePointsByKey('workout:' + id);
    var pts = Formulas.workoutPoints(w.durationMin);
    addPoints(pts, 'Workout: ' + (w.name || w.type), 'workout:' + id);
    save();
    return pts;
  }

  // ---- meals ------------------------------------------------------------
  // logging a meal isn't worth points itself — only hitting the calorie/
  // protein target band is (see reconcileDailyBonuses).
  function addMeal(m) {
    m.id = uid();
    state.meals.push(m);
    save();
    return 0;
  }

  function deleteMeal(id) {
    state.meals = state.meals.filter(function (m) { return m.id !== id; });
    removePointsByKey('meal:' + id);
    save();
  }

  function updateMeal(id, patch) {
    var m = state.meals.find(function (x) { return x.id === id; });
    if (!m) return;
    Object.assign(m, patch);
    save(); // meal points are flat — no recompute needed
  }

  // ---- quests (custom wellness goals) ---------------------------------
  // annoyance may be null — that means "just a reminder", worth 0 points.
  function addQuest(name, annoyance, type, deadline) {
    type = type === 'side' ? 'side' : 'health';
    var pts = annoyance ? Formulas.questPoints(annoyance, type) : 0;
    state.quests.push({
      id: uid(), name: name, annoyance: annoyance ? Number(annoyance) : null, type: type,
      deadline: deadline || null, points: pts, done: false, date: todayISO()
    });
    save();
    return pts;
  }

  // completing a quest claims its points (reminders have none); toggling back removes them
  function toggleQuest(id) {
    var q = state.quests.find(function (x) { return x.id === id; });
    if (!q) return false;
    q.done = !q.done;
    if (q.done) { q.date = todayISO(); if (q.points > 0) addPoints(q.points, 'Quest: ' + q.name, 'quest:' + q.id); }
    else { removePointsByKey('quest:' + q.id); }
    save();
    return q.done;
  }

  function deleteQuest(id) {
    state.quests = state.quests.filter(function (q) { return q.id !== id; });
    removePointsByKey('quest:' + id);
    state.pointsLog = state.pointsLog.filter(function (e) {
      return !(e.key && (e.key.indexOf('questcheckin:' + id + ':') === 0 || e.key.indexOf('queststreak:' + id + ':') === 0));
    });
    save();
  }

  // edits a quest's name/type/annoyance/deadline (or frequency/endDate for
  // recurring ones), recomputing its point value. Streak bonuses re-derive
  // themselves on the next save() since they're always computed from scratch.
  function updateQuest(id, patch) {
    var q = state.quests.find(function (x) { return x.id === id; });
    if (!q) return;
    Object.assign(q, patch);
    if (patch.annoyance !== undefined) q.annoyance = patch.annoyance ? Number(patch.annoyance) : null;
    var newPts = q.annoyance ? Formulas.questPoints(q.annoyance, q.type) : 0;
    if (!q.recurring && q.done && newPts !== q.points) {
      removePointsByKey('quest:' + id);
      if (newPts > 0) addPoints(newPts, 'Quest: ' + q.name, 'quest:' + id);
    }
    q.points = newPts;
    save();
  }

  // ---- recurring quests (do X daily / N×/week for a set period) -------
  // frequency is either 'daily' or a number 2-6 (times per week).
  function addRecurringQuest(name, annoyance, type, frequency, endDate) {
    type = type === 'side' ? 'side' : 'health';
    var pts = annoyance ? Formulas.questPoints(annoyance, type) : 0; // sizes the streak bonus
    state.quests.push({
      id: uid(), name: name, annoyance: annoyance ? Number(annoyance) : null, type: type, points: pts,
      recurring: true, frequency: frequency, startDate: todayISO(), endDate: endDate,
      checkins: [], date: todayISO()
    });
    save();
  }

  function checkInQuest(id) {
    var q = state.quests.find(function (x) { return x.id === id && x.recurring; });
    if (!q) return 0;
    var today = todayISO();
    if (q.checkins.indexOf(today) !== -1) return 0; // already checked in today
    q.checkins.push(today);
    var pts = q.annoyance ? Formulas.microPoints(q.annoyance, q.type) : 0;
    if (pts > 0) addPoints(pts, 'Check-in: ' + q.name, 'questcheckin:' + id + ':' + today);
    save();
    return pts;
  }

  // consecutive-completion streak: days (for 'daily') or weeks (for N×/week)
  function questStreak(q) {
    if (q.frequency === 'daily') {
      var days = {};
      q.checkins.forEach(function (d) { days[d] = true; });
      var streak = 0;
      var d = new Date(todayISO() + 'T00:00:00');
      while (days[d.toISOString().slice(0, 10)]) { streak++; d.setDate(d.getDate() - 1); }
      return streak;
    }
    var target = Number(q.frequency) || 1;
    var perWeek = {};
    q.checkins.forEach(function (dt) {
      var wk = weekStartISO(dt);
      perWeek[wk] = (perWeek[wk] || 0) + 1;
    });
    var streak = 0;
    var cursor = weekStartISO();
    while ((perWeek[cursor] || 0) >= target) {
      streak++;
      var back = new Date(cursor + 'T00:00:00');
      back.setDate(back.getDate() - 7);
      cursor = back.toISOString().slice(0, 10);
    }
    return streak;
  }

  // recomputes streak-milestone bonuses from scratch every save, same
  // no-drift pattern as the daily calorie/protein bonuses below.
  function reconcileQuestStreaks() {
    state.pointsLog = state.pointsLog.filter(function (e) {
      return !(e.key && e.key.indexOf('queststreak:') === 0);
    });
    state.quests.forEach(function (q) {
      if (!q.recurring || !q.annoyance) return; // reminders (no annoyance) earn no bonus
      var bonus = Formulas.questPoints(q.annoyance, q.type);
      var streak = questStreak(q);
      var milestones = q.frequency === 'daily' ? Math.floor(streak / 7) : streak;
      for (var i = 1; i <= milestones; i++) {
        addPoints(bonus, q.name + ' — streak bonus', 'queststreak:' + q.id + ':' + i);
      }
    });
  }

  // ---- rewards --------------------------------------------------------
  function addReward(name, cost) {
    state.rewards.push({ id: uid(), name: name, cost: Number(cost) || 0, redeemed: false });
    save();
  }

  function deleteReward(id) {
    state.rewards = state.rewards.filter(function (r) { return r.id !== id; });
    save();
  }

  function updateReward(id, patch) {
    var r = state.rewards.find(function (x) { return x.id === id; });
    if (!r) return;
    Object.assign(r, patch);
    if (patch.cost !== undefined) r.cost = Number(patch.cost) || 0;
    save();
  }

  function redeemReward(id) {
    var r = state.rewards.find(function (x) { return x.id === id; });
    if (!r) return { ok: false, msg: 'Reward not found.' };
    if (pointsTotal() < r.cost) return { ok: false, msg: 'not enough points yet bestie 🥲' };
    var redemption = { id: uid(), rewardId: r.id, name: r.name, cost: r.cost, date: todayISO() };
    state.redemptions.push(redemption);
    addPoints(-r.cost, 'Redeemed: ' + r.name, 'redeem:' + redemption.id);
    save();
    return { ok: true, msg: 'treat unlocked — go get it, you earned this 💅✨' };
  }

  // ---- exercise tracker (per-exercise progress log, e.g. "bicep curl: 25lbs
  // x10" or "5k in 28:00" — a running journal so you don't need a notes app.
  // One flat list, not scoped to a lineup slot — real exercises span
  // multiple slots (e.g. bicep curl shows up under both "upper body" and
  // "full body"), so per-slot buckets would just duplicate/fragment them.
  // Not point-earning, purely a reference log.) --------------------------
  function addExercise(name) {
    var ex = { id: uid(), name: name, entries: [] };
    state.exercises.push(ex);
    save();
    return ex.id;
  }

  function deleteExercise(id) {
    state.exercises = state.exercises.filter(function (x) { return x.id !== id; });
    save();
  }

  function updateExercise(id, patch) {
    var ex = state.exercises.find(function (x) { return x.id === id; });
    if (!ex) return;
    Object.assign(ex, patch);
    save();
  }

  function logExerciseEntry(exerciseId, text) {
    var ex = state.exercises.find(function (x) { return x.id === exerciseId; });
    if (!ex) return;
    ex.entries.push({ id: uid(), date: todayISO(), text: text });
    save();
  }

  function deleteExerciseEntry(exerciseId, entryId) {
    var ex = state.exercises.find(function (x) { return x.id === exerciseId; });
    if (!ex) return;
    ex.entries = ex.entries.filter(function (e) { return e.id !== entryId; });
    save();
  }

  // ---- vibe check (mood, one tap/day — never cross-referenced with food) ----
  // logging a single day's vibe isn't worth points itself — only keeping a
  // 7-day check-in streak going is (see vibeStreak/reconcileVibeStreaks).
  function logVibe(level) {
    var today = todayISO();
    var existing = state.vibes.find(function (v) { return v.date === today; });
    if (existing) { existing.level = Number(level); save(); return 0; }
    state.vibes.push({ date: today, level: Number(level) });
    save();
    var streak = vibeStreak();
    return (streak > 0 && streak % 7 === 0) ? Formulas.VIBE_STREAK_BONUS : 0;
  }

  // Streak bonuses only launched on this date — check-ins from before then
  // don't retroactively count, so switching to streak-based rewards can't
  // hand out a windfall for a "streak" that only exists in hindsight.
  var VIBE_STREAK_LAUNCH_DATE = '2026-08-03';

  // consecutive-day vibe check-in streak, ending today (never counts further
  // back than VIBE_STREAK_LAUNCH_DATE)
  function vibeStreak() {
    var days = {};
    state.vibes.forEach(function (v) { days[v.date] = true; });
    var streak = 0;
    var d = new Date(todayISO() + 'T00:00:00');
    while (d.toISOString().slice(0, 10) >= VIBE_STREAK_LAUNCH_DATE && days[d.toISOString().slice(0, 10)]) {
      streak++; d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  // recomputes streak-milestone bonuses from scratch every save, same
  // no-drift pattern as reconcileQuestStreaks/reconcileDailyBonuses.
  function reconcileVibeStreaks() {
    state.pointsLog = state.pointsLog.filter(function (e) {
      return !(e.key && e.key.indexOf('vibestreak:') === 0);
    });
    var milestones = Math.floor(vibeStreak() / 7);
    for (var i = 1; i <= milestones; i++) {
      addPoints(Formulas.VIBE_STREAK_BONUS, 'Vibe check-in — 7 day streak', 'vibestreak:' + i);
    }
  }
  function vibeToday() {
    var today = todayISO();
    var v = state.vibes.find(function (x) { return x.date === today; });
    return v ? v.level : null;
  }
  // average vibe by weekday (Mon=0..Sun=6), for the insights chart
  function vibeByWeekday() {
    var buckets = [[], [], [], [], [], [], []];
    state.vibes.forEach(function (v) {
      var d = new Date(v.date + 'T00:00:00');
      var day = d.getDay();
      buckets[day === 0 ? 6 : day - 1].push(v.level);
    });
    return buckets.map(function (arr) {
      if (!arr.length) return null;
      return Math.round((arr.reduce(function (s, x) { return s + x; }, 0) / arr.length) * 10) / 10;
    });
  }

  // ---- cycle tracking (self-reported period days; never tied to weight/calories) ----
  function togglePeriodDay(dateISO, flow) {
    var i = state.periodDays.findIndex(function (p) { return p.date === dateISO; });
    if (i !== -1) { state.periodDays.splice(i, 1); }
    else { state.periodDays.push({ date: dateISO, flow: flow || 'medium' }); }
    state.periodDays.sort(function (a, b) { return a.date.localeCompare(b.date); });
    save();
  }
  function isPeriodDay(dateISO) {
    return state.periodDays.some(function (p) { return p.date === dateISO; });
  }
  // logs a past period in one go: start date + how many days it lasted.
  function logPeriodRange(startISO, lengthDays, flow) {
    var d = new Date(startISO + 'T00:00:00');
    for (var i = 0; i < lengthDays; i++) {
      var iso = d.toISOString().slice(0, 10);
      if (!isPeriodDay(iso)) state.periodDays.push({ date: iso, flow: flow || 'medium' });
      d.setDate(d.getDate() + 1);
    }
    state.periodDays.sort(function (a, b) { return a.date.localeCompare(b.date); });
    save();
  }
  // removes every period day in [startISO, endISO] — used to delete/redo a logged period
  function deletePeriodRange(startISO, endISO) {
    state.periodDays = state.periodDays.filter(function (p) { return !(p.date >= startISO && p.date <= endISO); });
    save();
  }
  // groups period days into contiguous periods (gap <=2 days = same period),
  // and derives cycle lengths (days between period start dates).
  function cyclesSummary() {
    var days = state.periodDays.map(function (p) { return p.date; }).sort();
    var runs = [];
    days.forEach(function (d) {
      var last = runs[runs.length - 1];
      if (last) {
        var gap = Math.round((new Date(d + 'T00:00:00') - new Date(last[last.length - 1] + 'T00:00:00')) / 86400000);
        if (gap <= 2) { last.push(d); return; }
      }
      runs.push([d]);
    });
    var periods = runs.map(function (r) { return { start: r[0], end: r[r.length - 1], length: r.length }; });
    var cycleLengths = [];
    for (var i = 1; i < periods.length; i++) {
      cycleLengths.push(Math.round((new Date(periods[i].start + 'T00:00:00') - new Date(periods[i - 1].start + 'T00:00:00')) / 86400000));
    }
    var avgCycleLength = cycleLengths.length
      ? Math.round(cycleLengths.reduce(function (s, x) { return s + x; }, 0) / cycleLengths.length)
      : null;
    var nextPredicted = null;
    if (avgCycleLength && periods.length) {
      var lastStart = new Date(periods[periods.length - 1].start + 'T00:00:00');
      lastStart.setDate(lastStart.getDate() + avgCycleLength);
      nextPredicted = lastStart.toISOString().slice(0, 10);
    }
    return { periods: periods.reverse(), cycleLengths: cycleLengths, avgCycleLength: avgCycleLength, nextPredicted: nextPredicted };
  }

  // ---- profile --------------------------------------------------------
  function setProfile(p) {
    state.profile = Object.assign({}, state.profile, p);
    save();
  }

  // ---- import / export -----------------------------------------------
  function exportJSON() { return JSON.stringify(state, null, 2); }

  function importJSON(text) {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid file');
    state = Object.assign(fresh(), parsed);
    save();
  }

  function resetAll() { state = fresh(); save(); }

  // helpers for views
  function mealsOn(date) { return state.meals.filter(function (m) { return m.date === date; }); }
  function workoutsOn(date) { return state.workouts.filter(function (w) { return w.date === date; }); }

  // ---- weekly helpers (Mon-start week containing the given/today's date) ----
  function weekStartISO(dateISO) {
    var d = new Date((dateISO || todayISO()) + 'T00:00:00');
    var day = d.getDay(); // 0=Sun..6=Sat
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().slice(0, 10);
  }
  function workoutsThisWeek() {
    var start = weekStartISO();
    return state.workouts.filter(function (w) { return w.date >= start; });
  }
  // rest day is an explicit, reversible mark — not inferred from missing
  // logs, so it's a real toggle like every other lineup slot.
  function toggleRestDay(dateISO) {
    var i = state.restDays.indexOf(dateISO);
    if (i !== -1) state.restDays.splice(i, 1);
    else state.restDays.push(dateISO);
    save();
  }
  function isRestDay(dateISO) { return state.restDays.indexOf(dateISO) !== -1; }
  function restDaysTakenThisWeek() {
    var start = weekStartISO();
    return state.restDays.filter(function (d) { return d >= start; }).length;
  }

  return {
    get state() { return state; },
    uid: uid,
    todayISO: todayISO,
    save: save,
    setCloudUser: setCloudUser,
    pushNow: pushNow,
    replaceState: replaceState,
    pointsTotal: pointsTotal,
    addWorkout: addWorkout,
    deleteWorkout: deleteWorkout,
    updateWorkout: updateWorkout,
    addMeal: addMeal,
    deleteMeal: deleteMeal,
    updateMeal: updateMeal,
    addQuest: addQuest,
    toggleQuest: toggleQuest,
    deleteQuest: deleteQuest,
    updateQuest: updateQuest,
    addRecurringQuest: addRecurringQuest,
    checkInQuest: checkInQuest,
    questStreak: questStreak,
    addReward: addReward,
    deleteReward: deleteReward,
    updateReward: updateReward,
    redeemReward: redeemReward,
    ensureRewardPack: ensureRewardPack,
    setProfile: setProfile,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetAll: resetAll,
    mealsOn: mealsOn,
    workoutsOn: workoutsOn,
    workoutsThisWeek: workoutsThisWeek,
    restDaysTakenThisWeek: restDaysTakenThisWeek,
    toggleRestDay: toggleRestDay,
    isRestDay: isRestDay,
    addExercise: addExercise,
    deleteExercise: deleteExercise,
    updateExercise: updateExercise,
    logExerciseEntry: logExerciseEntry,
    deleteExerciseEntry: deleteExerciseEntry,
    logVibe: logVibe,
    vibeToday: vibeToday,
    vibeStreak: vibeStreak,
    vibeByWeekday: vibeByWeekday,
    togglePeriodDay: togglePeriodDay,
    logPeriodRange: logPeriodRange,
    deletePeriodRange: deletePeriodRange,
    isPeriodDay: isPeriodDay,
    cyclesSummary: cyclesSummary
  };
})();
