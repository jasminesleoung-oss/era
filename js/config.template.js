/* config.js — paste your Supabase project details here to turn on cloud sync.
   Both values are SAFE to expose in the browser: the anon key is public by
   design and is protected by Row Level Security (see SETUP.md).

   Leave them blank ('') and the app runs 100% local, exactly like before.

   Copy this file to config.js and fill in your real values.
   config.js is gitignored — it never gets committed. */

var ERA_CONFIG = {
  supabaseUrl: 'YOUR_SUPABASE_URL_HERE',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY_HERE',

  // Single-user app: these sign the app in automatically on every load,
  // so there's never a login screen. Safe only because RLS ties all data
  // access to this exact account — see SETUP.md.
  supabaseEmail: 'YOUR_SUPABASE_EMAIL_HERE',
  supabasePassword: 'YOUR_SUPABASE_PASSWORD_HERE',

  // Free instant API key from https://fdc.nal.usda.gov/api-key-signup.html
  // — powers food search (USDA FoodData Central). Blank = search disabled,
  // you can still type macros in manually.
  usdaApiKey: 'YOUR_USDA_API_KEY_HERE'
};
