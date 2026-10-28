# Validation evidence — 2026-10-28

## Current instance

| Check | Result | Evidence / scope |
|---|---|---|
| Frozen dependency installation | PASS | `npm ci --no-fund`; Node 24.19.0, npm 11.9.0 |
| ESLint | PASS | `npm run lint`, zero warnings/errors |
| Route generation + strict TypeScript | PASS | `npm run typecheck` (`next typegen` before `tsc`) |
| Unit/API/Postgres/protocol tests | PASS | `npm test`: 26 tests across 5 files |
| Optimized production build | PASS | `npm run build`, Next 16.4.3 Webpack |
| Browser workflow | PASS | Chromium / Playwright: 2 tests; desktop client → Page reference → production → blocked preflight → audit → logout; mobile layout and safety dialog |
| Production server requests | PASS | `/api/health` 200; unauthenticated `/api/me` and `/api/clients` 401; `/login` 200 with no simulation option; demo login endpoint 404 |
| Production browser | PASS | Sign-in page rendered, no browser JavaScript exceptions |
| Runtime dependency advisory scan | PASS | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities at execution time |
| Browser bundle inspection | PASS | No server-secret variable names or `device_token_hash` fields in production browser chunks |
| Reusable cloud setup | SAVED | `install_script` + `start_skill` draft saved; not published automatically |

Tests explicitly cover active OBS rejecting configure/start/restore with **zero writes/starts**, preserved recording, production/expiry checks, encrypted snapshots, readback, manual-change restore rejection, durable replay rejection, and a second idle check just before configuration. The protocol test uses a real `obs-websocket-js/json` client against a **simulated** OBS server reporting live + recording; only `GetStreamStatus` and `GetRecordStatus` are observed. The helper never receives cloud stream-control commands.

The SQL migration is actually executed with PGlite PostgreSQL. Tests verify anonymous/browser write denial, credential table denial, active-staff reads, administrator-only audit reads, disabled staff denial, transactional pairing/revoke, and rate limiting. The fixture provides minimal Supabase Auth identities and roles; it does not validate a hosted Supabase project.

## Corrections made during validation

- Switched the supported Next build/dev backend to Webpack because Turbopack's compiler subprocess cannot bind its IPC socket in this cloud sandbox.
- Set a canonical demo `APP_BASE_URL` rather than relying on Next's internal bind address for origin validation; retained exact-origin CSRF checks.
- Disabled sign-in controls until hydration so early clicks are not lost.
- Made the fixed sidebar scroll on short laptop screens, preserving access to sign-out.
- Selected the explicit JSON OBS subprotocol (the package's Node default is MessagePack) and bounded handshake/read timeouts.
- Used Node's `--import tsx` helper entrypoint to avoid an unnecessary CLI IPC socket.

## Not run / externally blocked

- Hosted Supabase migration, real staff email delivery/PKCE callback, production persistence and MFA policy: **requires a user-owned project and configuration**.
- Real authenticated Windows OBS integration and an actual active-stream safety rehearsal: **requires the production-like Windows test installation**.
- Meta OAuth, reviewed permissions, Page/task/token verification, live creation, native business-request UX, actual Facebook viewer status, profile eligibility: **no credentials/review evidence supplied; not attempted**.
- Cloud configure/start/restore delivery, nonce/confirmation/results integration: **not implemented or enabled**. The isolated safety kernel and passing fake tests are not a release approval.
- Vercel deployment: **not performed**. The user subsequently published the cloud environment; source retention in the restored instance and local startup were verified. See Git history for source publication.

Development workflow is usable locally with labelled simulation. Production broadcast readiness is **not claimed**. See `meta-feasibility.md`, `operations.md` and `../agent/README.md` for the exact external steps and remaining implementation gates.

## Sign-in configuration regression fix — 2026-10-28

The sign-in button previously stayed disabled when any required Supabase setting was absent. It now responds after hydration and displays an actionable server setup error. Development lists missing variable names with a local `.env.local` checklist; production keeps setup errors generic. Secret values never enter page props or the browser bundle. Whitespace-only settings count as missing.

Validation: `npm run check` passed (lint, generated route types/TypeScript, **29 tests** across 5 files, optimized production build); Playwright passed **3 browser tests**, including the exact missing-configuration button regression. Browser tests explicitly exclude live Supabase keys and never reuse an existing app server. A separate configured-workspace browser check clicked the real sign-in button with an unregistered test address and received the expected generic HTTP 200 response; no email was sent. This does not verify email delivery or completion of an administrator email-link login.
