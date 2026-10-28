# Set up client YouTube livestreams

PrimeCapture now implements real YouTube Data API v3 calls to authorize a client's channel, create a scheduled broadcast, create its encoder stream, bind them and read the actual YouTube lifecycle status. Facebook can remain disconnected. No Vercel deployment is required for local testing.

The implementation has automated protocol/database/browser tests. **A live Google authorization and actual YouTube broadcast have not been tested in this workspace:** Google OAuth credentials and a consenting channel have not been configured. Do a private rehearsal before relying on it for a client production.

## 1. Apply the additional Supabase migration

In your existing Supabase project, open **SQL Editor**, paste the contents of [202610280002_youtube.sql](../supabase/migrations/202610280002_youtube.sql), and run it once. Keep the existing staff, clients and Facebook records. Do not run the initial migration again on an existing project.

For a new database, apply `202610280001_initial.sql` first, then `202610280002_youtube.sql`. Existing dashboard features continue working while the new migration is pending; YouTube operations will explain that setup is needed.

## 2. Create the Google API credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create the project for PrimeCapture.
2. Open **APIs & Services → Library**, find **YouTube Data API v3**, and enable it.
3. Configure **Google Auth Platform** (formerly the OAuth consent screen): branding/contact details, audience and data access. Use **External** if clients are outside your Google Workspace organization. While in **Testing**, add each consenting client's Google account under **Test users**.
4. Add the scope `https://www.googleapis.com/auth/youtube.force-ssl`. This allows the requested live-broadcast operations; Google displays the permission for the client to review.
5. Create an OAuth client with application type **Web application**. Add this exact authorized redirect URI for local testing:
   ```text
   http://localhost:3000/youtube/callback
   ```
   This is separate from the Supabase `/auth/callback`. Keep the host, port and path identical to your app configuration. For a reachable hosted app, register `https://YOUR-APP-DOMAIN/youtube/callback` instead.
6. Copy the client ID and client secret privately into the server environment described below. Google may require consent-screen verification and YouTube API compliance review before broader client use. Test users do not constitute production approval. External OAuth apps in Testing generally receive refresh tokens that expire after seven days for YouTube scopes, requiring reconnection.

## 3. Configure the app privately

Keep the existing Supabase values in `.env.local`. Add:

```dotenv
APP_BASE_URL=http://localhost:3000
YOUTUBE_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
YOUTUBE_CLIENT_SECRET=YOUR_GOOGLE_WEB_CLIENT_SECRET
TOKEN_ENCRYPTION_KEY=YOUR_EXISTING_64_HEX_CHARACTER_KEY
DEMO_MODE=false
MOCK_META_ENABLED=false
```

If no encryption key exists yet, generate one **on your computer**, then save the output privately as `TOKEN_ENCRYPTION_KEY`:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep this key stable and backed up securely: it encrypts the channel refresh credentials. Changing it without a migration requires reconnecting affected channels. No key needs a `NEXT_PUBLIC_` prefix. Do not commit `.env.local` or share secrets in chat.

Stop the running app with Ctrl+C, then run `npm run dev` and sign in with your approved staff account. `npm run dev:demo` is for UI samples only and never calls the YouTube API.

In this managed cloud environment, preserve the configured HTTPS proxy and CA trust, and run Node with `NODE_USE_ENV_PROXY=1` when needed. Permit `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com` through your deployment's network policy.

## 4. Connect the client's channel

1. In **Clients & channels**, add/select the client. An administrator chooses **Connect YouTube**, selects the client and chooses **Create connection link**.
2. Share that link with the client privately. It expires after 24 hours and starts one authorization attempt. The client does **not** need a PrimeCapture staff account.
3. The client opens the link, chooses **Continue with Google**, selects the Google/Brand Account for the correct YouTube channel and approves the requested permission.
4. PrimeCapture verifies the returned channel ID and saves the refresh credential encrypted on the server. The staff dashboard refreshes automatically. A connected channel is not a guarantee that YouTube allows it to broadcast; eligibility is checked before creation.

**Local testing:** a `localhost` link works on the computer running PrimeCapture. A remote client cannot use your localhost address. When you want remote clients to authorize, use an HTTPS address they can reach and register the matching Google callback. A self-hosted Node server or another host works; Vercel is optional.

## 5. Create the livestream through the API

