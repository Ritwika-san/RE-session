# RE-session

RE-session is a safety-net continuity system for critical digital work. It starts a user-controlled Critical Session, captures the latest checkpoint from the browser and local files, and lets the user recover a task from any other device through a recovery client.

## Project structure

- extension/: Browser extension for Chrome/Edge
- recovery-client/: Vue 3 + Vite recovery app deployed on Vercel
- supabase/: Postgres migrations and Edge Functions

## What it does

- Starts and stops a critical session explicitly from the browser extension
- Captures activity from Gmail, forms, attached files, local code folders, terminal history, and autosave files
- Stores checkpoints and screenshots in Supabase with per-user RLS rules
- Provides a recovery briefing and readiness score via a Supabase Edge Function
- Lets users continue a task from another device with a responsive recovery client

## Supabase setup

1. Create a Supabase project.
2. Enable Email/Password Auth.
3. Apply the migration from supabase/migrations/.
4. Apply the migration to create the private `re-session-storage` bucket and its ownership policies.
5. Deploy both Edge Functions:
   - recover-session
   - cleanup-expired-data
6. Configure the following environment variables in the Edge Function runtime, if using AI summary generation:
   - OPENAI_API_KEY or LLM_API_KEY
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
7. Schedule cleanup-expired-data to run on a recurring interval.

## Browser extension setup

1. Open Chrome or Edge.
2. Go to chrome://extensions or edge://extensions.
3. Turn on Developer mode.
4. Select Load unpacked and point to the extension/ folder.
5. In the popup, select Settings to open the extension options page.
6. Configure and save the Supabase URL and anon key there.
7. Return to the popup and sign in with the same email and password you use on the recovery client.

## Recovery client setup

1. Open recovery-client/.
2. Copy .env.example to .env and fill in values.
3. Install dependencies:
   npm install
4. Run locally:
   npm run dev -- --host
5. Build for production:
   npm run build
6. Deploy to Vercel and set the same environment variables in project settings.

## Local development notes

- The extension only runs on desktop Chrome/Edge.
- The recovery client is responsive for phones and laptops.
- RLS is enforced in Supabase; the extension and client must use anon keys only for the browser layer.
- Signed storage URLs are short-lived and should expire quickly.

## Deployment notes

- Vercel deploys the Vue client.
- Supabase hosts the database, storage, and Edge Functions.
- A Chrome Web Store submission is a separate future step and is not required for this build.
