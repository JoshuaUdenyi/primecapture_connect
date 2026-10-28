# Meta feasibility — release gate

Recorded 2026-10-28. No Meta app, Supabase project, Page token, business credentials, or review evidence was supplied. The attached PRD is a requirements source, not evidence of API access. No Meta API operation has been attempted or marked successful.

| Capability | Status | Required human evidence |
|---|---|---|
| Current Graph version and app eligibility | UNVERIFIED | Select supported version in the Meta console; document deprecation date and app mode |
| Page OAuth, approved scopes and tasks | BLOCKED | Registered app, reviewed scopes/features, exact redirect, consenting test Page, redacted Page/task/token results |
| Page live creation and RTMPS response | BLOCKED | Actual permitted test, ingest host/shape evidence, idempotency/reconciliation design |
| Facebook live-status verification | BLOCKED | OBS test-pattern broadcast, confirmed Page ID, actual Meta status transitions/viewer URL |
| Business `client_pages` request | UNVERIFIED | Exact access requirements, successful authorized request and observed approval UX |
| Business share grants app publishing rights | UNVERIFIED | Independent app token, scopes and Page-task verification; never inferred from business approval |
| Native push from username | UNVERIFIED / not promised | Actual documented supported capability and observed consented test |
| Personal profile publishing | DISABLED | Explicit app eligibility/review and permitted end-to-end test; excluded from current MVP |
| Mock provider | DEVELOPMENT ONLY | Explicit flag, simulated label, no publish-capable result, production rejection tests |

## Manual steps before any real publishing implementation

1. Owner registers a legitimate Meta developer app/business portfolio. Configure domain, privacy policy, data-deletion instructions and exact HTTPS redirect URIs. Use only a Page/account you own or have explicit consent to test.
2. In the current Meta console, identify required permissions and App Review/access levels. Supply credentials through production secret settings, never chat or source control. Record approved scopes/features, app mode and review evidence here.
3. Implement/review the real PKCE-supported OAuth callback and atomic state consumption with staff/request/Page bindings. The current Graph adapter intentionally throws `META_UNVERIFIED`; the state utility is a tested foundation, not a live OAuth implementation.
4. Complete Page selection, token/task health and revoked/expired/declined/wrong-Page tests. Store only AES-GCM encrypted tokens with destination-bound associated data. Never expose ingest URLs or keys to general browser APIs.
5. With an authorized test Page, prove live creation and actual status transitions using a test pattern; save **redacted** evidence and manual recovery results. Investigate timeout/unknown-create results before any POST retry.
6. Business requests and profiles need separate review/tests. Do not enable them because Page publishing passed.
7. Review code and update the hard capability gates only after evidence passes. Environment flags are insufficient.

Manual fallback is available in the app's safety guide. It never automates a logged-in browser, requests passwords, bypasses 2FA, or changes an already-live encoder.

References provided by the product brief (not verified access grants):
- https://developers.facebook.com/documentation/live-video-api
- https://developers.facebook.com/docs/permissions/reference/
- https://developers.facebook.com/docs/marketing-api/business-manager-api/
- https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json
