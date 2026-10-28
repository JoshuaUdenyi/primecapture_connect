# PrimeCapture Connect — Security-First Product Requirements Document

**Version:** 1.0 · **Date:** 28 October 2026 · **Owner:** PrimeCapture Media  
**Status:** Implementation-ready plan, **conditional on Meta API feasibility**  
**Audience:** Codex / product owner / production engineer

> **Non-negotiable:** Build a real, deployable internal tool. Do not fabricate Meta permissions, notification delivery, profile publishing, test results, or live broadcast capabilities. Any unverified Meta feature stays disabled until proven in a permitted test account.

## 1. Purpose and core problem

During an ongoing live production, a client may ask PrimeCapture to add their Facebook destination immediately. Obtaining a password, getting through 2FA, opening Live Producer, and manually copying a stream key can take longer than the event allows. PrimeCapture Connect should let a client **authorize access without sharing credentials**, create a supported live destination, and safely prepare OBS, with a **goal of under five minutes for a newly consenting client** and **under one minute for an already connected Page**. These are product targets, not guarantees.

**Strategy:** Build for PrimeCapture's crew first; keep data boundaries and interfaces clean enough for a later SaaS version. Do not build SaaS billing, multi-tenancy, or custom streaming infrastructure now.

## 2. Confirmed facts versus API feasibility gates

| Capability | Planning status | Implementation rule |
|---|---|---|
| OBS Studio 28+ with obs-websocket 5.x supports status, stream service read/update, and start operations | Documented | Implement and integration-test against a real OBS instance |
| OBS rejects changing the primary stream service while streaming | Documented in source | Add **our own earlier guard**; never attempt it during an active stream |
| Meta Business SDK lists `POST /{business-id}/client_pages` with `page_id` and optional `permitted_tasks`, and `GET /{business-id}/pending_client_pages` | SDK-documented endpoint | Treat actual availability, required access levels, resulting approval UX and token permissions as **unverified** until live-tested |
| Facebook Page live-video creation is described in Meta's Live Video API family | Documented concept, permissions and live operation subject to current Meta access | Do not enable production until token, scopes, Page task, Live API access and end-to-end publish are proven |
| A native Facebook push notification can be triggered simply by Page username | **Not established** | Never promise or simulate as native Meta notification; use native business request if confirmed, otherwise share secure consent link |
| Publishing to **personal Facebook profiles** via a newly approved third-party app | **Not established**; existence of a `/{user-id}/live_videos` reference is insufficient | Feature flag OFF; do not show 'connected profile' as working before successful App Review and live test |
| Client Page URL/username grants access | False | Page reference is discovery only; authorized human approval is mandatory |
| An approved business Page access request automatically grants app OAuth publish permissions | **Not established** | Verify the Page tasks and application access token independently |

**Stage gate (must pass before coding real publish control):** Validate a real test Page and real Meta app in Meta's current supported Graph API version; note exact required permissions, review/verification status, access token type, app mode, RTMPS creation response, live status transitions, revocation behavior, and whether business access requests can be sent and approved via API. Save results in `docs/meta-feasibility.md` with redacted responses. If blocked, implement a **manual connection fallback** and leave Meta-controlled features disabled.

## 3. Product principles

1. **Security over speed:** Never bypass Facebook login, 2FA, App Review, client consent, or Page roles. Never request or store Facebook passwords/cookies.
2. **Production-safe:** Never interrupt an existing stream, recording, or unrelated destination. Explicit operator confirmation to start publishing. No automatic stop of broadcasts.
3. **Truthful UI:** Distinguish `requested`, `business_approved`, `oauth_authorized`, `publish_ready`, `expired`, and `revoked`. No green “Connected” if publishing rights are absent.
4. **Least privilege:** Only request Meta permissions/tasks demonstrated necessary, narrow device tokens, few staff roles.
5. **Simple MVP:** One Next.js app, one managed Postgres/Auth service, one small Windows-friendly Node helper; no event bus, Redis, Kubernetes, complex desktop UI, billing, or custom relay.
6. **Degrade gracefully:** If Meta is unavailable or approval is incomplete, provide direct client instructions and a manual RTMPS setup path without leaking stream credentials.

