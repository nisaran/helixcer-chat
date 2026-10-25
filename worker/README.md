# Helixcer Chat Cloudflare backend

The backend uses Cloudflare Workers, D1, a scheduled D1 outbox, and a Durable Object WebSocket hub. It has no runtime package dependency and is designed for Cloudflare's free allowances.

## Architecture

- D1 stores workspaces, verified users, workspace memberships, server-side sessions, invitations, channels, contacts, conversations, messages, retries, webhook deduplication, and audit events.
- Google OAuth uses Authorization Code + PKCE + state + nonce. Google ID-token signatures are verified against Google's rotating JWK set with Web Crypto; issuer, audience, expiry, nonce, stable `sub`, and verified email are checked.
- The browser receives only a random `__Host-helixcer_session` cookie. It is host-only, `HttpOnly`, `Secure`, and `SameSite=Lax`; D1 stores only its SHA-256 hash.
- Durable Object instances and broadcasts are keyed by `workspace_id`. Each socket carries only server-internal session metadata and is revalidated before events or keepalive replies; logout, disablement, and role changes disconnect affected sockets.
- WhatsApp, Telegram, and generic provider webhooks retain independent signature/token verification and do not depend on an agent session.
- Failed outbound messages use the D1 outbox and a one-minute scheduled retry with exponential backoff.

The initial migration seeds one empty workspace, never an administrator. On the first successful Google login, an owner membership is created only if there are no memberships and the verified Google email exactly matches `BOOTSTRAP_OWNER_EMAIL`. Future users require an invitation.

## Required configuration

Public Worker variables in `wrangler.toml`:

- `APP_ORIGIN`: dashboard origin used for safe post-login redirects.
- `ALLOWED_ORIGINS`: exact comma-separated browser origins; wildcards are not accepted.
- `DEFAULT_WORKSPACE_ID`: currently `ws_default`.
- `SESSION_TTL_SECONDS`: defaults to seven days and is capped at 30 days.
- `RECOVERY_MODE`: leave `false`; set to `true` only for a short, supervised recovery window.
- `OAUTH_RATE_LIMIT_WINDOW_SECONDS`, `OAUTH_RATE_LIMIT_PER_CLIENT`, and `OAUTH_RATE_LIMIT_GLOBAL`: bound anonymous login starts in the existing Durable Object before D1 is written.