1. Choose **New production**, select the client and choose its **YouTube** stream destination.
2. Open the saved production. Set a future start time, visibility and whether the broadcast is made for children. Start with **Private** for the first rehearsal.
3. Confirm the selected channel, visibility and audience, then choose **Create YouTube broadcast**.
4. The server refreshes permission, rechecks the channel identity and live access, creates the `liveBroadcast`, creates a non-reusable `liveStream`, binds it and reads back the channel/stream/visibility before reporting success. Titles longer than YouTube's 100-character limit are shortened for YouTube.
5. Open **YouTube Studio** from the prepared broadcast. Its scheduled livestream already exists. Use Studio's encoder settings on an **idle** OBS instance, verify the video preview, then choose **Go live** in Studio. **Check YouTube status** in PrimeCapture reads YouTube's real status; an encoder connection alone is not labelled live.

Auto-start and auto-stop are explicitly disabled. This implementation does not issue API transitions to live/complete, delete broadcasts, reveal stream keys through PrimeCapture browser APIs, or control OBS remotely. The API setup and the operator's actual video/start actions are separate. Existing OBS broadcasts remain independent.

## Troubleshooting

- **Setup required:** apply migration 002, configure the Google values and valid 32-byte encryption key, restart the real workspace.
- **Connection link unavailable/used:** request a new link. Opening the landing page does not consume it; choosing Continue with Google does. Complete the flow in the same browser within ten minutes.
- **Access blocked/test user:** the exact Google account authorizing the channel must be permitted by your OAuth app's audience/test-user configuration. Choose a Brand Account when that owns the client's channel.
- **Channel not enabled for live:** the owner enables live streaming in YouTube Studio. Initial activation may take up to 24 hours; restrictions must be resolved by the owner.
- **Expired/revoked access:** reconnect the channel. An expired refresh credential is never treated as valid because an old broadcast was prepared.
- **Quota reached:** inspect the YouTube Data API quota in Google Cloud and wait for reset/request the appropriate quota. The app does not retry quota errors automatically.
- **PREPARING / NEEDS_ATTENTION / timeout:** a remote POST may have succeeded even if its response was lost. Reopen this production and review YouTube Studio. Use an existing created broadcast there when possible. The app does not automatically repeat a creation, delete partial resources or reset the operation. Resolve unknown results before creating another production. Recorded YouTube IDs remain available in the server-side `youtube_broadcasts` metadata.
- **Disconnect:** the admin action deletes local encrypted credentials, marks the destination revoked, cancels outstanding consent for that client and audits the change. Existing broadcasts are not ended/deleted. To revoke the Google grant itself, the owner uses [Google Account connections](https://myaccount.google.com/connections); that can affect other channels granted to the same OAuth app.

## API and security boundaries

| Route | Access | Purpose |
|---|---|---|
| `POST /api/youtube/connect` | Active admin + exact Origin | Create a client-scoped, one-use connection invitation |
| `POST /api/youtube/authorize` | Possession of valid invitation + exact Origin | Consume invitation; start Google consent with PKCE and a browser-bound state |
| `GET /youtube/callback` | One-use state + HttpOnly browser binding | Exchange code and save encrypted channel refresh credentials |
| `POST /api/productions/:id/prepare` | Active staff + exact Origin | Create and bind a YouTube broadcast, with explicit schedule/visibility/audience confirmation |
| `POST /api/productions/:id/youtube-status` | Active staff + exact Origin | Read actual YouTube status for the production's channel/broadcast |

Google token exchanges and YouTube requests use fixed HTTPS endpoints, bounded timeouts and no automatic POST retries. AES-256-GCM binds refresh credentials to both client and channel. State consumption, connection saving, creation claims and checkpoints use transactional service-role-only database functions. A unique production claim prevents concurrent/replayed requests from creating a second broadcast. No OAuth token or encoder key appears in dashboard responses. The local simulation rejects real OAuth/creation calls, and production cannot enable simulation. The workspace intentionally shares clients between authorized crew; it is not a multi-tenant SaaS.

The app suppresses development request logging for invitation/callback routes and sets no-referrer headers. Configure any hosting/access-log/analytics system to redact query strings on `/youtube/connect` and `/youtube/callback`, and never capture request bodies or token responses. Rotate Google secrets through your private configuration; retain the encryption key until old credentials/backups have been migrated. Schedule expired invitation/state cleanup with your existing retention process.

## Official API references checked for this implementation

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [YouTube Live getting started](https://developers.google.com/youtube/v3/live/getting-started)
- [Create a broadcast](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert)
- [Create an encoder stream](https://developers.google.com/youtube/v3/live/docs/liveStreams/insert)
- [Bind a stream to a broadcast](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind)
- [Read broadcast status and live eligibility errors](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list)
