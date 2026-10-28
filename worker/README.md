# Helixcer Chat Cloudflare backend

The backend uses Cloudflare Workers, D1, a scheduled D1 outbox, and a Durable Object WebSocket hub. Its small WebCrypto-based Web Push dependency runs in Workers without Node compatibility and the system is designed for Cloudflare's free allowances.

## Architecture

- D1 stores workspaces, verified users, workspace memberships, server-side sessions, invitations, channels, contacts, conversations, messages, retries, webhook deduplication, and audit events.
- Google OAuth uses Authorization Code + PKCE + state + nonce. Google ID-token signatures are verified against Google's rotating JWK set with Web Crypto; issuer, audience, expiry, nonce, stable `sub`, and verified email are checked.
- The browser receives only a random `__Host-helixcer_session` cookie. It is host-only, `HttpOnly`, `Secure`, and `SameSite=Lax`; D1 stores only its SHA-256 hash.
- Durable Object instances and broadcasts are keyed by `workspace_id`. Each socket carries only server-internal session metadata and is revalidated before events or keepalive replies; logout, disablement, and role changes disconnect affected sockets.
- WhatsApp, Telegram, and Instagram webhooks retain independent signature/token verification and do not depend on an agent session.
- Each workspace can own any number of provider connections. Their credentials are encrypted in D1 with AES-256-GCM under one Worker master secret; the browser can replace a secret but can never read one back.
- Saving a provider connection only validates and encrypts its configuration. Provider verification remains a separate administrator action.
- Failed outbound messages use the D1 outbox and a one-minute scheduled retry with exponential backoff.
- WhatsApp free-form text and media are accepted only inside Meta's 24-hour customer-service window. Approved templates use a separate authenticated dashboard endpoint and remain available after that window closes.
- Dashboard attachments are uploaded directly to Meta before their outbound message is queued; Helixcer stores only message metadata and the encrypted temporary provider payload, not another copy of the file.
- External applications use revocable, hashed workspace API keys through the Helixcer Messaging API. The currently available WhatsApp template module writes sends to the inbox and outbox atomically; sensitive retry payloads are AES-GCM encrypted and removed after a terminal submission result.
- Authenticated browser installations can register a VAPID Web Push subscription. Inbound provider webhooks schedule encrypted background alerts without delaying the provider response; expired browser endpoints are removed automatically.
- The native Android app requests a short-lived, one-use server challenge and exchanges the nonce-bound Google ID token for a device-bound, revocable bearer session. When optional Firebase service-account secrets are configured, mobile installations can register FCM tokens and receive the same sender, preview, and conversation deep link as browser alerts.

The initial migration seeds one empty workspace, never an administrator. On the first successful Google login, an owner membership is created only if there are no memberships and the verified Google email exactly matches `BOOTSTRAP_OWNER_EMAIL`. Future users require an invitation.

## Required configuration

Public Worker variables in `wrangler.toml`:

- `APP_ORIGIN`: dashboard origin used for safe post-login redirects.
- `ALLOWED_ORIGINS`: exact comma-separated browser origins; wildcards are not accepted.
- No workspace ID variable is required. The single workspace is resolved from D1 by its `default` slug (or as the only workspace), and its internal ID is a generated UUID.
- `SESSION_TTL_SECONDS`: defaults to seven days and is capped at 30 days.
- `RECOVERY_MODE`: leave `false`; set to `true` only for a short, supervised recovery window.
- `OAUTH_RATE_LIMIT_WINDOW_SECONDS`, `OAUTH_RATE_LIMIT_PER_CLIENT`, and `OAUTH_RATE_LIMIT_GLOBAL`: bound anonymous login starts in the existing Durable Object before D1 is written.
- `EXTERNAL_API_RATE_LIMIT_WINDOW_SECONDS`, `EXTERNAL_API_RATE_LIMIT_PER_KEY`, and `EXTERNAL_API_RATE_LIMIT_PER_WORKSPACE`: bound server-to-server API traffic in the workspace Durable Object. The checked-in defaults are 60 requests/minute/key and 300 requests/minute/workspace.
- `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT`: the public half of one stable P-256 VAPID key pair and a `mailto:` or HTTPS contact URI. The public key is returned only to authenticated dashboard sessions.

