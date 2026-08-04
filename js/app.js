/* app.js — UI rendering, navigation, and event wiring. Vanilla DOM. */

(function () {
  var viewEl = document.getElementById('view');
  var tabbar = document.getElementById('tabbar');
  var pointsValue = document.getElementById('pointsValue');
  var toastEl = document.getElementById('toast');
  var current = 'dashboard';
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

  var BOW = '<svg class="bow" viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path class="ink" d="M31 27 L23 51 L27 46.5 L29.5 52 L33 30 Z"/>' +
    '<path class="ink" d="M33 27 L41 51 L37 46.5 L34.5 52 L31 30 Z"/>' +
    '<path class="ink" d="M30 22 C20 11 7 13 7 21 C7 30 20 34 30 26 Z"/>' +
    '<path class="ink" d="M34 22 C44 11 57 13 57 21 C57 30 44 34 34 26 Z"/>' +
    '<rect class="ink" x="28.5" y="19" width="7" height="10" rx="3"/>' +
    '<ellipse class="shine" cx="17" cy="18" rx="6" ry="2.6"/>' +
    '<ellipse class="shine" cx="47" cy="18" rx="6" ry="2.6"/>' +
    '<path class="sparkle sp1" d="M53 4 L54 9 L59 10 L54 11 L53 16 L52 11 L47 10 L52 9 Z"/>' +
    '<path class="sparkle sp2" d="M11 9 L11.7 12 L15 12.7 L11.7 13.4 L11 16.4 L10.3 13.4 L7 12.7 L10.3 12 Z"/>' +
    '<path class="sparkle sp3" d="M18 43 L18.6 45.4 L21 46 L18.6 46.6 L18 49 L17.4 46.6 L15 46 L17.4 45.4 Z"/>' +
    '</svg>';

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

  function refreshPoints() {
    var p = Store.pointsTotal();
    pointsValue.textContent = p.toLocaleString();
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
    refreshPoints();
    var fn = views[current] || views.dashboard;
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
  // editing state for the Home log forms — reset at the top of every
  // views.dashboard() call so it never leaks across a full re-render.
  var editingWorkoutId = null;
  var editingMealId = null;

  function workoutFormHTML(presetType) {
    var opts = WORKOUT_TYPES.map(function (t) {
      return '<option' + (t === presetType ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
    return '<h3 style="margin-top:2px">add a workout</h3>' +
      '<form id="wForm" class="form-grid">' +
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
    // the same as manual entry always did.
    return '<h3 style="margin-top:2px">add food</h3>' +
      '<div id="recentWrap"></div>' +
      '<div class="search-row">' +
        '<input name="name" form="mForm" id="foodSearch" placeholder="e.g. chicken & rice bowl — or search a food…" autocomplete="off" required>' +
        '<button class="btn primary" id="foodSearchBtn" type="button">search</button>' +
      '</div>' +
      '<div class="search-hint">pulls macros from USDA FoodData Central — or fill in calories yourself below. 🔎</div>' +
      '<ul class="results" id="results"></ul>' +
      '<div id="pickedBanner"></div>' +
      '<form id="mForm" class="form-grid">' +
      '<label>portion (g)<input name="grams" type="number" min="1" placeholder="e.g. 200"></label>' +
      '<label>calories<input name="calories" type="number" min="0" required></label>' +
      '<label>protein (g)<input name="protein" type="number" min="0" value="0"></label>' +
      '<label>carbs (g)<input name="carbs" type="number" min="0" value="0"></label>' +
      '<label>fat (g)<input name="fat" type="number" min="0" value="0"></label>' +
      '<button class="btn primary wide" type="submit">log food</button>' +
      '</form>';
  }

  // wires the food-search + recent-chips + submit behavior for a food form
  // that's already in the DOM (possibly hidden) inside `card`.
  function wireFoodForm(card, onDone) {
    var selectedPer100 = null;
    var resultsEl = card.querySelector('#results');
    var bannerEl = card.querySelector('#pickedBanner');
    var searchInput = card.querySelector('#foodSearch');
    var mForm = card.querySelector('#mForm');

    function fillFromMeal(m) {
      selectedPer100 = null;
      mForm.name.value = m.name;
      mForm.grams.value = '';
      mForm.calories.value = num(m.calories) || '';
      mForm.protein.value = num(m.protein) || 0;
      mForm.carbs.value = num(m.carbs) || 0;
      mForm.fat.value = num(m.fat) || 0;
      bannerEl.innerHTML = '';
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
        chip.addEventListener('click', function () { fillFromMeal(m); });
        row.appendChild(chip);
      });
      wrapR.appendChild(row);
    })();

    function applyPortion() {
      if (!selectedPer100) return;
      var g = num(mForm.grams.value) || 0;
      var s = Foods.scale(selectedPer100, g);
      mForm.calories.value = s.calories;
      mForm.protein.value = s.protein;
      mForm.carbs.value = s.carbs;
      mForm.fat.value = s.fat;
    }
    mForm.grams.addEventListener('input', applyPortion);

    function pickFood(f) {
      selectedPer100 = f.per100;
      mForm.name.value = f.brand ? f.name + ' (' + f.brand + ')' : f.name;
      mForm.grams.value = 100;
      applyPortion();
      bannerEl.innerHTML = '<div class="picked-banner"><span>✨ scaling <strong>' +
        esc(f.name) + '</strong> — set your portion in grams above.</span></div>';
      resultsEl.innerHTML = '';
    }

    function runSearch() {
      var q = searchInput.value.trim();
      if (!q) return;
      resultsEl.innerHTML = '<li class="searching">searching the internet… 🌐</li>';
      Foods.search(q).then(function (list) {
        if (!list.length) {
          resultsEl.innerHTML = '<li class="searching">no matches — type it in manually below. 👇</li>';
          return;
        }
        resultsEl.innerHTML = '';
        list.forEach(function (f) {
          var li = el('<li><span><span class="result-name">' + esc(f.name) + '</span>' +
            (f.brand ? ' <span class="result-brand">· ' + esc(f.brand) + '</span>' : '') +
            '</span><span class="result-macros">' + f.per100.cal + ' kcal · ' + f.per100.protein +
            'g P <span class="muted">/100g</span></span></li>');
          li.addEventListener('click', function () { pickFood(f); });
          resultsEl.appendChild(li);
        });
      }).catch(function () {
        resultsEl.innerHTML = '<li class="searching">couldn’t reach the food database — check your connection or type it in manually. 🔌</li>';
      });
    }
    card.querySelector('#foodSearchBtn').addEventListener('click', runSearch);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    });

    mForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var data = {
        name: f.name.value.trim(),
        calories: num(f.calories.value),
        protein: num(f.protein.value),
        carbs: num(f.carbs.value),
        fat: num(f.fat.value)
      };
      if (editingMealId) {
        Store.updateMeal(editingMealId, data);
        toast('food updated ✓');
        editingMealId = null;
      } else {
        data.date = Store.todayISO();
        Store.addMeal(data);
        toast('fed & thriving 😌');
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
        notes: f.notes.value.trim()
      };
      if (editingWorkoutId) {
        Store.updateWorkout(editingWorkoutId, data);
        toast('workout updated ✓');
        editingWorkoutId = null;
      } else {
        data.date = Store.todayISO();
        var pts = Store.addWorkout(data);
        toast('logged it, that girl behavior 💪 +' + pts + ' pts');
      }
      onDone();
    });
  }

  views.dashboard = function () {
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
    lineupCard.appendChild(el('<button class="link-btn" id="openExercises">📈 track your exercise numbers</button>'));
    lineupCard.querySelector('#openExercises').addEventListener('click', function () { setView('exercises'); });

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
    var restToday = Store.isRestDay(today);
    var restLi = el('<li class="lineup-row' + (restToday ? ' done' : '') + '">' +
      '<button class="lineup-check rest-check" title="toggle rest day">' + (restToday ? '✓' : '○') + '</button>' +
      '<div class="lineup-mid"><div class="lineup-label">😴 rest day' +
      (restToday ? '<span class="muted small"> — taken ✓</span>' : '') + '</div></div></li>');
    restLi.querySelector('.rest-check').addEventListener('click', function () {
      Store.toggleRestDay(today);
      render();
    });
    lineupList.appendChild(restLi);
    lineupCard.appendChild(lineupList);

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
      f.name.value = m.name || '';
      f.grams.value = '';
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
    function wireDraft(kind, formWrap, formSelector, fieldNames, editingIdGetter, editingIdSetter) {
      var form = formWrap.querySelector(formSelector);
      // scoped to formWrap (not the <form>) and by plain attribute selector,
      // not form[name] — some fields (like the food search box) live outside
      // the <form> tag itself, linked via form="", and that cross-element
      // association doesn't reliably resolve while the tree is still
      // detached (i.e. exactly when this runs, before render() inserts it).
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
      form.addEventListener('input', save);
      var draft = loadFormDraft(kind);
      if (draft) {
        editingIdSetter(draft.editingId || null);
        formWrap.querySelector('button[type=submit]').textContent = draft.submitLabel || formWrap.querySelector('button[type=submit]').textContent;
        fieldNames.forEach(function (n) { var f = fieldEl(n); if (f && draft.fields[n] != null) f.value = draft.fields[n]; });
        formWrap.style.display = 'block';
      }
    }
    wireDraft('workout', wFormWrap, '#wForm', ['name', 'type', 'durationMin', 'intensity', 'notes'],
      function () { return editingWorkoutId; }, function (v) { editingWorkoutId = v; });
    wireDraft('food', mFormWrap, '#mForm', ['name', 'grams', 'calories', 'protein', 'carbs', 'fat'],
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

  // consecutive days (ending today) where `days[iso]` is true
  function consecutiveStreak(days) {
    var streak = 0;
    var d = new Date(Store.todayISO() + 'T00:00:00');
    while (true) {
      var iso = d.toISOString().slice(0, 10);
      if (days[iso]) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return streak;
  }

  function streakCard() {
    var workoutDays = {};
    Store.state.workouts.forEach(function (w) { workoutDays[w.date] = true; });
    var workoutStreak = consecutiveStreak(workoutDays);

    // food streak: calories landed on target, not just "something logged" —
    // same 0.9–1.1x band as the daily calorie bonus, so "on track" means one
    // consistent thing app-wide.
    var foodDays = {};
    var t = Formulas.targets(Store.state.profile);
    if (t) {
      var calByDay = {};
      Store.state.meals.forEach(function (m) {
        calByDay[m.date] = (calByDay[m.date] || 0) + (Number(m.calories) || 0);
      });
      Object.keys(calByDay).forEach(function (date) {
        var cal = calByDay[date];
        if (cal >= t.calories * 0.9 && cal <= t.calories * 1.1) foodDays[date] = true;
      });
    }
    var foodStreak = consecutiveStreak(foodDays);

    function block(streak, label) {
      return '<div class="streak-block">' +
        '<div class="streak-num' + (streak > 0 ? ' lit' : '') + '">' + streak + '</div>' +
        '<div class="muted small">' + label + (streak === 1 ? '' : 's') + '</div></div>';
    }

    var c = el('<div class="card"></div>');
    c.innerHTML = '<h3>streak check 🔥</h3><div class="streak-split">' +
      block(workoutStreak, 'fit day') +
      block(foodStreak, 'fuel day') +
      '</div>';
    return c;
  }

  // ==== POINTS HISTORY (full ledger, reached by tapping the points badge —
  // not a tab. Same pointsLog powers both earning and spending entries.) ====
  views.pointsHistory = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<button class="link-btn back-link" id="phBack">← back to home</button>'));
    wrap.appendChild(el('<div class="hello"><h1>points history ✦</h1>' +
      '<p class="muted">everywhere you’ve earned (and spent) points</p></div>'));
    wrap.querySelector('#phBack').addEventListener('click', function () { setView('dashboard'); });

    var log = Store.state.pointsLog.slice().sort(function (a, b) {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.id.localeCompare(a.id);
    });

    var card = el('<div class="card"></div>');
    if (!log.length) {
      card.appendChild(el('<p class="muted">no points yet — go earn some ✨</p>'));
    } else {
      var ul = el('<ul class="entry-list"></ul>');
      log.forEach(function (e) {
        var positive = e.delta >= 0;
        var li = el('<li><span class="entry-main">' + esc(e.reason) + '</span>' +
          '<span class="muted small">' + prettyDate(e.date) + '</span>' +
          '<span class="pill' + (positive ? '' : ' spent') + '">' + (positive ? '+' : '') + e.delta + '</span></li>');
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    wrap.appendChild(card);

    return wrap;
  };

  // ==== EXERCISE TRACKER (per-exercise progress log, reached via a link on
  // the Home lineup card — not a tab. One flat list, since real exercises
  // span multiple lineup categories. Purely a reference log, no points.) ====
  views.exercises = function () {
    var wrap = el('<section class="stack"></section>');

    wrap.appendChild(el('<button class="link-btn back-link" id="exBack">← back to home</button>'));
    wrap.appendChild(el('<div class="hello"><h1>exercise tracker 🏋️</h1>' +
      '<p class="muted">your numbers, so you don’t need a notes app ✍️</p></div>'));
    wrap.querySelector('#exBack').addEventListener('click', function () { setView('dashboard'); });

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
          toast('logged ✨');
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

  // ==== QUESTS =======================================================
  function deadlineTag(deadline) {
    if (!deadline) return '';
    var days = Formulas.daysUntil(deadline);
    var label, cls;
    if (days < 0) { label = 'overdue ' + Math.abs(days) + 'd 💀 no judgment but do it'; cls = 'over'; }
    else if (days === 0) { label = 'due today 🚨'; cls = 'urgent'; }
    else if (days === 1) { label = 'due tomorrow ⏰'; cls = 'urgent'; }
    else if (days <= 3) { label = days + 'd left — crunch time ⏰'; cls = 'soon'; }
    else {
      label = 'due ' + new Date(deadline + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
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
    wrap.appendChild(el('<div class="hello"><h1>quests ' + BOW + '</h1>' +
      '<p class="muted">health quests pay more than side quests — the more you’re dreading it, the bigger the payout 💰</p></div>'));

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
        '<div class="wide" id="oneoffFields"><label class="wide">deadline (optional)<input name="deadline" type="date"></label></div>' +
        '<div class="wide form-grid" id="recurringFields" style="display:none;padding:0">' +
          '<label>how often<select name="freq">' +
            FREQ_OPTIONS.map(function (f) { return '<option value="' + f.value + '">' + f.label + '</option>'; }).join('') +
          '</select></label>' +
          '<label>ends by<input name="endDate" type="date"></label>' +
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
        var pts = a.points > 0 ? Formulas.questPoints(a.key, selectedType) : 0;
        var worth = pts > 0 ? '✦ ' + pts : '🔔';
        var b = el('<button type="button" class="annoyance-btn' + (a.key === selectedLevel ? ' active' : '') +
          (a.points === 0 ? ' reminder-tile' : '') +
          '"><span>' + esc(a.label) + '</span><span class="worth">' + worth + '</span></button>');
        b.addEventListener('click', function () { selectedLevel = a.key; renderGrid(); updatePreview(); });
        annGrid.appendChild(b);
      });
    }
    function updatePreview() {
      if (!selectedLevel) {
        preview.innerHTML = 'just a nudge — no points attached 🔔';
        return;
      }
      if (selectedKind === 'oneoff') {
        preview.innerHTML = 'worth <strong>✦ ' + Formulas.questPoints(selectedLevel, selectedType) + '</strong> when you handle it 💪';
      } else {
        var bonusWhen = selectedFreq === 'daily' ? 'every 7-day streak' : 'every week you hit ' + selectedFreq + 'x';
        preview.innerHTML = 'worth <strong>✦ ' + Formulas.microPoints(selectedLevel, selectedType) + '</strong> per check-in + ' +
          '<strong>✦ ' + Formulas.questPoints(selectedLevel, selectedType) + '</strong> bonus ' + bonusWhen + ' 🔥';
      }
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
      var pillHTML = q.points > 0 ? '<span class="pill">✦ ' + q.points + '</span>' : '<span class="pill reminder">🔔</span>';
      var li = el('<li class="quest-item' + (q.done ? ' done' : '') + '">' +
        '<button class="quest-check" title="mark done">✓</button>' +
        '<div class="quest-mid"><div class="quest-name">' + esc(q.name) + '</div>' +
        '<div class="quest-vibe">' + (q.done ? '' : deadlineTag(q.deadline)) + '</div></div>' +
        '<div class="quest-actions">' + pillHTML +
        '<button class="icon-btn" title="edit">✏️</button>' +
        '<button class="icon-btn del" title="delete">✕</button></div></li>');
      li.querySelector('.quest-check').addEventListener('click', function () {
        var nowDone = Store.toggleQuest(q.id);
        var doneMsg = q.points > 0 ? 'handled it 💅 +' + q.points + ' pts' : 'done ✓';
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
        : deadlineTag(q.endDate);
      var checkinTitle = finished ? 'period ended' : (doneToday ? 'done today' : 'check in');
      var checkinClass = finished ? 'finished' : (doneToday ? 'done-today' : 'primary');
      var li = el('<li class="quest-item recurring">' +
        '<span class="streak-badge">' + (streak > 0 ? '🔥' : '🎯') + '</span>' +
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
          var pts = Store.checkInQuest(q.id);
          toast(pts > 0 ? ('checked in ✨ +' + pts + ' pts') : 'checked in ✨');
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

  // ==== REWARDS ========================================================
  views.rewards = function () {
    var wrap = el('<section class="stack"></section>');
    var pts = Store.pointsTotal();
    var editingRewardId = null;
    wrap.appendChild(el('<div class="hello"><h1>the treat shop 🛍️</h1>' +
      '<p class="muted">you’ve got <strong>' + pts.toLocaleString() + '</strong> pts to blow 💸</p></div>'));

    // add / edit reward (declared first so editReward() can reference it)
    var addCard = el('<div class="card"></div>');
    addCard.innerHTML =
      '<h3 id="rewardFormTitle">Add a reward</h3>' +
      '<form id="rForm" class="form-grid">' +
      '<label class="wide">Reward<input name="name" placeholder="e.g. New running shoes" required></label>' +
      '<label>Cost (points)<input name="cost" type="number" min="1" value="1000" required></label>' +
      '<button class="btn primary wide" type="submit" id="rSubmit">Add reward</button>' +
      '<button type="button" class="btn small" id="rCancel" style="display:none">cancel edit</button>' +
      '</form>';
    var rForm = addCard.querySelector('#rForm');
    var rTitle = addCard.querySelector('#rewardFormTitle');
    var rSubmit = addCard.querySelector('#rSubmit');
    var rCancel = addCard.querySelector('#rCancel');
    rForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = ev.target.name.value.trim();
      var cost = ev.target.cost.value;
      if (editingRewardId) {
        Store.updateReward(editingRewardId, { name: name, cost: cost });
        toast('reward updated ✓');
      } else {
        Store.addReward(name, cost);
        toast('Reward added');
      }
      render();
    });
    rCancel.addEventListener('click', function () {
      editingRewardId = null;
      rForm.reset();
      rTitle.textContent = 'Add a reward';
      rSubmit.textContent = 'Add reward';
      rCancel.style.display = 'none';
    });
    function editReward(r) {
      editingRewardId = r.id;
      rForm.name.value = r.name;
      rForm.cost.value = r.cost;
      rTitle.textContent = 'Edit reward';
      rSubmit.textContent = 'save changes';
      rCancel.style.display = '';
      addCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    var grid = el('<div class="reward-grid"></div>');
    Store.state.rewards.forEach(function (r) {
      var affordable = pts >= r.cost;
      var card = el('<div class="reward' + (affordable ? ' affordable' : '') + '"></div>');
      card.innerHTML =
        (affordable ? '<span class="reward-bow">' + BOW.replace('class="bow"', 'class="bow bow-pink"') + '</span>' : '') +
        '<div class="reward-cost">✦ ' + r.cost.toLocaleString() + '</div>' +
        '<div class="reward-name">' + esc(r.name) + '</div>' +
        '<div class="reward-actions">' +
          '<button class="btn small primary redeem" ' + (affordable ? '' : 'disabled') + '>Redeem</button>' +
          '<button class="icon-btn" title="Edit reward">✏️</button>' +
          '<button class="icon-btn del" title="Remove reward">✕</button>' +
        '</div>';
      card.querySelector('.redeem').addEventListener('click', function () {
        var res = Store.redeemReward(r.id);
        toast(res.msg);
        render();
      });
      card.querySelector('[title="Edit reward"]').addEventListener('click', function () { editReward(r); });
      card.querySelector('.del').addEventListener('click', function () {
        if (confirm('Remove “' + r.name + '” from your rewards?')) { Store.deleteReward(r.id); render(); }
      });
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    wrap.appendChild(addCard);

    // redemption history
    if (Store.state.redemptions.length) {
      var hist = el('<div class="card"></div>');
      hist.appendChild(el('<h3>Redeemed</h3>'));
      var ul = el('<ul class="mini-list"></ul>');
      Store.state.redemptions.slice().reverse().forEach(function (x) {
        ul.appendChild(el('<li><span>' + esc(x.name) + ' · ' + prettyDate(x.date) + '</span>' +
          '<span class="pill">−' + x.cost.toLocaleString() + '</span></li>'));
      });
      hist.appendChild(ul);
      wrap.appendChild(hist);
    }
    return wrap;
  };

  // ==== YOU (vibe check + cycle tracker) ================================
  var VIBES = [
    { level: 1, emoji: '😩', label: 'rough' },
    { level: 2, emoji: '😕', label: 'meh' },
    { level: 3, emoji: '😐', label: 'okay' },
    { level: 4, emoji: '🙂', label: 'good' },
    { level: 5, emoji: '😄', label: 'great' }
  ];
  var WEEKDAY_LABELS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  views.you = function () {
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(el('<div class="hello"><h1>you 🎀</h1><p class="muted">quick check-ins, just for you ✨</p></div>'));

    // ---- vibe check ----
    var todayLevel = Store.vibeToday();
    var vibeCard = el('<div class="card"></div>');
    vibeCard.appendChild(el('<h3>vibe check 🌈</h3>'));
    var vibeGrid = el('<div class="vibe-grid"></div>');
    VIBES.forEach(function (v) {
      var b = el('<button type="button" class="vibe-btn' + (todayLevel === v.level ? ' active' : '') + '">' +
        '<span class="vibe-emoji">' + v.emoji + '</span><span class="vibe-label">' + v.label + '</span></button>');
      b.addEventListener('click', function () {
        var alreadyLoggedToday = Store.vibeToday() !== null;
        var bonus = Store.logVibe(v.level);
        if (alreadyLoggedToday) toast('updated ✨');
        else if (bonus > 0) toast('logged ✨ +' + bonus + ' pts — 7 day streak 🔥');
        else toast('logged ✨');
        render();
      });
      vibeGrid.appendChild(b);
    });
    vibeCard.appendChild(vibeGrid);

    var weekday = Store.vibeByWeekday();
    var loggedCount = Store.state.vibes.length;
    var insightsFold = el('<details class="fold" style="margin-top:14px"></details>');
    var chartHTML;
    if (loggedCount < 5) {
      chartHTML = '<p class="muted small" style="margin-top:12px">log a few more vibe checks to unlock ✨</p>';
    } else {
      chartHTML = '<div class="weekday-chart">' + weekday.map(function (avg, i) {
        var pct = avg ? Math.round((avg / 5) * 100) : 4;
        return '<div class="wd-col"><div class="wd-bar-track"><div class="wd-bar" style="height:' + pct + '%"></div></div>' +
          '<div class="wd-label">' + WEEKDAY_LABELS[i] + '</div></div>';
      }).join('') + '</div>';
    }
    insightsFold.innerHTML = '<summary>insights 📊</summary><div class="fold-body">' + chartHTML + '</div>';
    vibeCard.appendChild(insightsFold);
    wrap.appendChild(vibeCard);

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
        '<label>start date<input name="start" type="date" required value="' + today + '"></label>' +
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
        lines.push('log your next period to start seeing average cycle length');
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

  document.getElementById('pointsBadge').addEventListener('click', function () { setView('pointsHistory'); });
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

  function showChrome(show) { tabbar.style.display = show ? '' : 'none'; }

  function bootLocal() {
    showChrome(true);
    Store.ensureRewardPack(); // one-time top-up of the expanded rewards lineup
    Store.save(); // reconcile bonuses once
    if (!Formulas.targets(Store.state.profile)) { setView('profile'); return; }
    setView(restoreLastView() || 'dashboard');
  }

  function handleUser(user) {
    authState.user = user;
    if (!user) {
      Store.setCloudUser(null);
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
