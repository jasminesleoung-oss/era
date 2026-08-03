# Era — Cloud Sync Setup

By default the app runs **100% local** (data stays in your browser). Follow these
steps once to turn on **cloud sync + login** so your progress follows you to any
device. Everything stays free.

---

## 1. Create a free Supabase project
1. Go to **https://supabase.com** → sign up → **New project**.
2. Give it a name (e.g. `era`), set a database password (save it somewhere),
   pick the closest region → **Create**. Wait ~2 min for it to spin up.

## 2. Create the data table (copy-paste one snippet)
In your project: left sidebar → **SQL Editor** → **New query** → paste this and hit **Run**:

```sql
create table if not exists public.era_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.era_state enable row level security;

create policy "own row read"   on public.era_state for select using (auth.uid() = user_id);
create policy "own row insert" on public.era_state for insert with check (auth.uid() = user_id);
create policy "own row update" on public.era_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

This creates one row per person and locks it down so **only you can read/write your own data**
(that's what "Row Level Security" does).

## 3. (Optional) Skip email confirmation
So sign-up logs you straight in with no email click:
- Left sidebar → **Authentication** → **Sign In / Providers** → **Email** →
  turn **OFF** "Confirm email" → Save.
- If you leave it ON, that's fine too — the app will just tell you to click the
  confirmation email before your first login.

## 4. Paste your keys into the app
1. Left sidebar → **Project Settings** → **API**.
2. Copy the **Project URL** and the **`anon` `public`** key.
3. Open `js/config.js` in this folder and fill them in:

```js
var ERA_CONFIG = {
  supabaseUrl: 'https://YOURPROJECT.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...your anon public key...'
};
```

> These two values are safe to ship in the browser — the `anon` key is public by
> design and is protected by the security rules from step 2.

## 5. Put the app online (so your phone can open it)
The app is just static files, so any free static host works. Easiest:

**Netlify Drop** — go to **https://app.netlify.com/drop** and drag the whole
`wellness-app` folder onto the page. You'll get a URL like
`https://your-app.netlify.app`. Open that on any device, log in, done. ✅

(Alternatives: Vercel, Cloudflare Pages, or GitHub Pages — all fine.)

## 6. Use it
- Open your hosted URL → **sign up** once with your email + a password.
- On your phone, open the same URL → **log in** → your data syncs down.
- The little card at the top of the **You** tab shows sync status + a log-out button.

---

### How the sync works (plain English)
- Your whole progress is saved as one record in your Supabase project.
- The app still keeps a copy in each browser, so it works **offline**; when you're
  online and logged in, changes push to the cloud automatically (a moment after
  each change).
- When you log in on a device, it pulls the latest cloud copy. If you edit on two
  devices at the exact same time, the **last save wins** — fine for one person,
  just don't count on merging simultaneous edits.

### Privacy note
Turning this on means your logs (food, workouts, points, quests) leave your device
and live in your Supabase project. Only your logged-in account can read them, but
it is cloud storage. If you'd rather keep everything on-device, just leave
`js/config.js` blank and the app stays fully local.