Configure these as Worker secrets/environment variables; never commit real values:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_ANDROID_CLIENT_IDS
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
npx wrangler secret put BOOTSTRAP_OWNER_EMAIL
npx wrangler secret put CHANNEL_CREDENTIALS_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

If Google includes the Android OAuth client as the ID token's `azp` claim, set
`GOOGLE_ANDROID_CLIENT_IDS` to that client ID (or a comma-separated allowlist).
The token audience is always required to equal `GOOGLE_CLIENT_ID`.

`CHANNEL_CREDENTIALS_KEY` must be at least 32 bytes of high-entropy material and must remain stable across deployments. It is the only Worker secret used to protect managed channel credentials; do not create `WA_MAIN_*`, per-channel, or per-workspace bindings. Losing this key makes the encrypted provider credentials unreadable, so keep a protected backup.

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` must belong to the same stable VAPID identity. Keep only the private key in Worker secrets. Rotating the pair requires browsers to subscribe again. Web Push uses each browser vendor's push service directly and does not require a paid notification provider.

The three `FIREBASE_*` values are optional and enable reliable background notifications for `com.helixcer.chat`. Use a dedicated Firebase service account with permission to send Firebase Cloud Messaging messages. Store its PKCS#8 private key only as the `FIREBASE_PRIVATE_KEY` Worker secret (escaped `\n` newlines are supported). If these values are absent or invalid, browser Web Push continues normally and native FCM registration reports that it is unavailable.

`ADMIN_TOKEN` is optional emergency recovery access. It is ignored unless `RECOVERY_MODE=true`, is accepted only through `Authorization: Bearer` or `X-Admin-Token`, and should be rotated or deleted immediately after the incident. Normal browser use relies on the session cookie. There is no email-override header and no URL-token authentication.

For a supervised recovery only, create a fresh token with `npx wrangler secret put ADMIN_TOKEN`, temporarily change `RECOVERY_MODE` to `"true"`, and deploy. Never reactivate a legacy shared token because older browsers may retain a copy. When recovery is complete, change recovery mode back to `"false"`, deploy again, and run `npx wrangler secret delete ADMIN_TOKEN` (or rotate it if an incident runbook requires keeping one).

For local development, copy `.dev.vars.example` to `.dev.vars`. The real `.dev.vars` file is ignored.

## Google OAuth setup

Create a Google Web OAuth client and register the exact callback configured by `GOOGLE_REDIRECT_URI`, for example:

```text
https://api.chat.helixcer.com/auth/google/callback
```

No Google refresh token is requested or stored; Google is used only to verify identity during sign-in. Callback failures clear stale OAuth state and return the browser to the configured app origin with a safe error code and message. If no app origin is configured, the Worker renders a small branded fallback page instead of exposing a raw exception.

## Database and deployment

Create D1 once, place its ID in `wrangler.toml`, then apply every migration in order:

```sh
npx wrangler d1 migrations apply helixcer-chat-db --remote
npx wrangler deploy
```

Migration `0002_identity_and_workspaces.sql` is additive. It preserves existing inbox rows, initially assigns them to the bootstrap workspace, and creates identity/session/team tables. It does not seed a person or billing data.

Migration `0004_multichannel_credentials.sql` adds a logical `provider_type` and the encrypted `channel_credentials` vault. Instagram is stored physically as `generic_http` only to respect the original table check constraint; runtime routing always uses `provider_type`. The migration deletes `wa-main` only when it is still the exact, unreferenced placeholder inserted by migration 0003. Edited or used rows are preserved.

Migration `0005_external_template_api.sql` adds workspace API keys, encrypted outbound template payloads, and seven-day idempotency records. It is additive and does not modify existing channel, contact, conversation, or message rows. Apply it before deploying Worker code that references the new tables.

Migration `0006_contact_profiles.sql` adds contact-level `company` and `tags_json` fields without replacing contact, identity, conversation, or message rows. It seeds each existing contact's tags from its most recent conversation, when available, so the right-side contact editor starts with the tags already visible in the Inbox.

Migration `0007_conversation_uniqueness.sql` merges earlier duplicate conversation rows for the same workspace, contact, and channel into the most recently active thread. It moves all messages, preserves cumulative unread activity and the latest status, then enforces one durable conversation per channel identity. A new inbound message reopens that thread instead of creating another row.

Migration `0008_push_subscriptions.sql` adds workspace/member/device-scoped Web Push subscriptions. Browser-issued endpoints and encryption keys are never returned from list or bootstrap APIs; disabled memberships are excluded from notification delivery.

Migration `0010_workspace_uuid.sql` replaces the bootstrap workspace's actual primary key with a database-generated RFC 4122 version-4 UUID. It preserves users, memberships, sessions, invitations, contacts, conversations, messages, API keys, push subscriptions, webhook history, and audit history. Because channel credentials and queued provider payloads are encrypted with the old workspace ID as authenticated data, the migration removes those encrypted values, stops queued sends, marks affected pending messages failed, and clears provider-verification markers. Channel definitions and message history remain visible, but every provider connection must be reconnected. For an existing deployment, deploy the compatible Worker code first and then apply this migration so sign-in and emergency recovery resolve the renamed workspace dynamically throughout the rollout.

Migration `0011_mobile_push_devices.sql` adds typed, device-bound mobile sessions, one-use mobile sign-in challenges, and session-scoped native push registrations for the Android app. FCM registration tokens are capability values, are never included in bootstrap or list responses, and are deleted automatically only when Firebase explicitly reports them as `UNREGISTERED`. Revoking or expiring the owning mobile session removes its registrations.

Migration `0012_contact_identities.sql` makes contacts independent from connected channel accounts. It creates workspace-scoped platform identities and separate channel bindings, backfills legacy channel identities without merging different contacts, and adds an exact identity reference to conversations and messages. A binding stores the account-scoped profile ID plus last inbound, outbound, and conversation usage so the UI can identify the most recently used connected account. Legacy rows with no unambiguous identity remain readable through the compatibility path and are recorded in `identity_migration_issues` instead of being assigned by guesswork. Export D1 before applying this migration.

Migration `0013_flat_contact_platform_ids.sql` adds the flat contact contract. Each master contact exposes at most one current ID for WhatsApp, Telegram, Instagram, Facebook, and email through `platformIds`. It deterministically selects a current identity from legacy duplicates but does not delete any historical identity, binding, conversation, or message. An ID with conversation history cannot be changed or removed. Export D1 before applying this migration.

Deploy the Worker on its `workers.dev` hostname, then deploy the repository's `gateway/` Pages Function with an `API` service binding to this Worker. Associate the Pages project with `api.chat.helixcer.com` and, at the external DNS provider, point only the `api.chat` CNAME to `helixcer-chat-gateway.pages.dev`. Keep the GitHub Pages dashboard at `chat.helixcer.com` and list only the dashboard origin in `ALLOWED_ORIGINS`. The checked-in frontend uses the branded API hostname; browsers never call the `workers.dev` hostname directly because its host-only `SameSite=Lax` cookie would be cross-site.

The gateway holds no Google or channel secret. HTTP and WebSocket requests are passed to the Worker over Cloudflare's internal service binding. Deploy it from `gateway/` with `npx wrangler pages deploy` after the Worker is available.

## Authentication and team API

- `GET /auth/google/start?return_to=URL&invite=TOKEN` — begins Google login. `return_to` and the `returnTo` alias are accepted only when their origin exactly matches the allowlist.
- `GET /auth/google/callback` — consumes code/state/PKCE, verifies the Google ID token, and creates a server session.
- `GET /auth/mobile/config` — returns the public Google Web client ID and Android package name required by Credential Manager.
- `POST /auth/mobile/challenge` — accepts `{deviceId}` and returns a five-minute, one-use `{nonce, expiresAt}` for Credential Manager.
- `POST /auth/mobile/google` — accepts `{idToken, nonce, deviceId, deviceName}`, consumes the matching challenge, applies the same owner/invitation rules, and returns a revocable mobile bearer session.
- `GET /api/me` — current verified user, workspace, membership, and role.
- `GET /api/push/config` — returns Web Push availability and the public VAPID key to a verified browser session.
- `POST|DELETE /api/push/subscriptions` — registers or removes the current member's browser installation.
- `GET /api/push/mobile-config?deviceId=DEVICE_ID` — returns `available`, `subscribed`, `deviceId`, and the fixed `com.helixcer.chat` app ID for the authenticated mobile session, so Settings can show the server's true state.
- `POST|DELETE /api/push/mobile-devices` — registers or removes the current member's `com.helixcer.chat` Android installation using `{deviceId, appId, token}` (the token is required only for `POST`); these routes accept mobile bearer sessions only.

For the current direct-delivery architecture, each inbound event sends at most
23 browser pushes and 23 native pushes. This keeps the combined fanout, a
possible FCM OAuth exchange, and realtime broadcast below the Cloudflare Free
external-subrequest limit with a small safety margin. Larger workspaces should
move fanout to Cloudflare Queues before raising this cap.

FCM sends are high-priority data-only messages. Their data contains the sender title, bounded message preview, notification tag, `conversationId`, and native deep-link target. The Android `FirebaseMessagingService` builds the visible notification so its `PendingIntent` can always open the exact conversation.
- `POST /api/logout` or `/auth/logout` — revokes the session and clears its cookie.
- `GET /api/team` — owner/admin member and pending-invitation list.
- `POST /api/team/invitations` — creates a hashed, email-bound, seven-day invitation and returns its one-time login URL.
- `PATCH /api/team/members/:membershipId` — updates `role` and/or `status` (`active` or `disabled`).
- `PATCH /api/team/invitations/:invitationId` — cancels a pending invitation.
- `GET|POST /api/developer/api-keys` — lists metadata or creates a one-time workspace API key (owner/admin).
- `DELETE /api/developer/api-keys/:apiKeyId` — revokes a workspace API key (owner/admin).

Roles:

- `owner`: all workspace operations; only owners can promote/invite administrators or change owners.
- `admin`: inbox operations, channel administration, and agent invitations/status changes.
- `agent`: inbox, contact, assignment, and message operations.

The last active owner cannot be disabled or demoted.

Browser requests must use `credentials: "include"`. Cookie-authenticated mutations, logout, and WebSocket upgrades require the exact allowed `Origin`. The realtime connection is `GET /api/realtime` as a WebSocket upgrade; its session cookie is verified before it is routed to the workspace's Durable Object. No token belongs in the WebSocket URL.

## Inbox and provider API

- `GET /health`
- `GET /api/bootstrap`
- `GET|POST /api/channels`
- `PATCH|DELETE /api/channels/:channelId`
- `POST /api/channels/:channelId/verify`
- `GET /api/channels/:channelId/verify-token` (owner/admin; audited, no-store response)
- `GET /api/conversations`
- `POST /api/conversations` (opens or reuses one conversation for an exact contact identity and connected channel)
- `PATCH /api/conversations/:id`
- `GET|POST /api/conversations/:id/messages`
- `GET /api/conversations/:id/templates` (approved templates from that conversation's WhatsApp connection)
- `POST /api/conversations/:id/template` (authenticated WhatsApp template send)
- `POST /api/conversations/:id/attachments` (authenticated WhatsApp multipart upload)
- `GET|POST /api/contacts`
- `GET /api/contacts/export.csv` (one CSV row per contact with separate provider-ID columns; `/export` remains an alias)
- `GET|PATCH /api/contacts/:contactId`
- `POST /api/contacts/:contactId/identities`
- `PATCH|DELETE /api/contacts/:contactId/identities/:identityId`
- `GET /api/tags` (workspace-scoped tag suggestions derived from saved contacts)
- `GET /api/channel-data/whatsapp-templates`
- `POST /api/demo/seed`
- `GET /api/realtime` (WebSocket)
- `POST /api/v1/whatsapp/template-messages` (server-to-server API key)
- `GET /api/v1/messages/:messageId` (server-to-server API key)
- `GET|POST /webhooks/whatsapp/:channelId`
- `POST /webhooks/telegram/:channelId`
- `GET|POST /webhooks/instagram/:channelId`
- `GET|POST /webhooks/instagram-app/:appId`
- `POST /webhooks/generic/:channelId`

Every authenticated business-data query includes the session's `workspace_id`. Provider webhook routing resolves a globally unique channel and carries its workspace through storage and realtime delivery.

The public v1 Helixcer Messaging API accepts only server-to-server requests and rejects browser `Origin` headers. Its currently available external-send module is WhatsApp templates; Telegram and Instagram external-send endpoints are not enabled yet. It derives the workspace from a `hxc_live_...` key, which applies to the workspace's WhatsApp connections; each send selects one with `channelId`. An `Idempotency-Key` is optional for backward-compatible retry deduplication, and Helixcer generates an internal operation key when the header is omitted. The API never accepts Meta credentials or provider envelope fields from the caller. See [`../api-docs.html`](../api-docs.html) or [`../docs/whatsapp-template-api.md`](../docs/whatsapp-template-api.md) for the complete contract.

## Managed channel connections

Owners and administrators create connections through `POST /api/channels` and edit them through `PATCH /api/channels/:channelId`. Saving never performs provider verification; `POST /api/channels/:channelId/verify` is an explicit follow-up action. A PATCH keeps every omitted or blank credential unchanged. API responses expose only non-secret configuration, credential-presence booleans, verification timestamps, and provider identity metadata. Decrypted values exist only for the provider call that needs them. The one deliberate readback is `GET /api/channels/:channelId/verify-token`: it is restricted to owners and administrators, audited, and returns only that channel's webhook handshake token when the user chooses Copy. Normal channel-list and bootstrap payloads remain secret-free.

Replacing a Meta access token or App Secret invalidates the provider identity check but preserves an already completed callback handshake. Replacing the Verify Token or changing provider configuration requires webhook verification again; historical `lastWebhookAt` is retained unless the provider identity itself changes.

Provider payloads use these fields:

- WhatsApp Cloud: `config` contains `wabaId`, `phoneNumberId`, and optional `apiVersion`; `credentials` contains `accessToken`, `appSecret`, and `verifyToken`. A valid Meta-signed webhook for the configured Phone Number ID is stored in the Inbox immediately, even before API/provider verification succeeds, and marks the connection as inbound-receiving. Provider verification remains a separate outbound-readiness step: it requires the configured Phone Number ID to belong to the WABA, then subscribes the app with `POST /{WABA_ID}/subscribed_apps`; it completes only when both operations succeed. The Meta dashboard callback and `messages` webhook field still need to be configured manually.
- Telegram Bot: `config` is empty; `credentials` contains `botToken` and `webhookSecret`. Verification calls `getMe` and registers the channel-specific webhook with Telegram.
- Instagram Messaging with Instagram Login: `config` contains `instagramAccountId` and may contain `username`, `appId`, `apiVersion`, and `authMode` (`instagram_login`); `credentials` contains `accessToken`, `appSecret`, and `verifyToken`. A Facebook Page ID is not required.

Meta connections default to Graph API `v26.0`. `GET /api/channels` returns the provider callback as `setup.callbackPath`. WhatsApp and Telegram use channel-specific paths. Instagram connections with an `appId` share `/webhooks/instagram-app/:appId`, matching Meta's app-level webhook model; connections without an `appId` retain `/webhooks/instagram/:channelId` for backward compatibility. The shared handler resolves every entry by `appId` plus `instagramAccountId`, rejects missing or ambiguous mappings before storage, and validates the signature with each resolved connection's stored App Secret. Its verification GET matches the supplied verify token across enabled connections for that app and marks every match verified. WhatsApp and Instagram validate `X-Hub-Signature-256`; Telegram validates `X-Telegram-Bot-Api-Secret-Token`.

Credential rows are encrypted independently with a random nonce and authenticated workspace/channel/field context. Listing channels checks only which credential field rows exist and does not decrypt them. Audit entries contain only the names of credential fields changed, never their values.

For each WhatsApp conversation, list and message responses include `freeformAllowed`, `replyWindowExpiresAt`, and a human-readable reason when the window is closed. The Worker independently rejects free-form text and attachments outside the 24-hour customer-service window; the dashboard cannot bypass this check. `POST /api/conversations/:id/template` sends an already-approved template from the inbox and remains available after the window closes. The external API can also send approved WhatsApp templates. Creating or approving templates remains in Meta's tools, and Instagram messaging remains subject to Meta's own allowed messaging window and permissions.

`GET /api/conversations/:id/templates` derives the WABA and encrypted access token from that conversation's workspace-scoped channel, requests approved templates from Graph API v26.0 (or the saved channel version), and follows at most three cursor pages. Its response never contains a provider token. Each item contains `templateId`, `name`, `language.code`, `status`, `category`, sanitized component definitions, and a flattened `variables` list for text, media-header, named-parameter, and dynamic URL-button inputs. Meta failures are returned as bounded provider errors.

`GET /api/channel-data/whatsapp-templates` is restricted to workspace owners and administrators. It builds a read-only library from every saved WhatsApp Cloud account in the workspace, including disabled accounts, and requests every template status rather than only approved sendable templates. Each sanitized item includes `channelId`, `channelName`, `channelEnabled`, and `providerDisplayName` source metadata. The response also includes searchable filter options for channels, categories, statuses, and languages. One account's bounded, credential-redacted provider failure is returned in `errors` without hiding templates loaded from the other accounts. The Worker follows Meta pagination for up to 1,000 templates per account; accounts beyond that safety bound are listed in `truncatedChannels` so the UI never silently presents a partial library. Non-WhatsApp and cross-workspace channels are never queried.

Contact list, bootstrap, and detail responses include `displayName`/`name`, `company`, `tags`, and canonical `platformIds: { whatsapp, telegram, instagram, facebook, email }`. The legacy `identities` array and singular preferred-route aliases remain temporarily available for older clients and internal route selection.

`GET /api/tags` returns case-insensitively deduplicated suggestions directly from saved workspace contacts; it does not use a device cache or a separate tag-master table. A new tag becomes available after it is saved on a contact. New clients create or update the fixed provider fields with `platformIds: { whatsapp, telegram, instagram, facebook, email }`; at least one ID is required, and omitted keys in a PATCH are preserved. The legacy `identities` routes remain available to older clients and to channel routing, but a contact cannot add a second identity for a supported platform. A current platform ID with conversation history or a connected route cannot be changed or removed. Adding an ID does not create an Inbox thread. `POST /api/conversations` requires the exact contact identity and selected compatible channel; if that pair has no route yet, it safely creates the binding from the flat provider ID after collision and channel-readiness checks, then opens or reuses the conversation. It never guesses a connected account. Deleting a channel removes only that local route and its channel history; it does not delete the master contact or reusable platform ID. Inbound canonical-identity reuse is limited to portable WhatsApp and Telegram identifiers; account-scoped Instagram and Facebook identifiers require an exact binding so equal values from different accounts never auto-merge.

Outbound message status is monotonic: `sent` → `delivered` → `read`, with `failed` retained as terminal. WhatsApp status callbacks, Instagram message echoes/delivery receipts/read watermarks, and configured Generic HTTP status callbacks update the same inbox message and broadcast the change in realtime. Telegram's Bot API confirms a successful send but does not expose recipient delivery/read receipts, so Telegram messages remain accurately labeled `sent` rather than fabricating a receipt.

The attachment endpoint accepts multipart form data with a `file` field and optional `caption`. It supports the WhatsApp media types and limits enforced by this release (up to 16 MiB at the Helixcer edge), uploads the file directly to the configured Meta Phone Number ID, and stores only safe filename/type/size/caption metadata in D1. The provider media ID is kept only in the encrypted temporary outbound payload and removed after terminal submission.

Legacy Generic HTTP and Web Chat paths remain for compatibility. Their old environment-secret resolver is isolated to `generic_http`; managed WhatsApp, Telegram, and Instagram code reads only encrypted D1 credentials and can never fall back to `WA_*`, `BOT_*`, or other per-channel environment variables.

The Worker enforces both per-client and global OAuth-start limits in a Durable Object before writing D1. An additional Cloudflare edge rule for `/auth/google/start` is defense in depth when available on the selected plan. OAuth state rows expire after ten minutes, a new attempt replaces the same browser's prior state, and scheduled cleanup removes expired rows.

## Verification

```sh
node --check worker/src/index.js
node --check worker/src/auth.js
node --test worker/test/*.test.mjs
```

The tests cover migrations and legacy-row backfill, Google RSA/JWK verification and key rotation, OAuth state/nonce/PKCE and abuse limits, configured-owner bootstrap, hashed sessions, one-time email-bound invitations, role boundaries, last-owner protection, exact origins, realtime session revalidation, workspace-scoped data, API-key lifecycle, template validation and encryption, approved-template pagination and sanitization, contact profile updates and identity conflicts, idempotent external sends, rate limits, fast Meta status webhooks, and cross-key isolation.
