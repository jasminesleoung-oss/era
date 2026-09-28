/* formulas.js — pure, offline nutrition math.
   Everything here is a plain function with no side effects. */

var Formulas = (function () {
  // Activity multipliers applied to BMR to estimate maintenance calories (TDEE).
  var ACTIVITY = {
    sedentary:   { mult: 1.20, label: 'Sedentary (little/no exercise)' },
    light:       { mult: 1.375, label: 'Light (1–3 days/week)' },
    moderate:    { mult: 1.55, label: 'Moderate (3–5 days/week)' },
    active:      { mult: 1.725, label: 'Active (6–7 days/week)' },
    very_active: { mult: 1.90, label: 'Very active (physical job / 2x day)' }
  };

  var GOALS = {
    lose:     { label: 'Lose weight, tone & strengthen', calAdjust: -500, proteinPerKg: 2.0 },
    maintain: { label: 'Maintain & nourish',             calAdjust: 0,    proteinPerKg: 1.8 },
    gain:     { label: 'Build strength',                 calAdjust: 350,  proteinPerKg: 2.0 }
  };

  // Hard floor on the daily calorie target — never prescribe below your BMR
  // (or an absolute 1200 minimum), so a deficit can't become under-eating.
  function calorieFloor(bmrVal) {
    return Math.max(1200, Math.round(bmrVal));
  }

  // Mifflin–St Jeor Basal Metabolic Rate.
  function bmr(sex, weightKg, heightCm, age) {
    var base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    if (sex === 'male') return base + 5;
    if (sex === 'female') return base - 161;
    return base - 78; // average of the two constants for unspecified/other
  }

  // Given a full profile, return daily targets.
  function targets(profile) {
    if (!profile || !profile.weightKg || !profile.heightCm || !profile.age) return null;
    var b = bmr(profile.sex, profile.weightKg, profile.heightCm, profile.age);
    var act = ACTIVITY[profile.activity] || ACTIVITY.moderate;
    var tdee = b * act.mult;
    var goal = GOALS[profile.goal] || GOALS.maintain;
    var raw = Math.round((tdee + goal.calAdjust) / 10) * 10;
    var floor = calorieFloor(b);
    var floored = raw < floor;               // deficit would dip below the safe floor
    var calories = Math.max(raw, floor);

    var protein = Math.round(profile.weightKg * goal.proteinPerKg); // grams
    var fat = Math.round((calories * 0.25) / 9);                    // 25% of kcal
    var proteinCals = protein * 4;
    var fatCals = fat * 9;
    var carbs = Math.max(0, Math.round((calories - proteinCals - fatCals) / 4));

    return {
      bmr: Math.round(b),
      tdee: Math.round(tdee),
      calories: calories,
      minCalories: floor,
      floored: floored,
      protein: protein,
      carbs: carbs,
      fat: fat,
      goalLabel: goal.label,
      activityLabel: act.label
    };
  }

  // ---- Quests: just a "how much are you dreading it" flavor rating now —
  // no point payout attached, task lists don't need a currency. ----
  var ANNOYANCE = [
    { key: 1, label: 'lowkey easy 😌' },
    { key: 2, label: 'kinda annoying 🙄' },
    { key: 3, label: 'actual chore 😮‍💨' },
    { key: 4, label: 'been dreading it 😰' },
    { key: 5, label: 'kicking & screaming 😭' },
    { key: 0, label: 'just a reminder 🔔' }
  ];

  // ---- Quest deadline urgency (for funny warning copy) ----
  function daysUntil(deadlineISO) {
    if (!deadlineISO) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var due = new Date(deadlineISO + 'T00:00:00');
    return Math.round((due - today) / 86400000);
  }

  return {
    ACTIVITY: ACTIVITY,
    GOALS: GOALS,
    ANNOYANCE: ANNOYANCE,
    bmr: bmr,
    targets: targets,
    daysUntil: daysUntil
  };
})();