## 4. Users and permissions

- **Owner/Admin:** Manage PrimeCapture crew, client destinations, Meta configuration, connected devices, revoke access, audit history.
- **Operator:** Create production sessions; request client access; prepare approved destinations; initiate a broadcast after explicit confirmation.
- **Client approver:** Not required to create a PrimeCapture account in v1. Authorizes only in **Meta-hosted** consent or business settings. Can use a single-use, short-lived request-status link to view status, not to control OBS.

Only staff accounts on an admin-maintained allowlist can log in. No public signup in v1. Admin and operator are application roles, separate from Meta business roles.

## 5. In scope / out of scope

**MVP in scope:** Staff authentication, client records, Page destination records, initiate Meta OAuth consent link where supported, record status and token health, optional Business Manager Page access request if validated, create one Page livestream via verified Meta API, local OBS pairing, safe configure-if-idle, preflight, confirm/start-if-idle, stream status, audit log, manual fallback, disconnect/revoke locally.

**Not in MVP:** Guaranteed native Facebook push, automatic access from profile/Page username, personal profile API publishing, Instagram, YouTube authorization, SaaS signup/billing, remote livestream termination, automatic video transcoding, RTMP relay, active-OBS primary destination replacement, unattended “go live,” analytics/revenue dashboards.

**Later, conditional:** Profile publishing after review + test; multi-destination via a verified relay/provider API; multi-tenant SaaS; optional WhatsApp messaging API (do not imply ordinary WhatsApp messages can be sent automatically without approved integration).

## 6. Critical user journeys

### Journey A — Existing authorized Page, OBS idle (happy path)
1. Staff logs in and opens/creates a production session.
2. Selects a **publish-ready**, correctly identified Facebook Page (display Page name and numeric ID).
3. Enters stream title and optional description; clicks **Prepare Facebook Live**.
4. Backend validates staff role, client authorization, token health and Meta permissions; creates a live resource **idempotently**; stores live ID and stream status; passes destination **only** to a paired agent for the chosen production PC.
5. Agent reads OBS status and current streaming service settings. If idle, saves a recoverable snapshot; sets new destination; reads back to verify; never modifies scenes, audio or recording state.
6. UI displays readiness checks and the chosen Page. Operator confirms by typing or checking an explicit “Correct Page and production feed verified” statement and pressing **Start Stream**.
7. Backend accepts one fresh, role-authorized command; helper rechecks OBS state then starts stream; system polls for actual OBS and Meta live status; do not show “Live” merely because the start API returned success.
8. UI offers a cautious **Restore previous OBS destination** action only when OBS is idle and its current settings still match the settings the helper applied.

### Journey B — New client Page
1. Operator enters a Page URL or Page ID. Name resolution is best-effort and **not authorization**.
2. If supported by a verified Meta business API, operator clicks **Request business Page access**; dashboard shows *requested*, not *connected*. Provide instructions for client to find the request in Meta Business settings; do not promise push notifications.
3. If business request isn't supported or sufficient, generate a short-lived Facebook Login consent URL using proper OAuth state and current approved scopes; operator shares URL manually by WhatsApp/SMS/email.
4. Client consents **on Meta**, not by giving PrimeCapture a password. Server verifies callback and exchanges code server-side, stores encrypted token, obtains permissible Page list, verifies selected Page and tasks, and marks **publish-ready only after live-publishing eligibility is checked**.
5. Continue Journey A. If account recovery/2FA blocks the client, show a truthful “Awaiting Meta authentication” state and a manual fallback; do not bypass.

### Journey C — OBS already live
1. Agent reports `outputActive=true`.
2. **No `SetStreamServiceSettings`, `StopStream`, or replacement of the primary destination.** Do not call `StartStream` on an already active output.
3. Dashboard states: “OBS is already live. Existing broadcast will not be changed.” Show the new Facebook ingest destination only to authorized operator with an explicit sensitive-data reveal step, or offer handoff to a separately validated relay integration in a later release.
4. Default v1 action = **manual add-destination workflow** with a checklist (if an approved, existing relay such as Castr can add destinations safely). Do not falsely claim to have added Facebook automatically.
5. Preserve all current OBS configurations regardless of failed Meta calls or loss of network.

