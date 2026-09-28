/* store.js — localStorage data layer. Single source of truth. */

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
      workouts: [],      // {id,date,type,name,durationMin,intensity,notes}
      meals: [],         // {id,date,name,calories,protein,carbs,fat}
      foodDatabase: [],  // {id,name,calories,protein,carbs,fat} — your own
                          // reusable food library, replaces an online search
      quests: [],        // {id,name,annoyance,type,done,date} (+ recurring fields)
      periodDays: [],     // {date, flow: 'light'|'medium'|'heavy'} — self-reported cycle log
      restDays: [],       // [ISO dates] — explicitly marked rest days
      exercises: [],       // {id,name,entries:[{id,date,text}]} — per-exercise progress log
      budgetCategories: [], // {id,name,monthlyLimit}
      expenses: []          // {id,categoryId,amount,date,note}
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
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('Save failed', e); }
    scheduleCloudPush();
  }

  // ---- workouts -------------------------------------------------------
  function addWorkout(w) {
    w.id = uid();
    state.workouts.push(w);
    save();
  }

  function deleteWorkout(id) {
    state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
    save();
  }

  function updateWorkout(id, patch) {
    var w = state.workouts.find(function (x) { return x.id === id; });
    if (!w) return;
    Object.assign(w, patch);
    save();
  }

  // ---- meals + food database --------------------------------------------
  // upserted by name (case-insensitive, trimmed) every time you log — the
  // database always reflects what you actually last ate for that food, and
  // a brand-new name is added automatically. This is the whole "search":
  // no network call, just a filter over this list.
  function upsertFoodDatabase(entry) {
    var name = (entry.name || '').trim();
    if (!name) return;
    var key = name.toLowerCase();
    var existing = state.foodDatabase.find(function (f) { return f.name.trim().toLowerCase() === key; });
    if (existing) {
      existing.name = name;
      existing.calories = entry.calories;
      existing.protein = entry.protein;
      existing.carbs = entry.carbs;
      existing.fat = entry.fat;
    } else {
      state.foodDatabase.push({
        id: uid(), name: name,
        calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat
      });
    }
  }

  function updateFoodDatabaseEntry(id, patch) {
    var f = state.foodDatabase.find(function (x) { return x.id === id; });
    if (!f) return;
    Object.assign(f, patch);
    if (patch.name != null) f.name = patch.name.trim();
    save();
  }

  function deleteFoodDatabaseEntry(id) {
    state.foodDatabase = state.foodDatabase.filter(function (f) { return f.id !== id; });
    save();
  }

  // one-time migration so upgrading doesn't start the database from zero —
  // seeds it from your existing meal history (most recent macros per name
  // wins, since state.meals is chronological).
  function ensureFoodDatabaseSeeded() {
    if (state.foodDatabaseSeeded) return;
    var byName = {};
    state.meals.forEach(function (m) {
      var name = (m.name || '').trim();
      if (!name) return;
      byName[name.toLowerCase()] = { name: name, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat };
    });
    Object.keys(byName).forEach(function (k) { upsertFoodDatabase(byName[k]); });
    state.foodDatabaseSeeded = true;
    save();
  }

  function addMeal(m) {
    m.id = uid();
    state.meals.push(m);
    upsertFoodDatabase(m);
    save();
  }

  function deleteMeal(id) {
    state.meals = state.meals.filter(function (m) { return m.id !== id; });
    save();
  }

  function updateMeal(id, patch) {
    var m = state.meals.find(function (x) { return x.id === id; });
    if (!m) return;
    Object.assign(m, patch);
    upsertFoodDatabase(m);
    save();
  }

  // ---- quests (custom task list) ---------------------------------------
  // annoyance may be null — that means "just a reminder".
  function addQuest(name, annoyance, type, deadline) {
    type = type === 'side' ? 'side' : 'health';
    state.quests.push({
      id: uid(), name: name, annoyance: annoyance ? Number(annoyance) : null, type: type,
      deadline: deadline || null, done: false, date: todayISO()
    });
    save();
  }

  function toggleQuest(id) {
    var q = state.quests.find(function (x) { return x.id === id; });
    if (!q) return false;
    q.done = !q.done;
    if (q.done) q.date = todayISO();
    save();
    return q.done;
  }

  function deleteQuest(id) {
    state.quests = state.quests.filter(function (q) { return q.id !== id; });
    save();
  }

  function updateQuest(id, patch) {
    var q = state.quests.find(function (x) { return x.id === id; });
    if (!q) return;
    Object.assign(q, patch);
    if (patch.annoyance !== undefined) q.annoyance = patch.annoyance ? Number(patch.annoyance) : null;
    save();
  }

  // ---- recurring quests (do X daily / N×/week for a set period) -------
  // frequency is either 'daily' or a number 2-6 (times per week).
  function addRecurringQuest(name, annoyance, type, frequency, endDate) {
    type = type === 'side' ? 'side' : 'health';
    state.quests.push({
      id: uid(), name: name, annoyance: annoyance ? Number(annoyance) : null, type: type,
      recurring: true, frequency: frequency, startDate: todayISO(), endDate: endDate,
      checkins: [], date: todayISO()
    });
    save();
  }

  function checkInQuest(id) {
    var q = state.quests.find(function (x) { return x.id === id && x.recurring; });
    if (!q) return false;
    var today = todayISO();
    if (q.checkins.indexOf(today) !== -1) return false; // already checked in today
    q.checkins.push(today);
    save();
    return true;
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

  // ---- exercise tracker (per-exercise progress log, e.g. "bicep curl: 25lbs
  // x10" or "5k in 28:00" — a running journal so you don't need a notes app.
  // One flat list, not scoped to a lineup slot — real exercises span
  // multiple slots (e.g. bicep curl shows up under both "upper body" and
  // "full body"), so per-slot buckets would just duplicate/fragment them.) --
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

  // ---- budget tracker (monthly limit per category, expenses logged
  // against it — same "target vs actual" shape as the nutrition targets) --
  function addBudgetCategory(name, monthlyLimit) {
    state.budgetCategories.push({ id: uid(), name: name, monthlyLimit: Number(monthlyLimit) || 0 });
    save();
  }
  function updateBudgetCategory(id, patch) {
    var c = state.budgetCategories.find(function (x) { return x.id === id; });
    if (!c) return;
    Object.assign(c, patch);
    if (patch.monthlyLimit !== undefined) c.monthlyLimit = Number(patch.monthlyLimit) || 0;
    save();
  }
  function deleteBudgetCategory(id) {
    state.budgetCategories = state.budgetCategories.filter(function (c) { return c.id !== id; });
    state.expenses = state.expenses.filter(function (e) { return e.categoryId !== id; });
    save();
  }
  function addExpense(categoryId, amount, date, note) {
    state.expenses.push({ id: uid(), categoryId: categoryId, amount: Number(amount) || 0, date: date || todayISO(), note: note || '' });
    save();
  }
  function deleteExpense(id) {
    state.expenses = state.expenses.filter(function (e) { return e.id !== id; });
    save();
  }
  function updateExpense(id, patch) {
    var e = state.expenses.find(function (x) { return x.id === id; });
    if (!e) return;
    Object.assign(e, patch);
    if (patch.amount !== undefined) e.amount = Number(patch.amount) || 0;
    save();
  }
  // spend per category for the given month (defaults to the current one)
  function monthStartISO(dateISO) {
    var d = new Date((dateISO || todayISO()) + 'T00:00:00');
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
  }
  function budgetSummary(monthISO) {
    var start = monthISO || monthStartISO();
    var end = new Date(start + 'T00:00:00');
    end.setMonth(end.getMonth() + 1);
    var endISO = end.toISOString().slice(0, 10);
    var spentByCategory = {};
    state.expenses.forEach(function (e) {
      if (e.date >= start && e.date < endISO) {
        spentByCategory[e.categoryId] = (spentByCategory[e.categoryId] || 0) + e.amount;
      }
    });
    return state.budgetCategories.map(function (c) {
      return { id: c.id, name: c.name, monthlyLimit: c.monthlyLimit, spent: spentByCategory[c.id] || 0 };
    });
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
    addWorkout: addWorkout,
    deleteWorkout: deleteWorkout,
    updateWorkout: updateWorkout,
    addMeal: addMeal,
    deleteMeal: deleteMeal,
    updateMeal: updateMeal,
    upsertFoodDatabase: upsertFoodDatabase,
    updateFoodDatabaseEntry: updateFoodDatabaseEntry,
    deleteFoodDatabaseEntry: deleteFoodDatabaseEntry,
    ensureFoodDatabaseSeeded: ensureFoodDatabaseSeeded,
    addQuest: addQuest,
    toggleQuest: toggleQuest,
    deleteQuest: deleteQuest,
    updateQuest: updateQuest,
    addRecurringQuest: addRecurringQuest,
    checkInQuest: checkInQuest,
    questStreak: questStreak,
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
    togglePeriodDay: togglePeriodDay,
    logPeriodRange: logPeriodRange,
    deletePeriodRange: deletePeriodRange,
    isPeriodDay: isPeriodDay,
    cyclesSummary: cyclesSummary,
    addBudgetCategory: addBudgetCategory,
    updateBudgetCategory: updateBudgetCategory,
    deleteBudgetCategory: deleteBudgetCategory,
    addExpense: addExpense,
    deleteExpense: deleteExpense,
    updateExpense: updateExpense,
    budgetSummary: budgetSummary
  };
})();