Configure these as Worker secrets/environment variables; never commit real values:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
npx wrangler secret put BOOTSTRAP_OWNER_EMAIL
```

`ADMIN_TOKEN` is optional emergency recovery access. It is ignored unless `RECOVERY_MODE=true`, is accepted only through `Authorization: Bearer` or `X-Admin-Token`, and should be rotated or deleted immediately after the incident. Normal browser use relies on the session cookie. There is no email-override header and no URL-token authentication.

For a supervised recovery only, create a fresh token with `npx wrangler secret put ADMIN_TOKEN`, temporarily change `RECOVERY_MODE` to `"true"`, and deploy. Never reactivate a legacy shared token because older browsers may retain a copy. When recovery is complete, change recovery mode back to `"false"`, deploy again, and run `npx wrangler secret delete ADMIN_TOKEN` (or rotate it if an incident runbook requires keeping one).

For local development, copy `.dev.vars.example` to `.dev.vars`. The real `.dev.vars` file is ignored.

## Google OAuth setup

Create a Google Web OAuth client and register the exact callback configured by `GOOGLE_REDIRECT_URI`, for example:

```text
https://api.chat.helixcer.com/auth/google/callback
```

No Google refresh token is requested or stored; Google is used only to verify identity during sign-in.

## Database and deployment

Create D1 once, place its ID in `wrangler.toml`, then apply every migration in order:

```sh
npx wrangler d1 migrations apply helixcer-chat-v2 --remote
npx wrangler deploy
```

Migration `0002_identity_and_workspaces.sql` is additive. It preserves existing inbox rows, assigns them to `ws_default`, and creates identity/session/team tables. It does not seed a person or billing data.

Deploy the Worker on its `workers.dev` hostname, then deploy the repository's `gateway/` Pages Function with an `API` service binding to this Worker. Associate the Pages project with `api.chat.helixcer.com` and, at the external DNS provider, point only the `api.chat` CNAME to `helixcer-chat-gateway.pages.dev`. Keep the GitHub Pages dashboard at `chat.helixcer.com` and list only the dashboard origin in `ALLOWED_ORIGINS`. The checked-in frontend uses the branded API hostname; browsers never call the `workers.dev` hostname directly because its host-only `SameSite=Lax` cookie would be cross-site.

The gateway holds no Google or channel secret. HTTP and WebSocket requests are passed to the Worker over Cloudflare's internal service binding. Deploy it from `gateway/` with `npx wrangler pages deploy` after the Worker is available.

## Authentication and team API

- `GET /auth/google/start?return_to=URL&invite=TOKEN` — begins Google login. `return_to` and the `returnTo` alias are accepted only when their origin exactly matches the allowlist.
- `GET /auth/google/callback` — consumes code/state/PKCE, verifies the Google ID token, and creates a server session.
- `GET /api/me` — current verified user, workspace, membership, and role.
- `POST /api/logout` or `/auth/logout` — revokes the session and clears its cookie.
- `GET /api/team` — owner/admin member and pending-invitation list.
- `POST /api/team/invitations` — creates a hashed, email-bound, seven-day invitation and returns its one-time login URL.
- `PATCH /api/team/members/:membershipId` — updates `role` and/or `status` (`active` or `disabled`).
- `PATCH /api/team/invitations/:invitationId` — cancels a pending invitation.

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
- `GET /api/conversations`
- `PATCH /api/conversations/:id`
- `GET|POST /api/conversations/:id/messages`
- `GET|POST /api/contacts`
- `POST /api/demo/seed`
- `GET /api/realtime` (WebSocket)
- `GET|POST /webhooks/whatsapp/:channelId`
- `POST /webhooks/telegram/:channelId`
- `POST /webhooks/generic/:channelId`

Every authenticated business-data query includes the session's `workspace_id`. Provider webhook routing resolves a globally unique channel and carries its workspace through storage and realtime delivery.

## Channel secrets

For a WhatsApp channel whose `secretKey` is `WA_MAIN`:

```sh
npx wrangler secret put WA_MAIN_ACCESS_TOKEN
npx wrangler secret put WA_MAIN_PHONE_NUMBER_ID
npx wrangler secret put WA_MAIN_VERIFY_TOKEN
npx wrangler secret put WA_MAIN_APP_SECRET
```

For a Telegram channel whose `secretKey` is `TELEGRAM_MAIN`:

```sh
npx wrangler secret put TELEGRAM_MAIN_BOT_TOKEN
npx wrangler secret put TELEGRAM_MAIN_WEBHOOK_TOKEN
```

Generic connector `config.allowedHosts` must explicitly allow its HTTPS destination. With `secretKey` `CUSTOM`, `{{secret:API_TOKEN}}` resolves the encrypted `CUSTOM_API_TOKEN` binding.

The current `ws_default` workspace retains simple prefixes such as `WA_MAIN` for compatibility. Any future non-default workspace automatically receives a workspace-derived prefix, so its administrators cannot select another workspace's provider-secret namespace.

For example, a future workspace ID `ws_acme` and requested prefix `WA_MAIN` are stored as `WS_WS_ACME_WA_MAIN`; its access-token binding is therefore `WS_WS_ACME_WA_MAIN_ACCESS_TOKEN`. Provision these bindings as part of the future workspace-creation service, not through a tenant-facing secret-name field.

The Worker enforces both per-client and global OAuth-start limits in a Durable Object before writing D1. An additional Cloudflare edge rule for `/auth/google/start` is defense in depth when available on the selected plan. OAuth state rows expire after ten minutes, a new attempt replaces the same browser's prior state, and scheduled cleanup removes expired rows.

## Verification

```sh
node --check worker/src/index.js
node --check worker/src/auth.js
node --test worker/test/*.test.mjs
```

The tests cover both migrations and legacy-row backfill, Google RSA/JWK verification and key rotation, OAuth state/nonce/PKCE and abuse limits, configured-owner bootstrap, hashed sessions, one-time email-bound invitations, role boundaries, last-owner protection, exact origins, realtime session revalidation, and workspace-scoped bootstrap data.