### Journey D — Profile request
- Display “Profile publishing — under feasibility review,” or offer an operator-directed manual Live Producer workflow where the profile owner chooses a supported encoder destination.
- Do **not** create an automatic user `live_videos` flow until Meta explicitly grants the necessary feature and a permitted end-to-end test passes. The existence of docs or a third-party integration is not proof that a newly created app qualifies.

### Journey E — Failure recovery
- Token expired/revoked: block privileged actions; show *Reconnect* instructions; do not repeatedly retry unauthorized requests.
- Meta errors/timeouts: preserve production, show safe operator action, correlate request ID, limit retries with backoff; **do not blindly retry stream-creation POST** without idempotency/reconciliation.
- Agent disconnected/OBS closed: no start; status says *not connected*; no remote exposure of OBS port.
- On app crash after changing settings: persist snapshot; offer restore when idle and settings still match; never auto-restore while streaming.

## 7. Product screens (minimal, mobile-responsive)

1. **Sign-in:** Email-based staff login, no public registration.
2. **Dashboard:** Upcoming/active productions; one obvious *Emergency Broadcast* button; connected device badge.
3. **Clients & Destinations:** Client name; verified Page name/ID; connection/permission state; last checked; revoke/disconnect.
4. **Authorization:** Request status, client's Page and business approver instructions, short-lived shareable consent link, retry and diagnostic messages.
5. **Production Control:** Selected Page; title; OBS device; current OBS stream state; prepare/confirm/start actions; errors; no accidental single-click start.
6. **Preflight & Safety:** Correct Page and ID; token valid; OBS connected; idle/active; destination configured; recording unaffected; operator verification checklist.
7. **Audit Log:** Who initiated access, connected Page, created live resource, paired device, configured OBS, started broadcast, failures, revocation. Mask all tokens/keys.

Do not implement a fake Meta notification UI. Show verified data only.

## 8. Technical architecture (minimal deployable choice)

**Web:** Next.js (App Router), TypeScript, Tailwind, Zod. Use route handlers as the backend; avoid a separate Express/NestJS microservice.  
**Authentication + database:** Supabase Auth + managed Postgres. Staff allowlist. Use server-only service credentials for protected writes; never embed a service-role key in browser JavaScript. Apply RLS where browser access is allowed; keep the token table entirely server-only.  
**Hosting:** Vercel for the Next.js application (HTTPS) + Supabase for Postgres/Auth. Node.js runtime for server routes that use cryptography. Configure custom domain and approved OAuth redirect URI.  
**Local helper:** Small Node.js + TypeScript process on Windows, `obs-websocket-js`, using outbound HTTPS polling to receive scoped commands from the server. Pair device once per installation via expiring code. Do not expose port 4455, use LAN tunnels, browser-localhost cross-origin hacks, or require a native Electron/Tauri app in v1. Helper connects OBS to `127.0.0.1:4455` with password authentication.  
**Meta:** Thin `MetaProvider` module with configurable Graph API version, typed input validation, strict error handling, and no client-side tokens. An isolated `MockMetaProvider` for development; mock must be clearly labeled.  
**Streaming:** OBS continues generating video. PrimeCapture does not host/relay video in v1.

```text
Staff browser (HTTPS)
       |
Next.js web/API (Vercel) ------> Supabase Auth + Postgres
       |                              |
       +--> Meta OAuth & Graph API    +-- encrypted Meta token records
       |
       +<-- outbound HTTPS polling -- Local Node helper (Windows)
                                           |
                                      OBS WebSocket
                                      127.0.0.1:4455
                                           |
                                  OBS video -> verified destination
```

**Reason for polling:** Easy deployment and predictable auth for one operator PC; no public WebSocket ingress, no message broker. Helper polls every ~2 seconds when a production is active (configurable); uses short requests with timeouts and backoff. A 2-second poll is a UX target, not a correctness guarantee. In SaaS phase reassess scaling.

## 9. Data model (only needed tables)

Use SQL migrations and typed queries; UUID primary keys, UTC timestamps.

