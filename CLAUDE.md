# Nhịp — instructions for Claude (GitHub Action fixing reported bugs)

Read `AGENTS.md` (Expo rules) and the README section "Cấu trúc" first. Keep this short workflow:

1. **Reproduce first.** Issues labelled `auto-bug` come from the app's admin account via the
   `report-error` function. They contain a scrubbed message, a stack (file:line), the screen route,
   the platform and app version. Find the root cause in the code; write a failing Jest test (or a
   `scripts/db-check` check for SQL/RLS) that reproduces it before fixing.
2. **Fix the cause, not the symptom.** Smallest correct change. Don't swallow errors to make a
   report go away. If it is not a bug (expected offline/AI-quota state), say so in the issue and
   change the reporter's `EXPECTED` list instead.
3. **Verify:** `npm ci` then `npm run check` (tsc, eslint, prettier, jest, deno check for every
   function). All must pass.
4. **Open a pull request** that references the issue (`Fixes #<n>`), explains cause → fix → test
   in Vietnamese, and never merges itself. The owner reviews and merges; merging deploys.

## Hard rules

- **Privacy:** never log, commit or paste user content (note/task text, transcripts), emails,
  tokens or ids. Issues are already scrubbed — keep it that way in comments and tests.
- **Secrets:** API keys live only in Supabase secrets / GitHub secrets. Never add keys to code,
  `EXPO_PUBLIC_*`, `app.config.ts` or tests. The app only ever uses the Supabase `anon` key.
- **AI proposes, code validates:** AI output (Gemini) goes through zod schemas and the pure
  validators in `supabase/functions/_shared/*-core.ts`. Never trust AI output directly.
- **Database:** migrations are additive (new file in `supabase/migrations/`, never edit an old
  one). Every table has RLS limited to the owner. Batch inserts with rows of different keys need
  `insert(rows, { defaultToNull: false })`.
- **UI text is Vietnamese** and lives in `src/i18n/vi.ts`. Controls need accessibility labels;
  layouts must work from 320 px wide to desktop.
- Shared pure code in `supabase/functions/_shared` imports with `.ts` extensions (Deno + Jest).
- Don't touch `.github/workflows/*` or deployment config in a bug-fix PR unless the bug is there.
