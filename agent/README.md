# Windows OBS helper — status only

This small Node process makes outbound HTTPS requests and connects only to `ws://127.0.0.1:4455`. It does not expose a port or accept arbitrary OBS/cloud commands. Pairing and revoke work with the dashboard; configure/start/restore cloud delivery is intentionally disabled.

## Setup (PowerShell)

1. Install Node 24 LTS and OBS Studio 28+ with obs-websocket 5.x. Use a **separate safe test installation** for rehearsals, never an active production PC for automated tests.
2. Enable OBS WebSocket authentication. Set a strong local password. Restrict inbound 4455 with Windows Firewall; do not expose it to the LAN or Internet. No tunnels.
3. In this checkout, run `npm ci`. Copy `agent/.env.example` to `agent/.env`. Set `CONNECT_APP_URL` to the verified HTTPS dashboard origin and enter the OBS password **only on this PC**. Do not send it to PrimeCapture's cloud app.
4. In the dashboard, an admin opens **Devices → Pair a device**, names the PC, and generates a one-use five-minute code.
5. Run `npm run agent -- --pair`, enter that code at the local prompt, then run `npm run agent`. Do not place the code in a URL or shell command history.
6. Check the dashboard heartbeat and OBS/recording state. Online state ages out when heartbeats stop. Stopping/revoking the helper never stops OBS.

The helper saves its device credential in ignored `agent/.state/device.json`; restrict this directory and `agent/.env` to the Windows operator account using NTFS ACLs. POSIX modes alone do not enforce Windows ACLs. Keep credentials outside cloud-synced folders. `AGENT_STATE_DIR` can select a protected local path.

For local simulation only, use `CONNECT_APP_URL=http://127.0.0.1:3000` and `AGENT_ALLOW_LOCAL_DEVELOPMENT=true`. The only HTTP exceptions are localhost/127.0.0.1. Production uses HTTPS with certificate checks and rejects redirects.

## Recovery

- Revoked credential: ask an admin to revoke the old device, stop the helper, delete only its local `device.json`, then pair again. Pairing never silently overwrites existing credentials.
- Closed OBS/wrong password: status reports disconnected; configure OBS locally. No password is logged or sent to the cloud.
- Lost network: exponential heartbeat backoff, existing output untouched.
- Ctrl+C stops monitoring only. It never sends `StopStream` or manipulates recording, scenes or audio.

## Safety kernel and outstanding release gate

`safety.ts` + `journal.ts` implement an **isolated, unwired** configure/confirm-start/compare-restore kernel. It validates expiry, production binding, strict commands, trusted RTMPS host shape, encrypted snapshots, durable claim-before-action, idle checks and readback. Unknown/crashed actions require manual recovery and are never replayed. A pending snapshot prevents a second configure from overwriting recovery data. The current ingest hostname is a restrictive candidate; validate it against the actual approved Meta response before release.

Unit tests exercise a fake OBS port. A protocol simulator also drives the real `obs-websocket-js` client through hello/identify/status responses while simulating active stream + recording. **No real Windows OBS session has been tested.** The cloud does not issue configure/start/restore commands or connect the safety kernel to polling. Complete durable command claim/result delivery, authenticated nonce/confirmation integration and real OBS rehearsals before enabling remote control.