| Table | Required fields | Notes |
|---|---|---|
| `staff_profiles` | `user_id`, `role`, `is_active`, `created_at` | Staff allowlist only |
| `clients` | `id`, `name`, `notes?`, `created_at` | Internal clients |
| `destinations` | `id`, `client_id`, `provider`, `external_id`, `display_name`, `kind`, `connection_status`, `publish_capable`, `last_verified_at` | `kind=page` in v1; unique(provider,external_id) |
| `meta_credentials` | `id`, `destination_id`, `ciphertext`, `iv`, `tag`, `key_version`, `expires_at?`, `scopes`, `updated_at` | **No browser select access**; only encrypted OAuth/Page tokens |
| `productions` | `id`, `client_id`, `title`, `status`, `created_by`, `started_at?` | One active production per agent in MVP |
| `broadcasts` | `id`, `production_id`, `destination_id`, `meta_live_id?`, `status`, `operation_key`, `created_at`, `updated_at` | Unique idempotency key / guard against duplicates |
| `agents` | `id`, `name`, `device_token_hash`, `paired_by`, `last_seen_at`, `revoked_at?` | Device credential scoped to one device; hash in DB |
| `agent_commands` | `id`, `agent_id`, `production_id`, `broadcast_id?`, `action`, `state`, `expires_at`, `created_by`, `created_at`, `completed_at?` | Short TTL; one-time; backend-enforced allowlist |
| `obs_snapshots` | `id`, `agent_id`, `broadcast_id`, `encrypted_settings`, `applied_settings_fingerprint`, `created_at` | Restore only if idle and still matches |
| `audit_events` | `id`, `actor_user_id?`, `agent_id?`, `action`, `resource_type`, `resource_id`, `result`, `created_at`, `metadata_redacted` | No passwords, tokens, stream URLs, RTMPS keys |

Avoid storing raw stream URLs in a general database. Treat RTMPS destination as a secret (some providers embed the stream key in the URL). Deliver it only as a short-lived task to the authorized helper over TLS, and do not log it. If short-lived persistence for recovery is essential, encrypt it with TTL and document deletion.

## 10. API surface (Next.js route handlers)

Names are suggestive and can be adapted to framework conventions. All routes require a valid staff session unless specified.

| Method / route | What it does | Authorization |
|---|---|---|
| `GET /api/me` | Staff role / session | Staff |
| `GET,POST /api/clients` | List/create clients | Staff; create operator or admin |
| `GET,POST /api/destinations` | List/add Page reference (unverified) | Staff |
| `POST /api/meta/connect` | Initiate OAuth with CSRF state | Operator/Admin |
| `GET /api/meta/callback` | Verify OAuth state; code exchange; token handling | Valid one-time OAuth state |
| `POST /api/meta/business-access-request` | Conditional API access request | Admin only; **feature flag** |
| `POST /api/destinations/:id/verify` | Verify current authorization | Staff |
| `POST /api/destinations/:id/disconnect` | Delete local secret, revoke if Meta supports | Admin |
| `POST /api/productions` | Create production | Operator/Admin |
| `POST /api/productions/:id/prepare` | Server-side Meta publish-ready validation + create live resource once | Operator/Admin |
| `POST /api/broadcasts/:id/configure` | Enqueue OBS configure-if-idle | Operator/Admin |
| `POST /api/broadcasts/:id/start` | Final confirmation and short-lived OBS start command | Operator/Admin |
| `GET /api/broadcasts/:id/status` | Show combined Meta/OBS status | Staff |
| `POST /api/agents/pair-code` | Create pairing approval transaction | Admin |
| `POST /api/agents/pair` | Exchange validated one-time pairing transaction for device token | Pairing flow only |
| `POST /api/agents/poll` | Receive allowed, expiring command | Paired agent token |
| `POST /api/agents/commands/:id/result` | Return signed/authorized command outcome | Paired matching agent |
| `GET /api/audit` | Paginated security log | Admin |

**Input rules:** Validate all payloads with Zod; no raw external URLs in backend `fetch` (fixed allowlisted Meta origin only); cap payload sizes; sanitize error messages; use server-generated resource identifiers; enforce ownership/role checks on every resource lookup. Limit connection/request frequency and prevent repeated access-request spam.

