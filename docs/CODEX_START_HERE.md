# Codex instruction — PrimeCapture Connect

You are a senior security-minded full-stack engineer implementing **PrimeCapture Connect**, an internal production application for PrimeCapture Media. Read `PRD.md` in full before editing any code.

## Goal
Build a real deployment-ready internal tool that lets an authorized client connect a Facebook Page to PrimeCapture, lets an operator create a supported Page livestream, and safely configures local OBS Studio. Work toward <5 minutes for newly consenting clients, <60 seconds for pre-authorized clients; these are targets, not guarantees. Security and avoiding an interrupted live broadcast matter more than speed.

## Non-negotiable rules
- **Never** assume Meta supports pushing a Facebook notification from a Page username. The Meta Business SDK contains a client Page access-request endpoint but it must be tested for permissions and client approval UX.
- **Never** assume a Business Manager Page share grants app API publishing permissions. Verify both.
- Personal profile live publishing is **experimental and disabled** until Meta permission/App Review and an actual permitted end-to-end test prove availability.
- Never bypass Facebook authentication/2FA, scrape Facebook, request client passwords, or automate a logged-in browser.
- **Never** change OBS's primary destination while it is live, stop an existing stream, or auto-start without a final explicit operator confirmation.
- No secrets in browser bundles, logs, URLs or source control. Mock data must be labeled, mocked Meta cannot run in production.
- Keep code simple; use one Next.js web/API app + Supabase (Auth/Postgres) + one small Windows Node helper using obs-websocket-js on 127.0.0.1:4455. No separate backend microservice, Redis, video relay, Electron, billing, or SaaS tenancy.

## Execution order
1. Inspect repo and create a short plan with Meta feasibility gaps. Scaffold Next.js + TypeScript + Tailwind + Supabase and source structure from PRD. Make `.env.example`, README, lint/typecheck/tests/build scripts.
2. Implement secure staff login, staff roles, clients, Page destinations, production UI, audit, DB migrations, encryption, and feature flags.
3. Implement clearly labeled `MockMetaProvider` and a real adapter behind feature flags. Create `docs/meta-feasibility.md` showing unverified API capabilities as BLOCKED/UNVERIFIED, never pretend permissions are approved.
4. Implement pairable Node helper with outbound HTTPS polling and tight command allowlist; connect to OBS WebSocket locally. Enforce checks, encrypted snapshots, no active stream changes, explicit confirmation and idempotency; include real/fake OBS integration tests.
5. After external Meta app credentials and review evidence exist, implement and prove Page OAuth -> verify Page/token/task -> create live -> safe OBS configuration -> stream start -> verify real live status; Business Manager request only if separately verified.
6. Deliver production Vercel/Supabase deployment instructions, Windows helper setup, runbook, CI, tests, and list of any requirements still awaiting human Meta approvals.

## First response
Before coding, give a concise inventory of files, prerequisites, risks, and Phase 0 scope. Then implement Phase 0 and Phase 1 rather than building a fictional end-to-end Facebook workflow. Do not ask for passwords or embed secrets in code. If an external account approval is required, document the exact manual step and continue on local/mocked components.

## Definition of done
Every feature is working or honestly marked blocked, CI passes, production deploy builds successfully, and a verified OBS test proves an active stream cannot be interrupted by any cloud command. No Page is advertised as publish-ready before permissions are verified.
