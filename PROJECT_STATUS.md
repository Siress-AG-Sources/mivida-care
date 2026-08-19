# Mi Vida Health — Project Status

_Last updated: 2026-08-18 (commit a897172)_

## What this is

Care-workflow system for Mi Vida Health (mivida.health), a concierge medicine
practice. Turns verbal clinical decisions into structured patient schedules,
generates refill prompts, and runs a daily exception monitor so nothing slips.
Full design in `DESIGN.md`; original spec in "Work Flow Note to Tony Siress.docx".

Hard boundary: the AI never prescribes, doses, or submits pharmacy orders —
it structures what the provider decided and prompts the provider to act.

## Stack

- **Cloudflare Worker** (Hono + TypeScript) — `src/index.ts` (~1140 lines, single file)
- **D1 database** `mivida-db` — migrations in `migrations/` (0001–0005)
- **Static frontend** served from `public/` via the Worker's ASSETS binding —
  vanilla JS, no framework, no build step
- **Cron**: daily exception monitor at 06:30 UTC (`[triggers]` in wrangler.toml)
- **CI**: `.github/workflows/deploy.yml` — push to main → typecheck → wrangler
  deploy → POST a deploy-event to the live app (drives "What's New" notifications)
- **Live URL**: https://mivida.siress.workers.dev
- **Email**: Resend, notification on deploy

## Cache-busting convention (important — easy to get wrong)

Edge caching bit us repeatedly (see commits a3bf16f, 9a47c52). The fix in use:
**versioned filenames**. `public/index.html` loads `styles-v14.css` and
`app-v17.js` — **the unsuffixed `public/app.js` and `public/styles.css` are
NOT what the site serves.** They happen to be byte-identical to the live
versions right now, but that's coincidence, not a guarantee:

- Don't read `app.js`/`styles.css` as the source of truth for current
  behavior — check what `index.html` references.
- Editing the unsuffixed files changes nothing in production.
- **Never delete the `public/app-v*.js` / `styles-v*.css` files as "dead
  duplicates"** — deleting the referenced ones takes the site down.

To ship frontend changes: copy the live `app-vN.js` / `styles-vN.css` to
`v(N+1)`, edit that, and update the reference in `index.html`.
(`app-v15.js` at the **repo root** — not `public/` — is a genuinely stray
copy, byte-identical to `public/app-v15.js`.)

## Who's building what

- **Backend** (`src/index.ts`, `migrations/`, API): driven by hermes sessions.
- **UI redesign**: done in Claude desktop/web sessions — that's where new
  versioned frontend files come from.
- The repo moves fast with no signal (5 commits in 2 days recently) —
  re-check `git log` before assuming anything about the tree.

## Phone-layout regression checklist

`styles.css`/`styles-v14.css` contain a "PHONE LAYOUT" section
(`@media (max-width: 640px)` and `420px`; commits 76060c3, 07b631a). If a
redesign cuts a new stylesheet from a pre-mobile base, these regressions
return: horizontal scroll from the nav row (484px wide at a 390px viewport),
a feedback sheet that can't be closed on a phone, and iOS zoom on the
Settings token field. After any stylesheet change, `grep "PHONE LAYOUT"`
the new file.

## Auth

- Bearer token `MIVIDA_AUTH_TOKEN` (wrangler secret) for the API / CI.
- Admin console: `ADMIN_TOKEN` + `ADMIN_TOKEN_2` (Dr. Sheila) — verified
  server-side before unlocking (`adminAuth` middleware on `/admin/*`).
- `.dev.vars` holds local dev secrets (gitignored).

## Feature inventory (as of a897172)

- Patient registry: CRUD, intake form + insurance, archive/unarchive
- Encounters: four-question form (who / what happened / workflow / question
  before next visit), per DESIGN.md §4
- Medications: per-patient, receipt confirmation, exhaustion tracking
- Cycles, tasks
- Refill prompts: the 10-field prompt from the spec; status lifecycle
- Exception monitor: daily cron + manual `/exceptions/run`; dedup + auto-resolve
  of stale exceptions
- Status board per patient (`/patients/:id/status`)
- Call log per patient (POST/GET `/patients/:id/calls`)
- 90-day unseen list (`/patients/unseen/:days`) — own tab
- Prescribing view (`/prescribing`, active meds grouped by patient) — own tab
- Feedback slide-out panel (categories, status) + admin feedback triage
- Admin console (stats, feedback) with multi-admin tokens
- Deploy events + "What's New" notifications, posted by CI
- Responsive phone layout (iPhone 390/430); brand palette matched to
  mivida.health (source of truth: `public/styles.css` `:root` — see DESIGN.md
  header for the verified palette and the orange-is-action-only rule)

## Working conventions

- Direct commits to main; CI deploys on push. Commit messages reference GitHub
  issues (`Closes #N`).
- Users: Tony (builder/owner) and Dr. Sheila (second admin). Real clinical use.
- `npm run typecheck` before pushing (CI enforces it).
- DB changes: add a numbered migration in `migrations/`, apply with
  `npm run db:migrate:remote` (CI does NOT run migrations — do it manually).

## Open items / rough edges

- **`MIVIDA_AUTH_TOKEN` rotation hazard**: it's a 55-char write-only
  Cloudflare secret with no readable copy on the Mac; Tony still can't log
  into the portal on his phone. Do NOT rotate without his go-ahead — it locks
  out whoever holds the rollout-email token, and the matching GitHub Actions
  secret must change in the same pass or CI's notify step 401s silently
  (it uses `curl -s` with no `-f`, so the run stays green).
- **`GET /api/debug` is publicly reachable** (exempted from auth at
  `src/index.ts:95`) and leaks env key names + token length. Flagged to Tony;
  suggested fix is gating it behind `adminAuth` rather than deleting — it's
  how a candidate token gets verified.
- Stray `app-v15.js` at repo root (duplicate of `public/app-v15.js`)
- `UPDATE_EMAIL.txt` at root — draft update email, may be stale
- DESIGN.md §10 open questions (practice location/law, note entry method,
  patient volume, EHR coexistence) still open
- Roadmap v0.2: voice capture (Whisper), agent-assisted encounter drafting,
  roles/team tasks