## 11. Explicit OBS command allowlist and state machine

**Supported agent commands (v1):** `HEALTH_CHECK`, `GET_OBS_STATUS`, `CONFIGURE_STREAM_WHEN_IDLE`, `START_STREAM_AFTER_CONFIRMATION`, `RESTORE_STREAM_WHEN_IDLE`.  
**Prohibited from cloud commands (v1):** `STOP_STREAM`, scene switching, audio changes, recording manipulation, arbitrary OBS WebSocket method execution, shell commands, file writes beyond helper's own configuration. Avoid a “run command” endpoint.

**Configure:**
- Verify paired agent and production binding; command not expired, not already completed.
- Connect to OBS WebSocket on loopback with auth.
- Call `GetStreamStatus` immediately; if active -> **block without changes**.
- Read `GetStreamServiceSettings`; save encrypted snapshot before modification.
- Validate destination protocol and hostname (from trusted Meta API response; RTMPS preferred); prevent arbitrary URL injection/SSRF through agent.
- Set RTMP custom service settings as supported by OBS; read back and compare; log only fingerprint and IDs.
- If configure fails, attempt restore **only while idle** and only if safe; otherwise surface manual recovery.

**Start:**
- Server requires authenticated operator **explicit confirmation**, visible Page ID/name, nonce and expiry of <=30 seconds; create once-only command.
- Agent rechecks active state, expected destination fingerprint and production ID; if any mismatch -> **block**.
- Call `StartStream` once; collect `GetStreamStatus` as acknowledgment. Do not claim Facebook is live until confirmed through the supported Meta status endpoint or operator-verifiable URL.

**Restore:** Only after manual action, idle OBS, destination fingerprint still matches settings we last applied; never overwrite user changes.

**State machine:**
`DRAFT -> ACCESS_PENDING -> AUTHORIZED -> LIVE_CREATED -> OBS_CONFIGURED -> START_REQUESTED -> OBS_ACTIVE -> FACEBOOK_LIVE_VERIFIED`.  
Failure substates: `BLOCKED_AUTH`, `BLOCKED_OBS_ACTIVE`, `BLOCKED_DEVICE_OFFLINE`, `BLOCKED_PERMISSION`, `UNKNOWN_REMOTE_RESULT`, `FAILED`; recovery is deliberate and never silently retries a publish action.

## 12. Security requirements and threat model

| Threat | Required control |
|---|---|
| Fake Page identity / unauthorized client | Page ID+name retrieved/confirmed from Meta; separate client approver authentication and explicit Page confirmation |
| Stolen Meta access token | Encrypt at rest AES-256-GCM with a server-side 32-byte key stored only in production secrets; decrypt only when needed; use TLS; no tokens in browser, logs, URLs, analytics or errors; rotate encryption key via `key_version` |
| OAuth interception/CSRF/account confusion | Cryptographic `state` with short TTL and one-time consumption; PKCE where supported; fixed allowlisted redirect; exchange codes server-side; verify result belongs to intended signed-in operator/request |
| Privilege escalation | Server-side role checks, service-role secret never in browser, database policies, per-resource checks, admin-only business access requests and disconnect |
| Agent takeover | One-time short-lived pairing code, approve on staff UI, hashed scoped device token, revoke device, TLS only, no unauthenticated commands, commands tied to agent/production/TTL |
| Malicious remote OBS control | OBS WebSocket binds loopback and requires password; helper outbound HTTPS only; strict method allowlist and status guardrails |
| Replay / duplicate Go Live | Idempotency keys, unique constraints, command nonce/expiry, consume-once status, reconcile unknown Meta create result before retry |
| Changing a working production | Verify OBS idle before modify/start, preserve snapshot, explicit confirm, safe compare-and-restore; never stop active feed |
| Sensitive stream URL exposure | Never display by default, encrypt/transmit only when needed, redact logs and error reports, memory/TTL handling, no analytics events carrying secrets |
| Traffic spikes / Meta API errors | Timeouts, bounded retry for safe idempotent reads, exponential backoff, per-user rate limits, graceful fallbacks |
| Abuse via public URL request | Client request URLs are not fetched by arbitrary host; parse IDs/allowlist `facebook.com` host; request throttling and admin approval |
| Secret leakage from GitHub | `.env*` ignored except `.env.example`; automated secret scanning; ensure env logs and screenshots redact values |

