# Operations and release runbook

For YouTube authorization, API-created livestreams, setup and partial-request recovery, follow [YouTube setup](youtube-setup.md). A private real-channel rehearsal is still required.

## Before a production

- Use an approved staff account with an active role. No public signup or shared credentials.
- Confirm client consent, numeric Page ID and actual Meta permission evidence. This release cannot create a Facebook live resource; use the manual guide.
- Pair the correct PC; check fresh heartbeat, OBS connection, live state and recording state.
- If OBS is already live, **leave the primary destination and output untouched**. No automatic stop, replacement or rollback is permitted.
- Keep encoder credentials on the authorized production PC; never put them in client notes, URLs, chat, audit data or screenshots.
- For a manual start, verify the Page and feed with the operator and check the actual viewer page. OBS acknowledgement is not proof of Facebook live status.

## Failure and access recovery

- Network/Meta outage: existing OBS continues independently. Do not repeatedly attempt create/start. Reconcile unknown external results manually.
- Staff removal: set `staff_profiles.is_active=false`, revoke Supabase sessions, then remove email access. Server guards recheck active status on every protected request. Sign-out can clear an expired session.
- Device compromise: administrator revokes it in Devices. Subsequent polls reject its hashed token. Re-pair locally; no remote stream termination.
- Page disconnect: admin uses **Disconnect** on the Page in Clients & channels. The server atomically deletes local encrypted credentials, marks revoked, and audits. **Remote Meta revocation is not implemented**; the Page owner must revoke the app in Meta settings independently.
- Local settings recovery: the isolated safety kernel never auto-restores. Restore requires idle OBS and an unchanged applied fingerprint. If there is a mismatch or crash uncertainty, inspect OBS manually without stopping a live stream.

## Secrets, backups and retention

- Keep service-role, Google OAuth, Meta, helper and encryption credentials in managed secrets/local protected storage; never `NEXT_PUBLIC_` variables. The cloud needs no OBS password.
- Back up Supabase with its managed backup/PITR facilities; test restore to an isolated project, apply auth/role policy, compare non-secret row counts and re-verify all authorizations before reconnecting production.
- Encryption version is 1; ciphertext includes IV/tag and context-bound AES-256-GCM. No real Meta credential storage is enabled. Before storing tokens, implement reviewed multi-key rotation, re-encrypt with record binding in a transaction, test decrypt with new key, and retain old key through backup retention. Changing the only key blindly loses access.
- Schedule retention cleanup using Supabase's scheduler or your operations tooling: remove audit events older than the agreed retention (initial target 90 days), expired pairing/OAuth records and old rate-limit buckets. This release does not silently enable a scheduler. Audit deletion must be a controlled administrative maintenance action.
- Track dependency advisories. CI runs lint, typecheck, unit/database/protocol tests, production build and browser smoke tests. Tests never contact Google/Meta or publish video.

## Deploy / rollback

1. Apply SQL migration to Supabase and disable public signup. Create active staff allowlist profiles; configure verified redirects and SMTP.
2. Set real server env in Vercel, simulation flags false, all Meta gates closed. Build root with Node 24, `npm ci`, `npm run build`. No deployment has been performed by this build task.
3. Check generic `/api/health`, staff login/logout, wrong-role denial, persistence after server restart and administrator audit. Run a safe Windows status-helper rehearsal.
4. Before enabling cloud control, complete reviewed command integration and actual OBS tests: idle configure/readback; recording unchanged; replay rejection; active stream unchanged; crash recovery; operator changes; fresh final confirmation; Meta viewer-status proof.
5. Roll back web deployment and revoke compromised access if needed. Never send a stop/restore command as a rollback response to an ongoing broadcast.
