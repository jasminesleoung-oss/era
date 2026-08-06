/* foods.js — pull nutrition data from USDA FoodData Central.
   Free, official, generic-food-first (Foundation/SR Legacy/Survey datasets
   are plain-language reference foods, not barcode/packaged products — that's
   the "Branded" dataset, included too so a brand name in the query still
   works, but generic entries naturally rank first for generic queries).
   Needs a free instant API key in js/config.js (ERA_CONFIG.usdaApiKey);
   search is disabled (manual entry still works) until one is set. */

var Foods = (function () {
  var ENDPOINT = 'https://api.nal.usda.gov/fdc/v1/foods/search';
  var DATA_TYPES = 'Foundation,SR Legacy,Survey (FNDDS),Branded';
  // USDA's relevance ranking puts an exact-name match first regardless of
  // dataType, so a plain search like "chicken breast" comes back as a wall
  // of random Branded packaged products (10 different grocery brands all
  // literally named "CHICKEN BREAST") before a single plain/generic entry
  // shows up. Generic (Foundation/SR Legacy/Survey) results are what a
  // home-cooked-meal search actually wants, so they're bumped to the top;
  // Branded stays available underneath for actual packaged/branded foods.
  var GENERIC_TYPES = { 'Foundation': true, 'SR Legacy': true, 'Survey (FNDDS)': true };

  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  function apiKey() {
    var cfg = window.ERA_CONFIG || {};
    return cfg.usdaApiKey || '';
  }

  function nutrientVal(nutrients, name) {
    for (var i = 0; i < nutrients.length; i++) {
      var n = nutrients[i];
      if (n.nutrientName === name && (!n.unitName || n.unitName.toUpperCase() !== 'KJ')) return num(n.value);
    }
    return 0;
  }

  // USDA rate-limits occasionally under load; retry a couple times.
  function fetchWithRetry(url, attempts) {
    attempts = attempts || 3;
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('Search failed (' + r.status + ')');
        return r.json();
      })
      .catch(function (err) {
        if (attempts <= 1) throw err;
        return new Promise(function (res) { setTimeout(res, 500); })
          .then(function () { return fetchWithRetry(url, attempts - 1); });
      });
  }

  // returns a Promise resolving to an array of {name, brand, per100:{cal,protein,carbs,fat}}
  function search(query) {
    var key = apiKey();
    if (!key) return Promise.reject(new Error('USDA FoodData Central API key not configured'));

    var url = ENDPOINT +
      '?api_key=' + encodeURIComponent(key) +
      '&query=' + encodeURIComponent(query) +
      '&dataType=' + encodeURIComponent(DATA_TYPES) +
      '&pageSize=30';

    return fetchWithRetry(url, 3)
      .then(function (data) {
        var foods = (data && data.foods) || [];
        var out = [];
        foods.forEach(function (f) {
          var nutrients = f.foodNutrients || [];
          var cal = nutrientVal(nutrients, 'Energy');
          if (!f.description || !cal) return; // skip empties
          out.push({
            name: f.description,
            brand: f.brandOwner || f.brandName || '',
            generic: !!GENERIC_TYPES[f.dataType],
            per100: {
              cal: Math.round(cal),
              protein: Math.round(nutrientVal(nutrients, 'Protein')),
              carbs: Math.round(nutrientVal(nutrients, 'Carbohydrate, by difference')),
              fat: Math.round(nutrientVal(nutrients, 'Total lipid (fat)'))
            }
          });
        });
        // generic (plain/home-cooked) foods first, branded packaged
        // products after — see GENERIC_TYPES comment above. Array#sort is
        // stable in every engine this app runs on, so USDA's own relevance
        // order survives within each group.
        out.sort(function (a, b) { return (b.generic ? 1 : 0) - (a.generic ? 1 : 0); });
        // de-dupe by name+brand, cap at 10
        var seen = {}, deduped = [];
        out.forEach(function (f) {
          var k = (f.name + '|' + f.brand).toLowerCase();
          if (seen[k]) return; seen[k] = true; deduped.push(f);
        });
        return deduped.slice(0, 10);
      });
  }

  // scale per-100g values to a portion in grams
  function scale(per100, grams) {
    var f = (num(grams) || 0) / 100;
    return {
      calories: Math.round(per100.cal * f),
      protein: Math.round(per100.protein * f),
      carbs: Math.round(per100.carbs * f),
      fat: Math.round(per100.fat * f)
    };
  }

  return { search: search, scale: scale };
})();