Use HTTPS, secure cookies, CSRF protection for mutations, login MFA for PrimeCapture staff where available, dependency updates, server-side validation, and backup/restore procedure. **Never ask clients to disable 2FA.**

### Secrets

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` (browser-safe publishable key only)
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `META_APP_ID`, `META_APP_SECRET` (server only)
- `META_GRAPH_VERSION` (configurable; pin tested version)
- `META_BUSINESS_ID` (if enabled)
- `TOKEN_ENCRYPTION_KEY` (32 random bytes, stored in secret manager; never commit)
- `NEXT_PUBLIC_APP_URL` / `APP_BASE_URL` (verified URLs)
- Feature flags: `META_PAGE_PUBLISH_ENABLED=false` by default; `META_BUSINESS_REQUEST_ENABLED=false`; `META_PROFILE_PUBLISH_ENABLED=false`; `MOCK_META_ENABLED=true` only for local development and **never** in production.

Prefer `.env.example` with placeholder values. Never invent production secrets or treat mock tokens as real.

## 13. Meta spike — acceptance tests and exit gate

**Preparation:** Register a legitimate Meta developer app and business portfolio as required; supply privacy policy, data deletion information and proper redirect URLs; test only Pages you own or have explicit consent to access. Confirm current requirements in Meta's developer console and references, not just third-party blog posts.

1. **Business request test** (optional): With authorized business credentials, submit `POST /{business-id}/client_pages` for an explicitly consenting test Page. Record actual API response and errors (redacted), whether a pending approval appears in Meta Business settings, and if any native push is generated. If blocked, disable feature and use OAuth link.
2. **OAuth test:** App reviewer-approved scopes/features. Complete login/consent using owner’s device; list authorized Pages and tasks; handle decline, wrong Page, expiration and revocation.
3. **Page live test:** Create a test live-video resource, obtain valid ingest destination, stream a test pattern via OBS, verify actual Page live status/viewer page, and clean up according to current Meta rules. Capture redacted network records.
4. **Profile test:** Research exact 2026 app eligibility and try only after Meta authorizes the specific use. If app review cannot grant personal-profile live publishing, **leave out of MVP**.
5. **Decision:** Complete `docs/meta-feasibility.md` with `PASS`, `BLOCKED`, or `UNVERIFIED` for each capability. No production button wired to blocked/unverified endpoint.

## 14. Phased implementation for Codex

### Phase 0 — Feasibility + project setup (must finish first)
- Create README, this PRD, `.env.example`, basic Next.js project with TypeScript/Tailwind, Vitest, Playwright smoke framework, ESLint.
- Create `docs/meta-feasibility.md` template with evidence checklist; implement `MetaProvider` interface + `MockMetaProvider` and gated `GraphMetaProvider` skeleton.
- Verify real Meta permissions manually with developer credentials; **do not** ask Codex to pretend to log into the owner's Meta account or mark tests as passing.
- **Exit:** Verified capabilities recorded; scope gates updated. Mock mode works locally with explicit “SIMULATED” banner.

### Phase 1 — Secure internal dashboard
- Supabase staff auth, roles/allowlist, client/Page records, production screen, audit events, responsive UI.
- DB migrations/RLS; encryption unit tests; rate limiting and server authorization.
- **Exit:** Unauthenticated user gets 401; wrong-role user gets 403; no Page secrets in browser or logs.

### Phase 2 — Local OBS helper + guardrails
- Implement pairing and device revoke; small Node helper; `obs-websocket-js`; `GetStreamStatus`, `GetStreamServiceSettings`, `SetStreamServiceSettings`, `StartStream` only for proper states.
- Use mock destination for OBS integration tests. Snapshot/restore manually when idle. Start requires new confirmation.
- **Exit:** Existing stream never interrupted; recording remains intact; helper closed/disconnected is visible; replayed command rejected.

### Phase 3 — Meta Page connect + live creation (only if approved)
- OAuth consent flow, encrypted tokens, Page verification, granular publish-capable statuses, real live creation and status verification, safe OBS destination handoff.
- Add Business Manager access request **only if successful and permitted in spike**.
- **Exit:** A consenting test client Page streams live end-to-end; no credentials shared; confirmed live via Meta; documented revoke and recovery flow.

### Phase 4 — Production deployment + rehearsals
- Production deploy, secret rotation plan, audit log, health page, backup/restore runbook, simulated internet failure and OBS crash tests.
- Test one real PrimeCapture production with a **pre-authorized** Page, then a controlled new-client authorization. Record actual timings and failures.
- **Exit:** Operator checklist signed off; all security gates passed; emergency fallback documented.

**Do not implement Phase 3 endpoints using imaginary success data if Phase 0 fails.** The app can still deploy with Phase 1–2 plus manual fallback.

## 15. Deployment runbook

**Prerequisites:** Node LTS and npm, GitHub, Vercel, Supabase project, Windows production machine with OBS 28+ and OBS WebSocket password enabled, Meta developer app, verified deployment domain and redirect(s).

1. Create Supabase project; apply checked-in SQL migrations. Disable public signup, configure staff allowlist and admin role. Review RLS. Keep the service role key only in server env.
2. Configure Vercel project from GitHub with Node runtime; add `APP_BASE_URL`, Supabase keys, encryption key, Meta app secrets and approved redirect URL. Start Meta publishing flags **OFF**.
3. Set Meta App Dashboard domains/privacy-policy/data deletion URLs and redirect allowlist; obtain only approved scopes/feature access. Run callback flow with a consenting test user.
4. Provision Windows helper: install Node LTS, `npm ci`, `npm run agent`, enter OBS WebSocket password locally (never through dashboard); pair using short-lived code from admin dashboard. Use loopback 127.0.0.1 and Windows Firewall block inbound access.
5. Verify `/api/health` (only generic status) and operator login; verify DB migration version, local helper heartbeat, OBS idle detection, audit entries, and empty-session dashboard.
6. Run security smoke tests (unauthenticated routes, CSRF/OAuth state, role mismatch, duplicate requests, expired pairing, agent revocation, secret redaction); record results.
7. Perform controlled Page livestream rehearsal; check Facebook destination ID, actual ingest, stream state, and rollback recovery.
8. Enable `META_PAGE_PUBLISH_ENABLED` **only after** production review and successful test. Business requests and profiles remain disabled until separately approved.
9. Record runbook `docs/operations.md`: re-pair device, rotate keys, revoke Page, recover failed broadcast, restore OBS settings when idle, and complete incident response.

**Rollback:** Disable feature flag immediately, revoke compromised agent/device tokens, disable Meta publishing operations, restore prior Vercel deployment if a release introduced bugs. **Never automatically stop an ongoing OBS broadcast as part of rollback.**

## 16. Testing and acceptance criteria (must have)

**Unit tests:** OAuth state generation/expiry/replay, token AES-GCM round trip and wrong-key behavior, auth/role checks, Page ID validation, URL parsing/allowlist, Meta error mapping, command TTL/idempotency, OBS state transition guards, restore fingerprint comparison.

**Integration tests:** Mock Meta provider response/denial/revocation; database migrations/RLS, staff auth; helper -> dashboard poll and result; real local OBS session in safe test environment; Meta end-to-end test only with approved credentials and controlled Page.

**Failure scenarios:** OBS active while new request arrives; OBS recording-only; wrong Page; Meta 401/403/429/5xx; network timeout after Meta create; expired token; revoked agent; duplicate Start clicks; dashboard session expires; agent crashes between snapshot/set/verify; operator changes OBS settings manually before restore.

**Product acceptance:**
- Client never shares Facebook password or 2FA code with PrimeCapture.
- No staff member can publish to a Page unless both Page authorization and app publishing entitlement are validated.
- No native-notification claims unless verified.
- Already-live OBS never has primary destination changed/stopped by PrimeCapture Connect.
- No streaming begins without explicit authenticated operator confirmation.
- Tokens, RTMPS URLs, OBS password and pairing secrets never appear in client bundles, browser localStorage, public APIs, logs, or audit metadata.
- Repeat requests cannot cause duplicate broadcasts or repeated Start operations.
- New/expired/revoked permissions are displayed accurately.
- Production deployment works from documented commands, without an unmentioned paid service, external system, or fictional API.

## 17. Non-functional targets

- **Availability:** All sensitive operations fail closed if auth/Meta status can't be verified; OBS continues existing output independently of dashboard availability.
- **Performance targets:** Already connected Page: <60 seconds from action to stream start under ideal conditions; new Page: <5 minutes **only when** Meta permits and approver completes authorization promptly. Track median/p95, no guarantees.
- **Observability:** Error codes, correlation IDs, durations, audit events; no secrets or full HTTP request bodies.
- **Data protection:** Encrypted Meta tokens, restricted access, revocation and deletion path, minimal retention (e.g. 90 days for audit logs initially, subject to client contracts and law), TLS; documented privacy/data deletion policy.
- **Operator experience:** Clear red/amber/green status with text (don't rely solely on color); usable on a laptop/phone; never turn failure into “success”.

## 18. Repository structure — intentionally small

```text
primecapture-connect/
  app/                      # Next.js pages and API route handlers
  components/               # Small reusable UI
  lib/
    auth/                   # session/role guards
    db/                     # Supabase server clients + queries
    meta/                   # provider interface, mock and real adapters
    security/               # encryption, audit, validation, rate limits
    broadcasts/             # state transitions and idempotency
  agent/
    src/                    # outbound polling, pairing, OBS adapter
    README.md               # Windows startup & recovery
  supabase/migrations/      # SQL migrations
  tests/                    # unit + integration + smoke
  docs/
    meta-feasibility.md
    operations.md
    threat-model.md
  .env.example
  package.json
  README.md
