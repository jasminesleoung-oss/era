/* plans.js — the weekly workout lineup: a fixed set of 6 movement slots
   (+1 implied rest day) that can be filled in any order, by any matching
   workout type. Not a day-by-day schedule — just "hit these once each". */

var Plans = (function () {
  var WEEK_SLOTS = [
    { id: 'full', label: 'full-body strength', emoji: '💪', preset: 'Strength (Full-body)',
      detail: 'Squat, push, pull, hinge — 3×8–10. ~40 min. F45 resistance counts too.',
      match: function (t) { return t === 'Strength (Full-body)' || t === 'F45 – Resistance'; } },
    { id: 'zone2', label: 'zone-2 cardio', emoji: '🏃‍♀️', preset: 'Running/Spin',
      detail: 'Run, spin, or F45 cardio — conversational pace. 30–45 min.',
      match: function (t) { return t === 'Running/Spin' || t === 'F45 – Cardio' || t === 'Cardio'; } },
    { id: 'upper', label: 'upper-body + core', emoji: '🙌', preset: 'Strength (Upper+Core)',
      detail: 'Press, row, curl, plank circuit. ~40 min.',
      match: function (t) { return t === 'Strength (Upper+Core)'; } },
    { id: 'hiit', label: 'HIIT intervals', emoji: '⚡', preset: 'HIIT',
      detail: '30s hard / 90s easy × 8 rounds. ~25 min total.',
      match: function (t) { return t === 'HIIT'; } },
    { id: 'lower', label: 'lower-body strength', emoji: '🦵', preset: 'Strength (Lower-body)',
      detail: 'Deadlift, lunge, glute bridge — 3×10. ~40 min.',
      match: function (t) { return t === 'Strength (Lower-body)'; } },
    { id: 'flex', label: 'flex day — your call', emoji: '🎲', preset: 'Strength (Full-body)',
      detail: 'Whatever you’re feeling — extra resistance, cardio, or another F45 class.',
      match: function (t) {
        return ['Strength (Full-body)', 'Strength (Upper+Core)', 'Strength (Lower-body)',
          'F45 – Resistance', 'F45 – Cardio', 'Running/Spin', 'Cardio', 'HIIT'].indexOf(t) !== -1;
      } }
  ];

  // Greedily assigns each workout (earliest first) to the first unfilled
  // slot it matches, so extra sessions of an already-filled type spill
  // over into the flex slot instead of being wasted.
  function fillWeekSlots(workouts) {
    var sorted = workouts.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var filled = {};
    sorted.forEach(function (w) {
      for (var i = 0; i < WEEK_SLOTS.length; i++) {
        var slot = WEEK_SLOTS[i];
        if (!filled[slot.id] && slot.match(w.type)) { filled[slot.id] = w; break; }
      }
    });
    return WEEK_SLOTS.map(function (slot) {
      return { id: slot.id, label: slot.label, emoji: slot.emoji, preset: slot.preset, detail: slot.detail, workout: filled[slot.id] || null };
    });
  }

  return { WEEK_SLOTS: WEEK_SLOTS, fillWeekSlots: fillWeekSlots };
})();
