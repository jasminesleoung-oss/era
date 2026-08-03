/* formulas.js — pure, offline nutrition & points math.
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

  // ---- Points economy -------------------------------------------------
  // Flat tiers by duration — a round, predictable number instead of a
  // base + per-5-min + intensity-bonus formula you had to add up in your head.
  function workoutPoints(durationMin) {
    var d = Math.max(0, Number(durationMin) || 0);
    if (d <= 20) return 15;
    if (d <= 40) return 30;
    if (d <= 60) return 45;
    return 60;
  }

  var DAILY_PROTEIN_BONUS = 25;
  var DAILY_CALORIE_BONUS = 25;
  var VIBE_STREAK_BONUS = 50; // awarded once per 7-day consecutive vibe check-in streak, not per log

  // ---- Quests: the more you're dreading it, the bigger the payout ----
  // health quests (medical/wellness upkeep) pay full; side quests (general
  // life admin/organization) pay a reduced rate — both count, health counts more.
  var ANNOYANCE = [
    { key: 1, label: 'lowkey easy 😌',        points: 100 },
    { key: 2, label: 'kinda annoying 🙄',     points: 250 },
    { key: 3, label: 'actual chore 😮‍💨',      points: 500 },
    { key: 4, label: 'been dreading it 😰',   points: 900 },
    { key: 5, label: 'kicking & screaming 😭', points: 1500 },
    { key: 0, label: 'just a reminder 🔔',    points: 0 }
  ];
  var QUEST_TYPE_MULT = { health: 1, side: 0.6 };
  function questPoints(level, type) {
    var base = 250;
    for (var i = 0; i < ANNOYANCE.length; i++) if (ANNOYANCE[i].key === Number(level)) base = ANNOYANCE[i].points;
    var mult = QUEST_TYPE_MULT[type] != null ? QUEST_TYPE_MULT[type] : 1;
    return Math.round((base * mult) / 10) * 10;
  }

  // recurring quests pay a small amount per check-in (full quest value / 10)
  // plus a full-size bonus every time a streak milestone is hit.
  function microPoints(level, type) {
    return Math.max(5, Math.round(questPoints(level, type) / 10));
  }

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
    QUEST_TYPE_MULT: QUEST_TYPE_MULT,
    bmr: bmr,
    targets: targets,
    workoutPoints: workoutPoints,
    questPoints: questPoints,
    microPoints: microPoints,
    daysUntil: daysUntil,
    DAILY_PROTEIN_BONUS: DAILY_PROTEIN_BONUS,
    DAILY_CALORIE_BONUS: DAILY_CALORIE_BONUS,
    VIBE_STREAK_BONUS: VIBE_STREAK_BONUS
  };
})();