```

No independent microservice deployment, Redis, queues, CDN for video, Electron shell, or SaaS tenant model in v1.

## 19. Codex build contract

Codex must:
1. Read this PRD before coding. Start by listing verified prerequisites and unresolved Meta capability gates.
2. Build in phases, starting with mock and testable safe foundations, **not** with an undocumented Meta publish button.
3. Prefer simple typed functions, standard library, and maintained packages; no abstraction without a real use case.
4. No hardcoded Graph API version in multiple files. Pin/test via one configuration value.
5. Never fabricate Meta API responses or claim external app review is complete. Mock must be clearly labeled and never enabled in production.
6. Implement each server endpoint with authorization, Zod validation, safe errors, tests, and audit when relevant.
7. Implement explicit OBS fail-closed guardrails; test existing-stream-not-interrupted and restore-only-when-idle as release blockers.
8. Produce `.env.example`, migrations, README with exact dev/deploy commands, Windows agent instructions, CI workflow (lint, typecheck, test, build), and security checklist.
9. Keep all user/operator-facing states truthful; do not promise native push notifications or personal profile publication without proof.
10. When blocked by missing Meta permission/real credentials, mark the issue **BLOCKED — requires human action** and deliver the working mock/manual fallback instead of guessing.

## 20. Primary technical references and caveat

- Meta-maintained Business SDK specification (`client_pages`, `pending_client_pages`): https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json
- Meta Live Video API documentation entry point: https://developers.facebook.com/documentation/live-video-api
- Meta Graph API permission reference: https://developers.facebook.com/docs/permissions/reference/
- Meta Business Management API: https://developers.facebook.com/docs/marketing-api/business-manager-api/
- OBS WebSocket 5.x protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
- OBS stream-settings guard source: https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestHandler_Config.cpp
- OBS WebSocket README: https://github.com/obsproject/obs-websocket
- Meta Facebook Live archive policy (30-day replay retention): https://about.fb.com/news/2025/02/updating-our-facebook-live-video-storage-policy/

**Verification caveat:** Meta developer documentation can be gated or updated, and its application review decisions depend on actual business/app status. This document specifies **what to test and build**, not a claim that PrimeCapture already possesses these permissions. Some documentation references describe an API shape but do not establish that a new external app may use it. Confirm in the current Meta developer console before enabling production.
