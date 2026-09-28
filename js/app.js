/* app.js — UI rendering, navigation, and event wiring. Vanilla DOM. */

(function () {
  var viewEl = document.getElementById('view');
  var tabbar = document.getElementById('tabbar');
  var toastEl = document.getElementById('toast');
  var current = 'fitness';
  var LAST_VIEW_KEY = 'era:lastView';

  // ---- tiny helpers ---------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }
  // truly random (not seeded) so repeat logs in one sitting still feel varied
  function pickRandom(variants) {
    return variants[Math.floor(Math.random() * variants.length)];
  }
  var FOOD_LOGGED_MSGS = ['fed & thriving 😌', 'slay, that\'s logged 💅', 'nutrition: handled ✨', 'logged it, no cap'];
  var WORKOUT_LOGGED_MSGS = ['logged it, that girl behavior 💪', 'workout slayed 💪', 'that\'s a W, logged 🔥', 'movement secured 💪'];
  var QUEST_DONE_MSGS = ['handled it 💅', 'slay, quest complete 💅', 'that\'s done, iconic ✨', 'checked off, let\'s go 🔥'];
  var QUEST_DONE_FREE_MSGS = ['done ✓', 'handled ✨', 'slay, done ✓'];
  var CHECKIN_MSGS = ['checked in ✨', 'slay, checked in ✨', 'showed up, logged ✨'];
  var NUM_LOGGED_MSGS = ['logged ✨', 'slay, numbers updated 💪', 'pr energy, logged ✨'];
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  // ---- in-progress form drafts (survives the PWA getting backgrounded and
  // reloaded mid-entry) — local-only, never synced, cleared on submit or
  // on an explicit close so it doesn't linger once you're done with it. ----
  var FORM_DRAFT_KEY = 'era:formDraft';
  function saveFormDraft(kind, data) {
    try {
      var all = JSON.parse(localStorage.getItem(FORM_DRAFT_KEY) || '{}');
      all[kind] = data;
      localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(all));
    } catch (e) { /* ignore — drafts are a nice-to-have */ }
  }
  function loadFormDraft(kind) {
    try {
      var all = JSON.parse(localStorage.getItem(FORM_DRAFT_KEY) || '{}');
      return all[kind] || null;
    } catch (e) { return null; }
  }
  function clearFormDraft(kind) {
    try {
      var all = JSON.parse(localStorage.getItem(FORM_DRAFT_KEY) || '{}');
      delete all[kind];
      localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  // unit conversions (internal storage is always metric: cm + kg)
  function cmToFtIn(cm) {
    var ti = cm / 2.54, ft = Math.floor(ti / 12), inch = Math.round(ti - ft * 12);
    if (inch === 12) { ft += 1; inch = 0; }
    return { ft: ft, inch: inch };
  }
  function ftInToCm(ft, inch) { return (num(ft) * 12 + num(inch)) * 2.54; }
  function kgToLbs(kg) { return Math.round(kg / 0.453592); }
  function lbsToKg(lbs) { return num(lbs) * 0.453592; }
  function sum(arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); }
  function prettyDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ---- routing --------------------------------------------------------
  // persists the current view locally — purely a this-device UI convenience,
  // not synced — so reopening the app (or the OS reloading the PWA after
  // backgrounding) resumes where you left off instead of always dropping
  // back to home.
  function setView(name) {
    current = name;
    [].forEach.call(tabbar.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });
    try { localStorage.setItem(LAST_VIEW_KEY, name); }
    catch (e) { /* ignore — resume is a nice-to-have, not critical */ }
    render();
  }

  function restoreLastView() {
    try {
      var name = localStorage.getItem(LAST_VIEW_KEY);
      if (name && views[name]) return name;
    } catch (e) { /* ignore */ }
    return null;
  }

  function render() {
    var fn = views[current] || views.fitness;
    viewEl.innerHTML = '';
    viewEl.appendChild(fn());
    viewEl.scrollTop = 0;
  }

  var views = {};

  // ==== HOME (tracker + plan + log, all in one) =======================
  function calorieVibe(eaten, target) {
    if (!target) return '';
    if (eaten <= 0) return 'nothing logged yet — let’s fuel up ✨';
    var pct = eaten / target;
    if (pct < 0.5) return 'good start, keep fueling up 🍽️';
    if (pct < 0.9) return 'getting there, halfway to iconic 👀';
    if (pct <= 1.1) return 'target: secured 🎯 certified iconic behavior';
    return 'logged & moving on, no notes 💅';
  }

  var WORKOUT_TYPES = [
    'Strength (Full-body)', 'Strength (Upper+Core)', 'Strength (Lower-body)',
    'F45 – Resistance', 'F45 – Cardio', 'Running/Spin', 'Cardio', 'HIIT',
    'Yoga/Mobility', 'Sport', 'Walk', 'Other'
  ];
  // editing state for the fitness-tab log forms — reset at the top of every
  // views.fitness() call so it never leaks across a full re-render.
  var editingWorkoutId = null;
  var editingMealId = null;

  function workoutFormHTML(presetType) {
    var opts = WORKOUT_TYPES.map(function (t) {
      return '<option' + (t === presetType ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
    return '<h3 style="margin-top:2px">add a workout</h3>' +
      '<form id="wForm" class="form-grid">' +
      '<label class="wide">date<span class="date-wrap"><input name="date" type="date" value="' + Store.todayISO() + '" max="' + Store.todayISO() + '" required></span></label>' +
      '<label>name<input name="name" placeholder="e.g. morning run" required></label>' +
      '<label>type<select name="type">' + opts + '</select></label>' +
      '<label>duration (min)<input name="durationMin" type="number" min="1" value="30" required></label>' +
      '<label>intensity<select name="intensity">' +
        '<option value="low">Low</option><option value="moderate" selected>Moderate</option><option value="high">High</option>' +
      '</select></label>' +
      '<label class="wide">notes<input name="notes" placeholder="optional"></label>' +
      '<button class="btn primary wide" type="submit">log workout</button>' +
      '</form>';
  }

  function foodFormHTML() {
    // The search box IS the "what did you eat?" field — form="mForm" links
    // this input (which sits outside the <form> for layout reasons) into
    // the form's own fields, so there's no separate/duplicate name box.
    // Picking a result fills it in; typing your own text works exactly
    // the same as manual entry always did. No portion/grams field anymore —
    // your own database stores the exact macros you logged last time, not
    // a per-100g value that needs scaling.
    return '<h3 style="margin-top:2px">add food</h3>' +
      '<div id="recentWrap"></div>' +
      '<div class="search-row">' +
        '<input name="name" form="mForm" id="foodSearch" placeholder="e.g. chicken & rice bowl" autocomplete="off" required>' +
      '</div>' +
      '<div class="search-hint">start typing to pull from your own food list — anything new saves automatically. 📋</div>' +
      '<ul class="results" id="results"></ul>' +
      '<form id="mForm" class="form-grid">' +
      '<label class="wide">date<span class="date-wrap"><input name="date" type="date" value="' + Store.todayISO() + '" max="' + Store.todayISO() + '" required></span></label>' +
      '<label>calories<input name="calories" type="number" min="0" required></label>' +
      '<label>protein (g)<input name="protein" type="number" min="0" placeholder="0"></label>' +
      '<label>carbs (g)<input name="carbs" type="number" min="0" placeholder="0"></label>' +
      '<label>fat (g)<input name="fat" type="number" min="0" placeholder="0"></label>' +
      '<button class="btn primary wide" type="submit">log food</button>' +
      '</form>';
  }

  // wires the food-search + recent-chips + submit behavior for a food form
  // that's already in the DOM (possibly hidden) inside `card`.
  function wireFoodForm(card, onDone) {
    var resultsEl = card.querySelector('#results');
    var searchInput = card.querySelector('#foodSearch');
    var mForm = card.querySelector('#mForm');

    function fillFromEntry(f) {
      mForm.name.value = f.name;
      mForm.calories.value = num(f.calories) || '';
      mForm.protein.value = num(f.protein) || 0;
      mForm.carbs.value = num(f.carbs) || 0;
      mForm.fat.value = num(f.fat) || 0;
      resultsEl.innerHTML = '';
    }
    (function renderRecent() {
      var seen = {}, recents = [];
      Store.state.meals.slice().reverse().forEach(function (m) {
        var k = (m.name || '').trim().toLowerCase();
        if (!k || seen[k]) return; seen[k] = true; recents.push(m);
      });
      recents = recents.slice(0, 8);
      var wrapR = card.querySelector('#recentWrap');
      if (!recents.length) { wrapR.innerHTML = ''; return; }
      wrapR.innerHTML = '<div class="recent-label">recent — tap to re-add ⚡</div>';
      var row = el('<div class="recent-chips"></div>');
      recents.forEach(function (m) {
        var chip = el('<button type="button" class="chip">' + esc(m.name) +
          ' <span class="chip-cal">' + num(m.calories) + '</span></button>');
        chip.addEventListener('click', function () { fillFromEntry(m); });
        row.appendChild(chip);
      });
      wrapR.appendChild(row);
    })();

    // pure local filter over your own food database — no network, instant.
    function runSearch() {
      var q = searchInput.value.trim().toLowerCase();
      if (!q) { resultsEl.innerHTML = ''; return; }
      var matches = Store.state.foodDatabase.filter(function (f) {
        return f.name.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      if (!matches.length) {
        resultsEl.innerHTML = '<li class="searching">nothing in your food list yet — fill in macros below and it’ll save for next time. 👇</li>';
        return;
      }
      resultsEl.innerHTML = '';
      matches.forEach(function (f) {
        var li = el('<li><span><span class="result-name">' + esc(f.name) + '</span></span>' +
          '<span class="result-macros">' + num(f.calories) + ' kcal · ' + num(f.protein) + 'g P</span></li>');
        li.addEventListener('click', function () { fillFromEntry(f); });
        resultsEl.appendChild(li);
      });
    }
    searchInput.addEventListener('input', runSearch);

    mForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var data = {
        name: f.name.value.trim(),
        calories: num(f.calories.value),
        protein: num(f.protein.value),
        carbs: num(f.carbs.value),
        fat: num(f.fat.value),
        date: f.date.value || Store.todayISO()
      };
      if (editingMealId) {
        Store.updateMeal(editingMealId, data);
        toast('food updated ✓');
        editingMealId = null;
      } else {
        Store.addMeal(data);
        toast(data.date === Store.todayISO() ? pickRandom(FOOD_LOGGED_MSGS) : 'backfilled ✨ streaks updated');
      }
      onDone();
    });
  }

  function wireWorkoutForm(card, onDone) {
    card.querySelector('#wForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var data = {
        name: f.name.value.trim(),
        type: f.type.value,
        durationMin: num(f.durationMin.value),
        intensity: f.intensity.value,
        notes: f.notes.value.trim(),
        date: f.date.value || Store.todayISO()
      };
      if (editingWorkoutId) {
        Store.updateWorkout(editingWorkoutId, data);
        toast('workout updated ✓');
        editingWorkoutId = null;
      } else {
        Store.addWorkout(data);
        toast(data.date === Store.todayISO() ? pickRandom(WORKOUT_LOGGED_MSGS) : 'backfilled ✨ streaks updated');
      }
      onDone();
    });
  }

  views.fitness = function () {
    editingWorkoutId = null;
    editingMealId = null;
    var wrap = el('<section class="stack"></section>');
    var t = Formulas.targets(Store.state.profile);
    var today = Store.todayISO();
    var meals = Store.mealsOn(today);
    var firstName = (Store.state.profile.name || '').trim().split(/\s+/)[0];

    wrap.appendChild(el(
      '<div class="hello"><h1>' + (firstName ? 'hey ' + esc(firstName) : 'hey bestie') +
      ' 💅</h1><p class="muted">' + prettyDate(today) + ' · let’s get it ✨</p></div>'
    ));

    wrap.appendChild(streakCard());

    if (!t) {
      wrap.appendChild(el(
        '<div class="card empty"><h3>set up your profile to begin</h3>' +
        '<p class="muted">add your stats and goal in settings ⚙️ to get your daily targets.</p>' +
        '<button class="btn primary" data-go="profile">go to settings →</button></div>'
      ));
      wrap.querySelector('[data-go]').addEventListener('click', function () { setView('profile'); });
      return wrap;
    }

    // ---- fuel check (macros) — up top since it's the most-used action ----
    var calEaten = sum(meals, function (m) { return num(m.calories); });
    var proteinEaten = sum(meals, function (m) { return num(m.protein); });
    var carbsEaten = sum(meals, function (m) { return num(m.carbs); });
    var fatEaten = sum(meals, function (m) { return num(m.fat); });

    var macCard = el('<div class="card"></div>');
    macCard.appendChild(el('<div class="card-head"><h3>fuel check 🍽️</h3>' +
      '<button class="btn small" id="toggleFoodForm">+ log</button></div>'));
    macCard.appendChild(el('<p class="vibe-note">' + esc(calorieVibe(calEaten, t.calories)) + '</p>'));
    var grid = el('<div class="metric-grid"></div>');
    grid.appendChild(metricCard('calories', calEaten, t.calories, 'kcal'));
    grid.appendChild(metricCard('protein', proteinEaten, t.protein, 'g'));
    grid.appendChild(metricCard('carbs', carbsEaten, t.carbs, 'g'));
    grid.appendChild(metricCard('fat', fatEaten, t.fat, 'g'));
    macCard.appendChild(grid);

    macCard.appendChild(el('<p class="muted small" style="margin-top:12px">weight loss: <strong>' + t.minCalories +
      ' kcal</strong> · maintenance: <strong>' + t.tdee + ' kcal</strong>' +
      (t.floored ? ' — your target’s held at the floor.' : '') + '</p>'));

    if (meals.length) {
      var foodLogFold = el('<details class="fold" style="margin-top:14px"></details>');
      foodLogFold.innerHTML = '<summary>today’s fuel log 📋</summary><div class="fold-body"><ul class="entry-list" id="foodLogList" style="margin-top:12px"></ul></div>';
      var foodLogList = foodLogFold.querySelector('#foodLogList');
      meals.forEach(function (m) {
        var li = el('<li>' +
          '<span class="entry-main">' + esc(m.name) + ' · ' + num(m.calories) + ' kcal · ' + num(m.protein) + 'g P</span>' +
          '<button class="icon-btn" title="edit">✏️</button>' +
          '<button class="icon-btn" title="delete">✕</button></li>');
        li.querySelector('[title=edit]').addEventListener('click', function () { editMeal(m); });
        li.querySelector('[title=delete]').addEventListener('click', function () {
          Store.deleteMeal(m.id); toast('food removed'); render();
        });
        foodLogList.appendChild(li);
      });
      macCard.appendChild(foodLogFold);
    }

    macCard.appendChild(el('<button class="link-btn" id="openMacroHistory">📊 see your macros over time</button>'));
    macCard.querySelector('#openMacroHistory').addEventListener('click', function () { setView('macroHistory'); });

    var mFormWrap = el('<div id="foodFormWrap" style="display:none;margin-top:14px"></div>');
    mFormWrap.innerHTML = foodFormHTML();
    macCard.appendChild(mFormWrap);
    wrap.appendChild(macCard);

    // ---- fit check (unordered weekly movement checklist) ----
    var slots = Plans.fillWeekSlots(Store.workoutsThisWeek());
    var restTaken = Store.restDaysTakenThisWeek();

    var lineupCard = el('<div class="card"></div>');
    lineupCard.appendChild(el('<div class="card-head"><h3>fit check 💪</h3>' +
      '<button class="btn small" id="toggleWorkoutForm">+ log</button></div>'));
    lineupCard.appendChild(el('<p class="vibe-note">hit each once, any order, whenever works 🎲</p>'));

    var lineupList = el('<ul class="mini-list lineup-list"></ul>');
    slots.forEach(function (slot) {
      var li;
      if (slot.workout) {
        li = el('<li class="lineup-row done"><span class="lineup-check">✓</span>' +
          '<div class="lineup-mid"><div class="lineup-label">' + slot.emoji + ' ' + esc(slot.label) + '</div>' +
          '<div class="muted small">done — ' + esc(slot.workout.name || slot.workout.type) + '</div></div></li>');
      } else {
        li = el('<li class="lineup-row"><span class="lineup-check">○</span>' +
          '<div class="lineup-mid"><div class="lineup-label">' + slot.emoji + ' ' + esc(slot.label) + '</div>' +
          '<div class="muted small">' + esc(slot.detail) + '</div></div>' +
          '<button class="lineup-add" data-preset="' + esc(slot.preset) + '" title="log a ' + esc(slot.label) + ' workout">+</button></li>');
      }
      lineupList.appendChild(li);
    });
    // "done" for this slot means a rest day was taken THIS WEEK, same as
    // every other slot staying checked all week once satisfied — not just
    // today, or the checkmark would flip back off the very next morning
    // even though the week's rest day was already used.
    var restToday = Store.isRestDay(today);
    var restDoneThisWeek = restTaken > 0;
    var restLabel = restToday ? 'taken today ✓' : (restDoneThisWeek ? 'taken this week ✓' : '');
    var restLi = el('<li class="lineup-row' + (restDoneThisWeek ? ' done' : '') + '">' +
      '<button class="lineup-check rest-check" title="toggle rest day">' + (restDoneThisWeek ? '✓' : '○') + '</button>' +
      '<div class="lineup-mid"><div class="lineup-label">😴 rest day' +
      (restLabel ? '<span class="muted small"> — ' + restLabel + '</span>' : '') + '</div></div></li>');
    restLi.querySelector('.rest-check').addEventListener('click', function () {
      Store.toggleRestDay(today);
      render();
    });
    lineupList.appendChild(restLi);
    lineupCard.appendChild(lineupList);

    lineupCard.appendChild(el('<button class="link-btn" id="openExercises">📈 track your exercise numbers</button>'));
    lineupCard.querySelector('#openExercises').addEventListener('click', function () { setView('exercises'); });

    var weekWorkouts = Store.workoutsThisWeek().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (weekWorkouts.length) {
      var workoutLogFold = el('<details class="fold" style="margin-top:14px"></details>');
      workoutLogFold.innerHTML = '<summary>this week’s fit log 📋</summary><div class="fold-body"><ul class="entry-list" id="workoutLogList" style="margin-top:12px"></ul></div>';
      var workoutLogList = workoutLogFold.querySelector('#workoutLogList');
      weekWorkouts.forEach(function (w) {
        var shortDate = new Date(w.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        var li = el('<li>' +
          '<span class="entry-main">' + esc(shortDate) + ' · ' + esc(w.name || w.type) + ' · ' + num(w.durationMin) + ' min · ' + esc(w.intensity) + '</span>' +
          '<button class="icon-btn" title="edit">✏️</button>' +
          '<button class="icon-btn" title="delete">✕</button></li>');
        li.querySelector('[title=edit]').addEventListener('click', function () { editWorkout(w); });
        li.querySelector('[title=delete]').addEventListener('click', function () {
          Store.deleteWorkout(w.id); toast('workout removed'); render();
        });
        workoutLogList.appendChild(li);
      });
      lineupCard.appendChild(workoutLogFold);
    }

    var wFormWrap = el('<div id="workoutFormWrap" style="display:none;margin-top:14px"></div>');
    wFormWrap.innerHTML = workoutFormHTML();
    lineupCard.appendChild(wFormWrap);
    wrap.appendChild(lineupCard);

    function openWorkoutForm(presetType) {
      if (presetType) {
        var sel = wFormWrap.querySelector('select[name=type]');
        if (sel) sel.value = presetType;
      }
      wFormWrap.style.display = 'block';
      wFormWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    lineupCard.querySelectorAll('.lineup-add').forEach(function (b) {
      b.addEventListener('click', function () { openWorkoutForm(b.dataset.preset); });
    });

    // ---- edit helpers: pre-fill + open the relevant form ----
    function editWorkout(w) {
      editingWorkoutId = w.id;
      var f = wFormWrap.querySelector('#wForm');
      f.date.value = w.date || Store.todayISO();
      f.name.value = w.name || '';
      f.type.value = w.type;
      f.durationMin.value = w.durationMin;
      f.intensity.value = w.intensity;
      f.notes.value = w.notes || '';
      wFormWrap.querySelector('button[type=submit]').textContent = 'save changes';
      wFormWrap.style.display = 'block';
      wFormWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function editMeal(m) {
      editingMealId = m.id;
      var f = mFormWrap.querySelector('#mForm');
      f.date.value = m.date || Store.todayISO();
      f.name.value = m.name || '';
      f.calories.value = num(m.calories);
      f.protein.value = num(m.protein);
      f.carbs.value = num(m.carbs);
      f.fat.value = num(m.fat);
      mFormWrap.querySelector('button[type=submit]').textContent = 'save changes';
      mFormWrap.style.display = 'block';
      mFormWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ---- wire toggles + forms ----
    lineupCard.querySelector('#toggleWorkoutForm').addEventListener('click', function () {
      var showing = wFormWrap.style.display !== 'none';
      if (showing) {
        editingWorkoutId = null;
        wFormWrap.querySelector('button[type=submit]').textContent = 'log workout';
        clearFormDraft('workout');
      }
      wFormWrap.style.display = showing ? 'none' : 'block';
      if (!showing) wFormWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    macCard.querySelector('#toggleFoodForm').addEventListener('click', function () {
      var showing = mFormWrap.style.display !== 'none';
      if (showing) {
        editingMealId = null;
        mFormWrap.querySelector('button[type=submit]').textContent = 'log food';
        clearFormDraft('food');
      }
      mFormWrap.style.display = showing ? 'none' : 'block';
      if (!showing) mFormWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // ---- draft persistence: keep whatever's typed if the app gets
    // backgrounded and reloaded mid-entry, instead of silently clearing it ----
    function wireDraft(kind, formWrap, fieldNames, editingIdGetter, editingIdSetter) {
      // scoped to formWrap (not the <form>) and by plain attribute selector,
      // not form[name] — some fields (like the food search box) live outside
      // the <form> tag itself, linked via form="", and that cross-element
      // association doesn't reliably resolve while the tree is still
      // detached (i.e. exactly when this runs, before render() inserts it).
      // The 'input' listener is on formWrap for the same reason: the search
      // box isn't a DOM descendant of <form> (only form-attribute-linked to
      // it), so it never bubbles an input event up through the form itself —
      // typing a food name and switching apps before touching another field
      // saved nothing at all. Listening on the wrapper catches every field.
      function fieldEl(n) { return formWrap.querySelector('[name="' + n + '"]'); }
      function save() {
        var fields = {};
        fieldNames.forEach(function (n) { var f = fieldEl(n); fields[n] = f ? f.value : ''; });
        saveFormDraft(kind, {
          editingId: editingIdGetter(),
          submitLabel: formWrap.querySelector('button[type=submit]').textContent,
          fields: fields
        });
      }
      formWrap.addEventListener('input', save);
      var draft = loadFormDraft(kind);
      if (draft) {
        editingIdSetter(draft.editingId || null);
        formWrap.querySelector('button[type=submit]').textContent = draft.submitLabel || formWrap.querySelector('button[type=submit]').textContent;
        fieldNames.forEach(function (n) { var f = fieldEl(n); if (f && draft.fields[n] != null) f.value = draft.fields[n]; });
        formWrap.style.display = 'block';
      }
    }
    wireDraft('workout', wFormWrap, ['date', 'name', 'type', 'durationMin', 'intensity', 'notes'],
      function () { return editingWorkoutId; }, function (v) { editingWorkoutId = v; });
    wireDraft('food', mFormWrap, ['date', 'name', 'calories', 'protein', 'carbs', 'fat'],
      function () { return editingMealId; }, function (v) { editingMealId = v; });
    wireWorkoutForm(wFormWrap, function () { clearFormDraft('workout'); render(); });
    wireFoodForm(mFormWrap, function () { clearFormDraft('food'); render(); });

    return wrap;
  };

  function metricCard(label, val, target, unit) {
    var pct = target > 0 ? Math.round((val / target) * 100) : 0;
    var barPct = Math.min(100, pct);
    var over = val > target * 1.05;
    var c = el('<div class="metric"></div>');
    c.innerHTML =
      '<div class="metric-top"><span class="metric-label">' + label + '</span>' +
      '<span class="metric-pct' + (over ? ' over' : '') + '">' + pct + '%</span></div>' +
      '<div class="metric-val">' + Math.round(val) + ' <span class="muted">/ ' + target + ' ' + unit + '</span></div>' +
      '<div class="bar"><div class="bar-fill' + (over ? ' over' : '') + '" style="width:' + barPct + '%"></div></div>';
    return c;
  }

  // macro-over-time bar chart (calories/protein/carbs/fat, pick one) —
  // the data label is the raw grams/kcal, but bar height is % of goal (so
  // a target change later doesn't make old bars misleading), with a dashed
  // tick per bar marking the 100% goal line. Lives on its own page — see
  // views.macroHistory.
  var MACRO_METRICS = [
    { key: 'calories', label: 'calories', unit: 'kcal', hit: function (d) { return d.calHit; } },
    { key: 'protein', label: 'protein', unit: 'g', hit: function (d) { return d.proteinHit; } },
    { key: 'carbs', label: 'carbs', unit: 'g', hit: function (d) { return d.carbsHit; } },
    { key: 'fat', label: 'fat', unit: 'g', hit: function (d) { return d.fatHit; } }
  ];

  function macroChartEl(days, metric, target) {
    var barAreaHeight = 120;
    var pcts = days.map(function (d) { return d[metric.key + 'Pct'] || 0; });
    var maxPct = Math.max(140, Math.max.apply(null, pcts) + 15);
    var goalBottom = Math.round((100 / maxPct) * barAreaHeight);

    // three separate rows (labels / plot / dates) instead of one goal-tick
    // per bar — a per-bar tick gets fully hidden behind any bar taller than
    // the goal, and reads as broken dashes rather than one line. A single
    // line spanning the whole plot, stacked above the bars, stays visible
    // the whole way across no matter how tall a bar gets.
    var labels = '', tracks = '', dates = '';
    days.forEach(function (d) {
      var pct = d[metric.key + 'Pct'] || 0;
      var val = d[metric.key];
      var h = Math.max(3, Math.round((pct / maxPct) * barAreaHeight));
      var dt = new Date(d.date + 'T00:00:00');
      var dateLabel = (dt.getMonth() + 1) + '/' + dt.getDate();
      var cls = metric.hit(d) ? 'hit' : 'miss';
      var barLabel = Math.round(val) + (metric.unit === 'kcal' ? '' : metric.unit);
      labels += '<div class="macro-col-cell macro-bar-label">' + barLabel + '</div>';
      tracks += '<div class="macro-col-cell macro-bar-track"><div class="macro-bar ' + cls +
        '" style="height:' + h + 'px" title="' + pct + '% of goal"></div></div>';
      dates += '<div class="macro-col-cell macro-date">' + dateLabel + '</div>';
    });

    var host = el('<div></div>');
    host.innerHTML = '<div class="macro-chart-wrap"><div class="macro-chart">' +
      '<div class="macro-row">' + labels + '</div>' +
      '<div class="macro-plot" style="height:' + barAreaHeight + 'px">' +
        '<div class="macro-goal-line" style="bottom:' + goalBottom + 'px"></div>' +
        '<div class="macro-row" style="height:100%">' + tracks + '</div>' +
      '</div>' +
      '<div class="macro-row">' + dates + '</div>' +
      '</div></div>' +
      '<p class="muted small" style="margin-top:10px">dashed line = your ' + metric.label + ' goal (' +
      target + (metric.unit === 'kcal' ? ' kcal' : metric.unit) + ') · last ' +
      days.length + ' logged day' + (days.length === 1 ? '' : 's') + '</p>';
    return host;
  }

  // consecutive days (ending today) where `days[iso]` is true
  function consecutiveStreak(days) {
    var streak = 0;
    var todayISO = Store.todayISO();
    var d = new Date(todayISO + 'T00:00:00');
    // today not done yet isn't a broken streak — it's just not over yet.
    // Start counting from yesterday so an in-progress streak doesn't drop
    // to 0 first thing in the morning before you've had a chance to log.
    if (!days[todayISO]) d.setDate(d.getDate() - 1);
    while (true) {
      var iso = d.toISOString().slice(0, 10);
      if (days[iso]) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return streak;
  }

  function fuelFitStreaks() {
    var workoutDays = {};
    Store.state.workouts.forEach(function (w) { workoutDays[w.date] = true; });
    // a marked rest day is part of the plan, not a lapse — it keeps the fit
    // streak alive instead of breaking it.
    Store.state.restDays.forEach(function (d) { workoutDays[d] = true; });
    var foodDays = {};
    var t = Formulas.targets(Store.state.profile);
    if (t) {
      var calByDay = {};
      Store.state.meals.forEach(function (m) { calByDay[m.date] = (calByDay[m.date] || 0) + (Number(m.calories) || 0); });
      Object.keys(calByDay).forEach(function (date) {
        var cal = calByDay[date];
        if (cal >= t.calories * 0.9 && cal <= t.calories * 1.1) foodDays[date] = true;
      });
    }
    return { fit: consecutiveStreak(workoutDays), fuel: consecutiveStreak(foodDays) };
  }

  // per-day stats for the last n days, ending yesterday (today's still in
  // progress, so it's excluded from pattern-detection).
  function recentDayStats(n) {
    var t = Formulas.targets(Store.state.profile);
    var mealsByDay = {}, workoutsByDay = {};
    Store.state.meals.forEach(function (m) { (mealsByDay[m.date] = mealsByDay[m.date] || []).push(m); });
    Store.state.workouts.forEach(function (w) { (workoutsByDay[w.date] = workoutsByDay[w.date] || []).push(w); });
    var out = [];
    var d = new Date(Store.todayISO() + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    for (var i = 0; i < n; i++) {
      var iso = d.toISOString().slice(0, 10);
      var dayMeals = mealsByDay[iso] || [];
      var hasFood = dayMeals.length > 0;
      var cal = sum(dayMeals, function (m) { return num(m.calories); });
      var protein = sum(dayMeals, function (m) { return num(m.protein); });
      var carbs = sum(dayMeals, function (m) { return num(m.carbs); });
      var fat = sum(dayMeals, function (m) { return num(m.fat); });
      out.push({
        date: iso,
        hasFood: hasFood,
        calories: cal,
        caloriesPct: (t && hasFood) ? Math.round((cal / t.calories) * 100) : null,
        calHit: !!(t && hasFood && cal >= t.calories * 0.9 && cal <= t.calories * 1.1),
        protein: protein,
        proteinPct: (t && hasFood) ? Math.round((protein / t.protein) * 100) : null,
        proteinHit: !!(t && hasFood && protein >= t.protein * 0.9),
        carbs: carbs,
        carbsPct: (t && hasFood) ? Math.round((carbs / t.carbs) * 100) : null,
        carbsHit: !!(t && hasFood && carbs >= t.carbs * 0.8 && carbs <= t.carbs * 1.2),
        fat: fat,
        fatPct: (t && hasFood) ? Math.round((fat / t.fat) * 100) : null,
        fatHit: !!(t && hasFood && fat >= t.fat * 0.75 && fat <= t.fat * 1.25),
        hasWorkout: !!(workoutsByDay[iso] && workoutsByDay[iso].length)
      });
      d.setDate(d.getDate() - 1);
    }
    return out;
  }

  function streakCard() {
    var streaks = fuelFitStreaks();

    function block(streak, label) {
      return '<div class="streak-block">' +
        '<div class="streak-num' + (streak > 0 ? ' lit' : '') + '">' + streak + '</div>' +
        '<div class="muted small">' + label + (streak === 1 ? '' : 's') + '</div></div>';
    }

    var c = el('<div class="card"></div>');
    c.innerHTML = '<h3>streak check 🔥</h3><div class="streak-split">' +
      block(streaks.fuel, 'fuel day') +
      block(streaks.fit, 'fit day') +
      '</div>';
    return c;
  }

  // ==== EXERCISE TRACKER (per-exercise progress log, reached via a link on
  // the Home lineup card — not a tab. One flat list, since real exercises
  // span multiple lineup categories. Purely a reference log, no points.) ====
  views.exercises = function () {
    var wrap = el('<section class="stack"></section>');

    wrap.appendChild(el('<button class="link-btn back-link" id="exBack">← back to fitness</button>'));
    wrap.appendChild(el('<div class="hello"><h1>exercise tracker 🏋️</h1>' +
      '<p class="muted">your numbers, so you don’t need a notes app ✍️</p></div>'));
    wrap.querySelector('#exBack').addEventListener('click', function () { setView('fitness'); });

    var exercises = Store.state.exercises;
    var listCard = el('<div class="card"></div>');
    if (!exercises.length) {
      listCard.appendChild(el('<p class="muted">nothing tracked yet — add an exercise below 👇</p>'));
    } else {
      var ul = el('<ul class="exercise-list"></ul>');
      exercises.forEach(function (ex) {
        var entries = ex.entries.slice().reverse(); // newest first
        var latest = entries[0];
        var li = el('<li class="exercise-item"></li>');
        li.innerHTML =
          '<div class="exercise-head"><div class="exercise-name">' + esc(ex.name) + '</div>' +
          '<button class="icon-btn del" title="delete exercise">✕</button></div>' +
          (latest
            ? '<div class="exercise-latest">last: <strong>' + esc(latest.text) + '</strong> · ' + prettyDate(latest.date) + '</div>'
            : '<div class="muted small">nothing logged yet</div>') +
          '<form class="exercise-log-form">' +
            '<input type="text" placeholder="e.g. 25 lbs × 10" autocomplete="off" required>' +
            '<button class="btn small primary" type="submit">log</button>' +
          '</form>' +
          (entries.length > 1
            ? '<details class="fold exercise-history" style="margin-top:10px"><summary>history (' + entries.length + ')</summary>' +
              '<div class="fold-body"><ul class="entry-list" style="margin-top:10px"></ul></div></details>'
            : '');
        li.querySelector('.del').addEventListener('click', function () {
          if (confirm('Remove “' + ex.name + '” and its history?')) { Store.deleteExercise(ex.id); render(); }
        });
        li.querySelector('.exercise-log-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var input = e.target.querySelector('input');
          var text = input.value.trim();
          if (!text) return;
          Store.logExerciseEntry(ex.id, text);
          toast(pickRandom(NUM_LOGGED_MSGS));
          render();
        });
        var histUl = li.querySelector('.exercise-history .entry-list');
        if (histUl) {
          entries.slice(1).forEach(function (entry) {
            var hli = el('<li><span class="entry-main">' + esc(entry.text) + '</span>' +
              '<span class="muted small">' + prettyDate(entry.date) + '</span>' +
              '<button class="icon-btn del" title="delete entry">✕</button></li>');
            hli.querySelector('.del').addEventListener('click', function () {
              Store.deleteExerciseEntry(ex.id, entry.id); render();
            });
            histUl.appendChild(hli);
          });
        }
        ul.appendChild(li);
      });
      listCard.appendChild(ul);
    }
    wrap.appendChild(listCard);

    var addCard = el('<div class="card"></div>');
    addCard.innerHTML =
      '<h3>add an exercise</h3>' +
      '<form id="exAddForm" class="form-grid">' +
        '<label class="wide">name<input name="name" placeholder="e.g. bicep curl" autocomplete="off" required></label>' +
        '<button class="btn primary wide" type="submit">add it</button>' +
      '</form>';
    addCard.querySelector('#exAddForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      Store.addExercise(name);
      toast('added ✨');
      render();
    });
    wrap.appendChild(addCard);

    return wrap;
  };

  // ==== MACRO HISTORY (reached via a link on the fuel check card, not a
  // tab — same pattern as the exercise tracker) ==========================
  views.macroHistory = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<button class="link-btn back-link" id="macroBack">← back to fitness</button>'));
    wrap.appendChild(el('<div class="hello"><h1>macros over time 📊</h1>' +
      '<p class="muted">what you’ve actually been eating 🍽️</p></div>'));
    wrap.querySelector('#macroBack').addEventListener('click', function () { setView('fitness'); });

    var t = Formulas.targets(Store.state.profile);
    var card = el('<div class="card"></div>');
    if (!t) {
      card.appendChild(el('<p class="muted">set up your profile in settings to see targets.</p>'));
      wrap.appendChild(card);
      return wrap;
    }

    var activeKey = 'protein';
    var segEl = el('<div class="seg">' + MACRO_METRICS.map(function (m) {
      return '<button type="button" class="seg-btn' + (m.key === activeKey ? ' active' : '') + '" data-key="' + m.key + '">' + m.label + '</button>';
    }).join('') + '</div>');
    card.appendChild(segEl);
    var chartHost = el('<div style="margin-top:4px"></div>');
    card.appendChild(chartHost);
    wrap.appendChild(card);

    function renderChart() {
      chartHost.innerHTML = '';
      var metric = MACRO_METRICS.filter(function (m) { return m.key === activeKey; })[0];
      var days = recentDayStats(30).filter(function (d) { return d.hasFood; });
      if (!days.length) {
        chartHost.appendChild(el('<p class="muted" style="margin-top:14px">log some food to start seeing trends here 🍽️</p>'));
        return;
      }
      days = days.slice().reverse(); // oldest first, left to right
      chartHost.appendChild(macroChartEl(days, metric, t[metric.key]));
    }

    segEl.querySelectorAll('.seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        segEl.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeKey = btn.dataset.key;
        renderChart();
      });
    });

    renderChart();
    return wrap;
  };

  // ==== QUESTS =======================================================
  function deadlineTag(deadline, verb) {
    verb = verb || 'due';
    if (!deadline) return '';
    var days = Formulas.daysUntil(deadline);
    var label, cls;
    if (days < 0) { label = 'overdue ' + Math.abs(days) + 'd 💀 no judgment but do it'; cls = 'over'; }
    else if (days === 0) { label = verb + ' today 🚨'; cls = 'urgent'; }
    else if (days === 1) { label = verb + ' tomorrow ⏰'; cls = 'urgent'; }
    else if (days <= 3) { label = days + 'd left — crunch time ⏰'; cls = 'soon'; }
    else {
      label = verb + ' ' + new Date(deadline + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' · ' + days + 'd left';
      cls = 'ok';
    }
    return '<span class="deadline-tag ' + cls + '">' + label + '</span>';
  }

  var FREQ_OPTIONS = [
    { value: 'daily', label: 'daily' },
    { value: '2', label: '2×/week' },
    { value: '3', label: '3×/week' },
    { value: '4', label: '4×/week' },
    { value: '5', label: '5×/week' },
    { value: '6', label: '6×/week' }
  ];

  function effectiveDeadline(q) { return q.recurring ? q.endDate : q.deadline; }
  function isOpenQuest(q, today) {
    return q.recurring ? q.endDate >= today : !q.done;
  }
  function byDeadlineSoonest(a, b) {
    var da = effectiveDeadline(a), db = effectiveDeadline(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  }

  views.quests = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<div class="hello"><h1>quests 🗺️</h1>' +
      '<p class="muted">the stuff you actually need to do — health first, side stuff after</p></div>'));

    var selectedLevel = 3;
    var selectedType = 'health';
    var selectedKind = 'oneoff';
    var selectedFreq = 'daily';
    var editingQuestId = null;

    // --- add form ---
    var addCard = el('<div class="card"></div>');
    addCard.innerHTML =
      '<h3>new quest ✨</h3>' +
      '<div class="seg" id="typeSeg">' +
        '<button type="button" class="seg-btn type-health active" data-type="health">health quest</button>' +
        '<button type="button" class="seg-btn type-side" data-type="side">side quest</button>' +
      '</div>' +
      '<div class="seg" id="kindSeg">' +
        '<button type="button" class="seg-btn active" data-kind="oneoff">one-off</button>' +
        '<button type="button" class="seg-btn" data-kind="recurring">recurring</button>' +
      '</div>' +
      '<form id="qForm" class="form-grid" onsubmit="return false">' +
        '<label class="wide">what’s the task?<input name="name" placeholder="e.g. book the dentist 🦷" autocomplete="off" required></label>' +
        '<div class="wide" id="oneoffFields"><label class="wide">deadline (optional)<span class="date-wrap"><input name="deadline" type="date"></span></label></div>' +
        '<div class="wide form-grid" id="recurringFields" style="display:none;padding:0">' +
          '<label>how often<select name="freq">' +
            FREQ_OPTIONS.map(function (f) { return '<option value="' + f.value + '">' + f.label + '</option>'; }).join('') +
          '</select></label>' +
          '<label>ends by<span class="date-wrap"><input name="endDate" type="date"></span></label>' +
        '</div>' +
      '</form>' +
      '<div class="recent-label" style="margin-top:8px">how much are you dreading it? 😬</div>' +
      '<div class="annoyance-grid" id="annoyanceGrid"></div>' +
      '<div class="quest-preview" id="questPreview"></div>' +
      '<button class="btn primary wide" id="qAdd" type="button" style="margin-top:10px">add it to the list</button>';

    addCard.querySelectorAll('#typeSeg .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedType = b.dataset.type;
        addCard.querySelectorAll('#typeSeg .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        renderGrid();
        updatePreview();
      });
    });

    var oneoffFields = addCard.querySelector('#oneoffFields');
    var recurringFields = addCard.querySelector('#recurringFields');
    addCard.querySelectorAll('#kindSeg .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedKind = b.dataset.kind;
        addCard.querySelectorAll('#kindSeg .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        oneoffFields.style.display = selectedKind === 'oneoff' ? '' : 'none';
        recurringFields.style.display = selectedKind === 'recurring' ? '' : 'none';
        updatePreview();
      });
    });
    addCard.querySelector('select[name=freq]').addEventListener('change', function (e) {
      selectedFreq = e.target.value;
      updatePreview();
    });

    var annGrid = addCard.querySelector('#annoyanceGrid');
    var preview = addCard.querySelector('#questPreview');
    function renderGrid() {
      annGrid.innerHTML = '';
      Formulas.ANNOYANCE.forEach(function (a) {
        var b = el('<button type="button" class="annoyance-btn' + (a.key === selectedLevel ? ' active' : '') +
          (a.key === 0 ? ' reminder-tile' : '') +
          '"><span>' + esc(a.label) + '</span></button>');
        b.addEventListener('click', function () { selectedLevel = a.key; renderGrid(); updatePreview(); });
        annGrid.appendChild(b);
      });
    }
    // only recurring quests get a preview line — the streak cadence isn't
    // shown anywhere else until you've actually started checking in.
    function updatePreview() {
      if (selectedKind === 'oneoff') { preview.innerHTML = ''; return; }
      var cadence = selectedFreq === 'daily' ? 'every day' : selectedFreq + 'x a week';
      preview.innerHTML = 'check in ' + cadence + ' to build a streak 🔥';
    }
    renderGrid(); updatePreview();

    var qAddBtn = addCard.querySelector('#qAdd');
    qAddBtn.addEventListener('click', function () {
      var f = addCard.querySelector('#qForm');
      var name = f.name.value.trim();
      if (!name) { toast('gimme a task first bestie 😌'); return; }
      var isReminder = !selectedLevel;
      if (editingQuestId) {
        var patch = { name: name, type: selectedType, annoyance: selectedLevel };
        if (selectedKind === 'oneoff') {
          patch.deadline = f.deadline.value || null;
        } else {
          if (!f.endDate.value) { toast('give it an end date bestie 😌'); return; }
          patch.frequency = selectedFreq === 'daily' ? 'daily' : Number(selectedFreq);
          patch.endDate = f.endDate.value;
        }
        Store.updateQuest(editingQuestId, patch);
        toast('quest updated ✓');
        editingQuestId = null;
        qAddBtn.textContent = 'add it to the list';
      } else if (selectedKind === 'oneoff') {
        Store.addQuest(name, selectedLevel, selectedType, f.deadline.value || null);
        toast(isReminder ? 'noted — just a nudge 🔔' : 'added — future you says thanks ✨');
      } else {
        if (!f.endDate.value) { toast('give it an end date bestie 😌'); return; }
        Store.addRecurringQuest(name, selectedLevel, selectedType, selectedFreq === 'daily' ? 'daily' : Number(selectedFreq), f.endDate.value);
        toast(isReminder ? 'locked in as a recurring nudge 🔔' : 'locked in — let’s build that streak ✨');
      }
      render();
    });

    qAddBtn.insertAdjacentHTML('afterend',
      '<button type="button" class="btn small" id="qCancel" style="margin-top:8px;display:none">cancel edit</button>');
    var qCancelBtn = addCard.querySelector('#qCancel');
    function resetQuestForm() {
      editingQuestId = null;
      selectedKind = 'oneoff'; selectedType = 'health'; selectedLevel = 3;
      addCard.querySelectorAll('#typeSeg .seg-btn').forEach(function (x) { x.classList.toggle('active', x.dataset.type === 'health'); });
      addCard.querySelectorAll('#kindSeg .seg-btn').forEach(function (x) {
        x.classList.toggle('active', x.dataset.kind === 'oneoff'); x.disabled = false;
      });
      oneoffFields.style.display = ''; recurringFields.style.display = 'none';
      addCard.querySelector('#qForm').reset();
      renderGrid(); updatePreview();
      qAddBtn.textContent = 'add it to the list';
      qCancelBtn.style.display = 'none';
    }
    qCancelBtn.addEventListener('click', resetQuestForm);

    function editQuest(q) {
      editingQuestId = q.id;
      selectedType = q.type;
      selectedKind = q.recurring ? 'recurring' : 'oneoff';
      selectedLevel = q.annoyance || null;
      if (q.recurring) selectedFreq = q.frequency === 'daily' ? 'daily' : String(q.frequency);

      addCard.querySelectorAll('#typeSeg .seg-btn').forEach(function (x) { x.classList.toggle('active', x.dataset.type === selectedType); });
      addCard.querySelectorAll('#kindSeg .seg-btn').forEach(function (x) {
        x.classList.toggle('active', x.dataset.kind === selectedKind);
        x.disabled = true; // kind can't change mid-edit — too structurally different to convert safely
      });
      oneoffFields.style.display = selectedKind === 'oneoff' ? '' : 'none';
      recurringFields.style.display = selectedKind === 'recurring' ? '' : 'none';

      var f = addCard.querySelector('#qForm');
      f.name.value = q.name;
      if (q.recurring) {
        addCard.querySelector('select[name=freq]').value = selectedFreq;
        f.endDate.value = q.endDate;
      } else {
        f.deadline.value = q.deadline || '';
      }

      renderGrid();
      updatePreview();
      qAddBtn.textContent = 'save changes';
      qCancelBtn.style.display = '';
      addCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // --- lists ---
    function oneOffItem(q) {
      var pillHTML = q.annoyance ? '' : '<span class="pill reminder">🔔</span>';
      var li = el('<li class="quest-item' + (q.done ? ' done' : '') + '">' +
        '<div class="quest-mid clickable" title="tap to mark done"><div class="quest-name">' + esc(q.name) + '</div>' +
        '<div class="quest-vibe">' + (q.done ? '' : deadlineTag(q.deadline)) + '</div></div>' +
        '<div class="quest-actions">' + pillHTML +
        '<button class="icon-btn" title="edit">✏️</button>' +
        '<button class="icon-btn del" title="delete">✕</button></div></li>');
      li.querySelector('.quest-mid').addEventListener('click', function () {
        var nowDone = Store.toggleQuest(q.id);
        var doneMsg = pickRandom(q.annoyance ? QUEST_DONE_MSGS : QUEST_DONE_FREE_MSGS);
        toast(nowDone ? doneMsg : 'back on the list 🫡');
        render();
      });
      li.querySelector('[title=edit]').addEventListener('click', function () { editQuest(q); });
      li.querySelector('.del').addEventListener('click', function () { Store.deleteQuest(q.id); render(); });
      return li;
    }

    function recurringItem(q) {
      var freqLabel = q.frequency === 'daily' ? 'daily' : q.frequency + '×/week';
      var streak = Store.questStreak(q);
      var streakUnit = q.frequency === 'daily' ? 'd' : 'wk';
      var today = Store.todayISO();
      var finished = q.endDate < today;
      var doneToday = q.checkins.indexOf(today) !== -1;
      var deadlineHTML = finished
        ? '<span class="deadline-tag ok">ended ' + new Date(q.endDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '</span>'
        : deadlineTag(q.endDate, 'ends');
      var checkinTitle = finished ? 'period ended' : (doneToday ? 'done today' : 'check in');
      var checkinClass = finished ? 'finished' : (doneToday ? 'done-today' : 'primary');
      var li = el('<li class="quest-item recurring">' +
        '<span class="streak-badge">' + (streak > 0 ? '🔥' : '🔁') + '</span>' +
        '<div class="quest-mid"><div class="quest-name">' + esc(q.name) + '</div>' +
        '<div class="quest-vibe"><span>' + freqLabel + (streak > 0 ? ' · ' + streak + streakUnit + ' streak' : '') + '</span>' +
        deadlineHTML + '</div></div>' +
        '<div class="quest-actions"><button class="checkin-btn ' + checkinClass + '" title="' + checkinTitle + '"' +
        (finished || doneToday ? ' disabled' : '') + '>✓</button>' +
        '<button class="icon-btn" title="edit">✏️</button>' +
        '<button class="icon-btn del" title="delete">✕</button></div></li>');
      var checkinBtn = li.querySelector('.checkin-btn');
      if (checkinBtn) {
        checkinBtn.addEventListener('click', function () {
          Store.checkInQuest(q.id);
          toast(pickRandom(CHECKIN_MSGS));
          render();
        });
      }
      li.querySelector('[title=edit]').addEventListener('click', function () { editQuest(q); });
      li.querySelector('.del').addEventListener('click', function () { Store.deleteQuest(q.id); render(); });
      return li;
    }

    function questSection(title, list, emptyMsg) {
      var card = el('<div class="card"></div>');
      card.appendChild(el('<h3>' + title + '</h3>'));
      if (!list.length) {
        card.appendChild(el('<p class="muted">' + emptyMsg + '</p>'));
      } else {
        var ul = el('<ul class="quest-list"></ul>');
        list.forEach(function (q) { ul.appendChild(q.recurring ? recurringItem(q) : oneOffItem(q)); });
        card.appendChild(ul);
      }
      return card;
    }

    var today = Store.todayISO();
    var openHealth = Store.state.quests
      .filter(function (q) { return (q.type || 'health') === 'health' && isOpenQuest(q, today); })
      .sort(byDeadlineSoonest);
    var openSide = Store.state.quests
      .filter(function (q) { return q.type === 'side' && isOpenQuest(q, today); })
      .sort(byDeadlineSoonest);
    var finished = Store.state.quests
      .filter(function (q) { return !isOpenQuest(q, today); })
      .sort(function (a, b) { return (effectiveDeadline(b) || b.date || '').localeCompare(effectiveDeadline(a) || a.date || ''); });

    wrap.appendChild(questSection('health quests 🩺', openHealth, 'nothing pending — all caught up, slay 💅'));
    wrap.appendChild(questSection('side quests 📎', openSide, 'no side quests queued up right now'));

    if (finished.length) {
      wrap.appendChild(questSection('handled 💅', finished, ''));
    }
    wrap.appendChild(addCard);
    return wrap;
  };

  // ==== TRACKER (cycle tracker + budget tracker) =========================
  function budgetMetricCard(label, spent, limit) {
    var pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    var barPct = Math.min(100, pct);
    var over = spent > limit * 1.05;
    var c = el('<div class="metric"></div>');
    c.innerHTML =
      '<div class="metric-top"><span class="metric-label">' + esc(label) + '</span>' +
      '<span class="metric-pct' + (over ? ' over' : '') + '">' + pct + '%</span></div>' +
      '<div class="metric-val">$' + Math.round(spent) + ' <span class="muted">/ $' + Math.round(limit) + '</span></div>' +
      '<div class="bar"><div class="bar-fill' + (over ? ' over' : '') + '" style="width:' + barPct + '%"></div></div>';
    return c;
  }

  function expenseFormHTML() {
    var opts = Store.state.budgetCategories.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    }).join('');
    return '<h3 style="margin-top:2px">log an expense</h3>' +
      '<form id="eForm" class="form-grid">' +
      '<label class="wide">category<select name="categoryId" required>' + opts + '</select></label>' +
      '<label>amount ($)<input name="amount" type="number" min="0" step="0.01" required></label>' +
      '<label>date<span class="date-wrap"><input name="date" type="date" value="' + Store.todayISO() + '" max="' + Store.todayISO() + '" required></span></label>' +
      '<label class="wide">note (optional)<input name="note" placeholder="e.g. groceries"></label>' +
      '<button class="btn primary wide" type="submit">log expense</button>' +
      '</form>';
  }

  function budgetTrackerCard() {
    var card = el('<div class="card"></div>');
    card.appendChild(el('<div class="card-head"><h3>budget 💵</h3></div>'));

    var categories = Store.state.budgetCategories;
    var summary = Store.budgetSummary();
    if (!categories.length) {
      card.appendChild(el('<p class="muted">no budget categories yet — add one below 👇</p>'));
    } else {
      var grid = el('<div class="metric-grid"></div>');
      summary.forEach(function (c) { grid.appendChild(budgetMetricCard(c.name, c.spent, c.monthlyLimit)); });
      card.appendChild(grid);

      var recentExpenses = Store.state.expenses.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 20);
      if (recentExpenses.length) {
        var catById = {};
        categories.forEach(function (c) { catById[c.id] = c.name; });
        var fold = el('<details class="fold" style="margin-top:14px"></details>');
        fold.innerHTML = '<summary>recent expenses 📋</summary><div class="fold-body"><ul class="entry-list" id="expenseList" style="margin-top:12px"></ul></div>';
        var list = fold.querySelector('#expenseList');
        recentExpenses.forEach(function (e) {
          var li = el('<li><span class="entry-main">' + esc(catById[e.categoryId] || 'unknown') + ' · $' + num(e.amount).toFixed(2) +
            (e.note ? ' · ' + esc(e.note) : '') + ' · ' + prettyDate(e.date) + '</span>' +
            '<button class="icon-btn del" title="delete">✕</button></li>');
          li.querySelector('.del').addEventListener('click', function () { Store.deleteExpense(e.id); render(); });
          list.appendChild(li);
        });
        card.appendChild(fold);
      }

      var eFormWrap = el('<div id="expenseFormWrap" style="display:none;margin-top:14px"></div>');
      eFormWrap.innerHTML = expenseFormHTML();
      card.appendChild(eFormWrap);
      card.appendChild(el('<button class="btn wide" id="toggleExpenseForm" style="margin-top:12px">+ log expense</button>'));
      var toggleBtn = card.querySelector('#toggleExpenseForm');
      toggleBtn.addEventListener('click', function () {
        var showing = eFormWrap.style.display !== 'none';
        eFormWrap.style.display = showing ? 'none' : 'block';
        if (!showing) eFormWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      eFormWrap.querySelector('#eForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = ev.target;
        Store.addExpense(f.categoryId.value, f.amount.value, f.date.value, f.note.value.trim());
        toast('logged ✨');
        eFormWrap.style.display = 'none';
        render();
      });
    }

    card.appendChild(el('<button class="link-btn" id="manageBudgetCats" style="margin-top:10px">⚙️ manage budget categories</button>'));
    card.querySelector('#manageBudgetCats').addEventListener('click', function () { setView('budgetCategories'); });
    return card;
  }

  views.tracker = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<div class="hello"><h1>tracker 🩸</h1><p class="muted">cycle + budget, all in one place</p></div>'));

    // ---- cycle tracker ----
    var today = Store.todayISO();
    var onPeriodToday = Store.isPeriodDay(today);
    var summary = Store.cyclesSummary();
    var cycleCard = el('<div class="card"></div>');
    cycleCard.appendChild(el('<h3>cycle tracker 🩸</h3>'));

    var toggleBtn = el('<button class="btn wide' + (onPeriodToday ? '' : ' primary') + '" style="margin-top:8px">' +
      (onPeriodToday ? 'remove today as a period day' : 'log today as a period day') + '</button>');
    toggleBtn.addEventListener('click', function () { Store.togglePeriodDay(today); render(); });
    cycleCard.appendChild(toggleBtn);

    var pastToggle = el('<button class="btn small wide" style="margin-top:8px">+ log a past period</button>');
    cycleCard.appendChild(pastToggle);
    var pastFormWrap = el('<div style="display:none;margin-top:12px"></div>');
    pastFormWrap.innerHTML =
      '<form id="pastPeriodForm" class="form-grid">' +
        '<label>start date<span class="date-wrap"><input name="start" type="date" required value="' + today + '"></span></label>' +
        '<label>length (days)<input name="length" type="number" min="1" max="14" value="5" required></label>' +
        '<label class="wide">flow<select name="flow">' +
          '<option value="light">light</option><option value="medium" selected>medium</option><option value="heavy">heavy</option>' +
        '</select></label>' +
        '<button class="btn primary wide" type="submit">log it</button>' +
      '</form>';
    cycleCard.appendChild(pastFormWrap);
    pastToggle.addEventListener('click', function () {
      var showing = pastFormWrap.style.display !== 'none';
      pastFormWrap.style.display = showing ? 'none' : 'block';
    });
    pastFormWrap.querySelector('#pastPeriodForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      Store.logPeriodRange(f.start.value, num(f.length.value) || 1, f.flow.value);
      toast('logged ✨');
      render();
    });

    if (summary.periods.length) {
      var mostRecent = summary.periods[0];
      var lines = [];
      lines.push('last period: ' + prettyDate(mostRecent.start) +
        (mostRecent.length > 1 ? ' – ' + prettyDate(mostRecent.end) : '') +
        ' (' + mostRecent.length + ' day' + (mostRecent.length === 1 ? '' : 's') + ')');
      if (summary.avgCycleLength) {
        lines.push('avg cycle length: ~' + summary.avgCycleLength + ' days — still stabilizing after birth control, this’ll settle over time');
        if (summary.nextPredicted) {
          lines.push('rough next-period estimate: ' + prettyDate(summary.nextPredicted) + ' — a loose guess, not something to plan around yet');
        }
      } else {
        lines.push('log your next period to see average cycle length');
      }
      var infoBox = el('<div class="floor-note" style="margin-top:10px"></div>');
      infoBox.innerHTML = lines.map(function (l) { return esc(l); }).join('<br>');
      cycleCard.appendChild(infoBox);

      var histFold = el('<details class="fold" style="margin-top:12px"></details>');
      histFold.innerHTML = '<summary>all periods 📜</summary><div class="fold-body"><ul class="mini-list" style="margin-top:10px" id="periodHistList"></ul></div>';
      var histList = histFold.querySelector('#periodHistList');
      summary.periods.slice(0, 12).forEach(function (p) {
        var li = el('<li><span>' + prettyDate(p.start) + (p.length > 1 ? ' – ' + prettyDate(p.end) : '') + '</span>' +
          '<span class="pill">' + p.length + 'd</span>' +
          '<button class="icon-btn del" title="delete">✕</button></li>');
        li.querySelector('.del').addEventListener('click', function () {
          Store.deletePeriodRange(p.start, p.end);
          render();
        });
        histList.appendChild(li);
      });
      cycleCard.appendChild(histFold);
    } else {
      cycleCard.appendChild(el('<p class="muted small" style="margin-top:10px">nothing logged yet — tap above when it starts 🩸</p>'));
    }
    wrap.appendChild(cycleCard);

    // ---- budget tracker ----
    wrap.appendChild(budgetTrackerCard());

    return wrap;
  };

  // ==== BUDGET CATEGORIES (add/edit/delete, reached via a link on the
  // tracker page, not a tab) =============================================
  views.budgetCategories = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<button class="link-btn back-link" id="bcBack">← back to tracker</button>'));
    wrap.appendChild(el('<div class="hello"><h1>budget categories 💵</h1><p class="muted">set a monthly limit for each one</p></div>'));
    wrap.querySelector('#bcBack').addEventListener('click', function () { setView('tracker'); });

    var editingId = null;
    var listCard = el('<div class="card"></div>');
    var summary = Store.budgetSummary();
    if (!summary.length) {
      listCard.appendChild(el('<p class="muted">nothing set up yet — add your first category below 👇</p>'));
    } else {
      var ul = el('<ul class="entry-list"></ul>');
      summary.forEach(function (c) {
        var li = el('<li><span class="entry-main">' + esc(c.name) + ' · $' + Math.round(c.monthlyLimit) + '/mo</span>' +
          '<button class="icon-btn" title="edit">✏️</button>' +
          '<button class="icon-btn del" title="delete">✕</button></li>');
        li.querySelector('[title=edit]').addEventListener('click', function () { editCategory(c); });
        li.querySelector('.del').addEventListener('click', function () {
          if (confirm('Remove “' + c.name + '”? Its logged expenses go with it.')) { Store.deleteBudgetCategory(c.id); render(); }
        });
        ul.appendChild(li);
      });
      listCard.appendChild(ul);
    }
    wrap.appendChild(listCard);

    var formCard = el('<div class="card"></div>');
    formCard.innerHTML = '<h3 id="bcFormTitle">add a category</h3>' +
      '<form id="bcForm" class="form-grid">' +
      '<label class="wide">name<input name="name" placeholder="e.g. groceries" required></label>' +
      '<label class="wide">monthly limit ($)<input name="limit" type="number" min="0" step="1" required></label>' +
      '<button class="btn primary wide" type="submit" id="bcSubmit">add category</button>' +
      '<button type="button" class="btn small" id="bcCancel" style="display:none">cancel edit</button>' +
      '</form>';
    wrap.appendChild(formCard);
    var bcForm = formCard.querySelector('#bcForm');
    var bcTitle = formCard.querySelector('#bcFormTitle');
    var bcSubmit = formCard.querySelector('#bcSubmit');
    var bcCancel = formCard.querySelector('#bcCancel');

    function editCategory(c) {
      editingId = c.id;
      bcForm.name.value = c.name;
      bcForm.limit.value = c.monthlyLimit;
      bcTitle.textContent = 'edit category';
      bcSubmit.textContent = 'save changes';
      bcCancel.style.display = '';
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    bcCancel.addEventListener('click', function () {
      editingId = null;
      bcForm.reset();
      bcTitle.textContent = 'add a category';
      bcSubmit.textContent = 'add category';
      bcCancel.style.display = 'none';
    });
    bcForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = bcForm.name.value.trim();
      var limit = bcForm.limit.value;
      if (editingId) {
        Store.updateBudgetCategory(editingId, { name: name, monthlyLimit: limit });
        toast('category updated ✓');
      } else {
        Store.addBudgetCategory(name, limit);
        toast('category added ✨');
      }
      render();
    });

    return wrap;
  };

  // ==== YOU (profile summary + links to your records) ====================
  views.you = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<div class="hello"><h1>you 🪞</h1><p class="muted">your profile, records & data 💗</p></div>'));

    var p = Store.state.profile;
    var t = Formulas.targets(p);
    var firstName = (p.name || '').trim().split(/\s+/)[0];
    var profileCard = el('<div class="card"></div>');
    profileCard.appendChild(el('<div class="card-head"><h3>' + (firstName ? esc(firstName) : 'your profile') +
      '</h3><button class="btn small" id="editProfile">edit</button></div>'));
    profileCard.appendChild(el(t
      ? '<p class="muted small">weight loss: <strong>' + t.minCalories + ' kcal</strong> · maintenance: <strong>' +
        t.tdee + ' kcal</strong> · protein target: <strong>' + t.protein + 'g</strong></p>'
      : '<p class="muted small">set up your stats in edit to get daily targets.</p>'));
    profileCard.querySelector('#editProfile').addEventListener('click', function () { setView('profile'); });
    wrap.appendChild(profileCard);

    var linksCard = el('<div class="card"></div>');
    linksCard.appendChild(el('<h3>your records 📈</h3>'));
    [
      { label: '📈 exercise numbers', view: 'exercises' },
      { label: '📊 macros over time', view: 'macroHistory' },
      { label: '🍽️ your food list', view: 'foodDatabase' }
    ].forEach(function (l) {
      var b = el('<button class="link-btn" style="display:block;margin-top:8px">' + l.label + '</button>');
      b.addEventListener('click', function () { setView(l.view); });
      linksCard.appendChild(b);
    });
    wrap.appendChild(linksCard);

    return wrap;
  };

  // ==== FOOD DATABASE (view/edit/delete your saved foods, reached via a
  // link on the you page, not a tab — this is where "clean up the names"
  // happens, since your log itself stays untouched either way) ============
  views.foodDatabase = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<button class="link-btn back-link" id="fdBack">← back to you</button>'));
    wrap.appendChild(el('<div class="hello"><h1>your food list 🍽️</h1>' +
      '<p class="muted">everything you’ve logged, saved for next time</p></div>'));
    wrap.querySelector('#fdBack').addEventListener('click', function () { setView('you'); });

    var listCard = el('<div class="card"></div>');
    var entries = Store.state.foodDatabase.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!entries.length) {
      listCard.appendChild(el('<p class="muted">nothing saved yet — log some food and it’ll show up here.</p>'));
    } else {
      var ul = el('<ul class="entry-list"></ul>');
      entries.forEach(function (f) {
        var li = el('<li><span class="entry-main">' + esc(f.name) + ' · ' + num(f.calories) + ' kcal · ' + num(f.protein) + 'g P</span>' +
          '<button class="icon-btn" title="edit">✏️</button>' +
          '<button class="icon-btn del" title="delete">✕</button></li>');
        li.querySelector('[title=edit]').addEventListener('click', function () { editEntry(f); });
        li.querySelector('.del').addEventListener('click', function () {
          if (confirm('Remove “' + f.name + '” from your food list? (past logged meals stay untouched)')) {
            Store.deleteFoodDatabaseEntry(f.id); render();
          }
        });
        ul.appendChild(li);
      });
      listCard.appendChild(ul);
    }
    wrap.appendChild(listCard);

    var editCard = el('<div class="card" id="fdEditCard" style="display:none"></div>');
    editCard.innerHTML = '<h3>edit entry</h3>' +
      '<form id="fdForm" class="form-grid">' +
      '<label class="wide">name<input name="name" required></label>' +
      '<label>calories<input name="calories" type="number" min="0" required></label>' +
      '<label>protein (g)<input name="protein" type="number" min="0"></label>' +
      '<label>carbs (g)<input name="carbs" type="number" min="0"></label>' +
      '<label>fat (g)<input name="fat" type="number" min="0"></label>' +
      '<button class="btn primary wide" type="submit">save changes</button>' +
      '</form>';
    wrap.appendChild(editCard);

    var editingId = null;
    var fdForm = editCard.querySelector('#fdForm');
    function editEntry(f) {
      editingId = f.id;
      fdForm.name.value = f.name;
      fdForm.calories.value = num(f.calories);
      fdForm.protein.value = num(f.protein);
      fdForm.carbs.value = num(f.carbs);
      fdForm.fat.value = num(f.fat);
      editCard.style.display = '';
      editCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    fdForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!editingId) return;
      Store.updateFoodDatabaseEntry(editingId, {
        name: fdForm.name.value.trim(),
        calories: num(fdForm.calories.value),
        protein: num(fdForm.protein.value),
        carbs: num(fdForm.carbs.value),
        fat: num(fdForm.fat.value)
      });
      toast('updated ✓');
      editingId = null;
      editCard.style.display = 'none';
      render();
    });

    return wrap;
  };

  // ==== SETTINGS (profile + reset) =====================================
  views.profile = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<h1>settings ⚙️</h1>'));
    var p = Store.state.profile;

    function opts(map, sel) {
      return Object.keys(map).map(function (k) {
        return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' +
          esc(map[k].label) + '</option>';
      }).join('');
    }
    function goalOpts(sel) {
      return Object.keys(Formulas.GOALS).map(function (k) {
        return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' +
          esc(Formulas.GOALS[k].label) + '</option>';
      }).join('');
    }

    var imperial = (p.units || 'imperial') === 'imperial';
    var ftin = p.heightCm ? cmToFtIn(p.heightCm) : { ft: '', inch: '' };
    var lbs = p.weightKg ? kgToLbs(p.weightKg) : '';

    var heightInputs = imperial
      ? '<label>Height (ft)<input name="heightFt" type="number" min="3" max="7" value="' + ftin.ft + '"></label>' +
        '<label>Height (in)<input name="heightIn" type="number" min="0" max="11" value="' + ftin.inch + '"></label>'
      : '<label class="wide">Height (cm)<input name="heightCm" type="number" min="120" max="230" value="' + (p.heightCm ? Math.round(p.heightCm) : '') + '"></label>';

    var weightInput = imperial
      ? '<label class="wide">Weight (lbs)<input name="weightLbs" type="number" min="66" max="550" step="0.1" value="' + lbs + '"></label>'
      : '<label class="wide">Weight (kg)<input name="weightKg" type="number" min="30" max="250" step="0.1" value="' + (p.weightKg ? Math.round(p.weightKg * 10) / 10 : '') + '"></label>';

    var card = el('<div class="card"></div>');
    card.innerHTML =
      '<form id="pForm" class="form-grid">' +
      '<label class="wide">Name<input name="name" value="' + esc(p.name) + '" placeholder="Your name"></label>' +
      '<label>Units<select name="units">' +
        '<option value="imperial"' + (imperial ? ' selected' : '') + '>Imperial (lbs, ft/in)</option>' +
        '<option value="metric"' + (!imperial ? ' selected' : '') + '>Metric (kg, cm)</option>' +
      '</select></label>' +
      '<label>Sex<select name="sex">' +
        '<option value="female"' + (p.sex === 'female' ? ' selected' : '') + '>Female</option>' +
        '<option value="male"' + (p.sex === 'male' ? ' selected' : '') + '>Male</option>' +
        '<option value="other"' + (p.sex === 'other' ? ' selected' : '') + '>Other / prefer not to say</option>' +
      '</select></label>' +
      '<label>Age<input name="age" type="number" min="13" max="100" value="' + (p.age || '') + '"></label>' +
      heightInputs +
      weightInput +
      '<label>Activity<select name="activity">' + opts(Formulas.ACTIVITY, p.activity) + '</select></label>' +
      '<label>Goal<select name="goal">' + goalOpts(p.goal) + '</select></label>' +
      '<button class="btn primary wide" type="submit">Save profile</button>' +
      '</form>';

    // switching units re-renders the form immediately (converting current values)
    card.querySelector('select[name=units]').addEventListener('change', function (e) {
      Store.setProfile({ units: e.target.value });
      render();
    });

    card.querySelector('#pForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var units = f.units.value;
      var heightCm, weightKg;
      if (units === 'imperial') {
        heightCm = (f.heightFt.value || f.heightIn.value) ? ftInToCm(f.heightFt.value, f.heightIn.value) : null;
        weightKg = f.weightLbs.value ? lbsToKg(f.weightLbs.value) : null;
      } else {
        heightCm = num(f.heightCm.value) || null;
        weightKg = num(f.weightKg.value) || null;
      }
      Store.setProfile({
        name: f.name.value.trim(),
        units: units,
        sex: f.sex.value,
        age: num(f.age.value) || null,
        heightCm: heightCm,
        weightKg: weightKg,
        activity: f.activity.value,
        goal: f.goal.value
      });
      toast('profile saved ✓');
      render();
    });
    wrap.appendChild(card);

    // help note
    wrap.appendChild(el('<p class="muted small">uses the Mifflin–St Jeor equation for BMR, adjusted for activity and goal — these are estimates, so tune them based on real results.</p>'));

    // danger zone
    var dz = el('<div class="card danger"></div>');
    dz.innerHTML = '<h3>Reset</h3><p class="muted">Erase all data and start over. This cannot be undone.</p>' +
      '<button class="btn danger" id="resetBtn">Reset everything</button>';
    dz.querySelector('#resetBtn').addEventListener('click', function () {
      if (confirm('Delete ALL your data? This cannot be undone.')) {
        Store.resetAll(); toast('All data reset'); setView('profile');
      }
    });
    wrap.appendChild(dz);
    return wrap;
  };

  // ---- global wiring --------------------------------------------------
  tabbar.addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b) setView(b.dataset.view);
  });

  document.getElementById('settingsBtn').addEventListener('click', function () { setView('profile'); });

  document.getElementById('exportBtn').addEventListener('click', function () {
    var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'era-backup-' + Store.todayISO() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Data exported');
  });
  var importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', function () { importFile.click(); });
  importFile.addEventListener('change', function () {
    var file = importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try { Store.importJSON(reader.result); toast('Data imported ✓'); render(); }
      catch (e) { toast('Import failed — invalid file'); }
    };
    reader.readAsText(file);
    importFile.value = '';
  });

  // ---- auth + cloud boot ---------------------------------------------
  var authState = { user: null };
  // Supabase's onAuthStateChange can fire more than once — a session check
  // kicked off before autoSignIn() resolves, then a late/duplicate "no
  // session" event once a blocked or flaky network request finally settles
  // (this was a real, confirmed cause of the app opening to a stuck
  // "connecting…" screen with no tab bar: bootLocal() already showed real
  // local data, then a late null-user event blew it away). Once real
  // content is on screen, a null user should just mean "cloud's not
  // available right now" — never re-blank the UI over it.
  var booted = false;

  function showChrome(show) { tabbar.style.display = show ? '' : 'none'; }

  function bootLocal() {
    booted = true;
    showChrome(true);
    Store.ensureFoodDatabaseSeeded(); // one-time: builds your food list from existing meal history
    if (!Formulas.targets(Store.state.profile)) { setView('profile'); return; }
    setView(restoreLastView() || 'fitness');
  }

  function handleUser(user) {
    authState.user = user;
    if (!user) {
      Store.setCloudUser(null);
      if (booted) return;
      showChrome(false);
      viewEl.innerHTML = '<div class="card" style="text-align:center;margin-top:20px">connecting… ✨</div>';
      return;
    }
    Store.setCloudUser(user.id);
    showChrome(false);
    viewEl.innerHTML = '<div class="card" style="text-align:center;margin-top:20px">syncing your data… ✨</div>';
    Cloud.pull(user.id).then(function (row) {
      if (row && row.data) Store.replaceState(row.data); // cloud is source of truth
      else Store.pushNow();                              // first login: seed cloud from this device
      bootLocal();
    }).catch(function (e) {
      console.warn('cloud pull failed, using local copy', e);
      bootLocal();
    });
  }

  // boot: cloud if configured, otherwise pure local
  if (window.Cloud && Cloud.init()) {
    Cloud.onAuthChange(function (user) { setTimeout(function () { handleUser(user); }, 0); });
    Cloud.autoSignIn().then(function (session) {
      if (!session) bootLocal(); // offline or credentials rejected — don't get stuck
    });
  } else {
    bootLocal();
  }

  // expose a tiny bit of auth state for the profile view
  window.__eraAuth = authState;
})();
