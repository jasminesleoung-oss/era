/* cloud.js — optional Supabase cloud sync + email auth.
   Loaded after the Supabase CDN script. If config is blank or the CDN
   didn't load, everything here reports "disabled" and the app stays local. */

var Cloud = (function () {
  var client = null;
  var TABLE = 'era_state';

  function enabled() {
    return !!(client);
  }

  function init() {
    var cfg = window.ERA_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return false;         // not configured
    if (!window.supabase || !window.supabase.createClient) return false; // CDN missing
    try {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return true;
    } catch (e) {
      console.warn('Supabase init failed — running local only.', e);
      client = null;
      return false;
    }
  }

  // ---- auth -----------------------------------------------------------
  // Single-user app: sign in with the baked-in credentials if there's no
  // session yet, so the app never shows a login screen.
  function autoSignIn() {
    var cfg = window.ERA_CONFIG || {};
    if (!cfg.supabaseEmail || !cfg.supabasePassword) return Promise.resolve(null);
    return client.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return r.data.session;
      return client.auth.signInWithPassword({
        email: cfg.supabaseEmail,
        password: cfg.supabasePassword
      }).then(function (res) {
        if (res.error) console.warn('auto sign-in failed — using local data', res.error.message);
        return res.data ? res.data.session : null;
      });
    });
  }

  function signUp(email, password) {
    return client.auth.signUp({ email: email, password: password });
  }
  function signIn(email, password) {
    return client.auth.signInWithPassword({ email: email, password: password });
  }
  function signOut() {
    return client.auth.signOut();
  }
  function currentUser() {
    return client.auth.getUser().then(function (r) { return r.data ? r.data.user : null; });
  }
  function onAuthChange(cb) {
    return client.auth.onAuthStateChange(function (_evt, session) {
      cb(session ? session.user : null);
    });
  }

  // ---- data (whole-state blob, one row per user) ----------------------
  function pull(userId) {
    return client.from(TABLE)
      .select('data, updated_at')
      .eq('user_id', userId)
      .maybeSingle()
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data;   // { data, updated_at } or null
      });
  }

  function push(userId, state) {
    return client.from(TABLE)
      .upsert({ user_id: userId, data: state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  return {
    enabled: enabled,
    init: init,
    autoSignIn: autoSignIn,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    currentUser: currentUser,
    onAuthChange: onAuthChange,
    pull: pull,
    push: push
  };
})();
