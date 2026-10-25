# Helixcer Chat

Helixcer Chat is a zero-monthly-cost omnichannel inbox designed for GitHub Pages and Cloudflare's free developer platform. The dashboard is static HTML, CSS, and JavaScript; the API runs on a Cloudflare Worker with D1 and a Durable Object for realtime updates.

## What is included

- Responsive shared inbox with search, filters, contacts, channel health, assignments, statuses, and demo mode.
- Google sign-in with server-side sessions, plus Owner, Admin, and Agent workspace roles.
- Team invitations, member enable/disable controls, and protection against removing the last active Owner.
- REST API backed by indexed D1 tables for contacts, identities, conversations, messages, webhook deduplication, retries, and audit history.
- Realtime browser refresh through a hibernatable Durable Object WebSocket.
- Any number of WhatsApp Cloud, Telegram Bot, and Instagram Messaging connections per workspace, with provider verification, signed/token-protected webhooks, and inbound/outbound text.
- Channel credentials save immediately without calling the provider. Verification is a separate, explicit action, and administrators can copy a saved webhook verify token on demand without exposing it in normal channel payloads.
- Provider credentials encrypted in D1 under one Cloudflare Worker master secret; no per-channel environment bindings or secrets are exposed to the browser.
- D1 outbox with scheduled exponential-backoff retries. No paid queue is required.
- WhatsApp conversations enforce Meta's 24-hour customer-service window. When it closes, the free-form composer is blocked and agents can send an approved template instead.
- WhatsApp agents can attach supported images, videos, audio, and documents. Files are uploaded directly to Meta and are not copied into paid Helixcer object storage.
- A Settings page controls browser notifications for new customer messages while the Helixcer dashboard is open.
- Workspace API keys and a server-to-server Helixcer Messaging API. Its first available module sends WhatsApp templates and records each external send in the shared inbox before dispatching it to Meta.
- Built-in API documentation for simple templates, variables, media headers, static and dynamic buttons, authentication, Flow, catalog, carousel, and future Meta-native components.
- Supplied Helixcer artwork is used for dashboard branding and the browser icon. Google callback failures return to the branded sign-in screen with a safe, readable error instead of a raw Worker exception page.

## Repository layout

```text
index.html                 GitHub Pages entry point
api-docs.html              Browser-friendly Helixcer Developer API reference
assets/                    Dashboard JavaScript, styles, and Helixcer brand assets
docs/                      Markdown API reference
worker/src/index.js        Cloudflare Worker API
worker/migrations/         D1 schema
worker/test/               Node tests
gateway/                   Cloudflare Pages API gateway
wrangler.toml              Cloudflare deployment configuration
```

## Local preview

Serve the repository root with any static HTTP server and open the printed local URL. With no Worker URL configured, the dashboard automatically uses safe demo data.

```sh
python -m http.server 4173
```

Run the backend checks with:

```sh
node --test assets/frontend.test.mjs worker/test/*.test.mjs gateway/*.test.mjs
```

## Cloudflare deployment

The Worker setup is documented in [`worker/README.md`](worker/README.md). In summary:

1. Create the `helixcer-chat-v2` D1 database and put its ID in `wrangler.toml`.
2. Deploy `gateway/` as the `helixcer-chat-gateway` Pages project, associate `api.chat.helixcer.com`, and point only that external-DNS subdomain to `helixcer-chat-gateway.pages.dev`. The gateway calls the Worker over a service binding; this same-site hostname is required for the secure login cookie used by `chat.helixcer.com`.
3. Create a Google Web OAuth client with the exact callback `https://api.chat.helixcer.com/auth/google/callback`.
4. Configure Google OAuth secrets, set `BOOTSTRAP_OWNER_EMAIL` to the verified Google email that may claim the first Owner membership, and create one strong `CHANNEL_CREDENTIALS_KEY` Worker secret.
5. Export the current D1 database, apply all migrations, deploy the Worker, and deploy the Pages gateway.
6. Sign in with the configured owner email and verify the inbox, team roles, and realtime connection before publishing the updated GitHub Pages frontend.
7. Add each WhatsApp, Telegram, or Instagram connection in the dashboard. The Worker encrypts its credentials in D1; do not create `WA_MAIN_*` or other per-channel Worker secrets.
8. Save the channel, copy its callback and verify token, and configure them at the provider. Saving never calls Meta or another provider. WhatsApp starts placing correctly signed inbound webhook messages in the Inbox as soon as they arrive, without waiting for API/provider verification. Run the separate **Verify connection** action before relying on outbound replies. Managed Meta calls default to Graph API v26.0.
9. Open **Developer API** from the sidebar and create a one-time workspace API key for each external backend or automation. Each key belongs to the workspace, and each request selects the appropriate connection with `channelId`. The currently available external-send module is WhatsApp templates; use [`api-docs.html`](api-docs.html) for its request contract and examples.

Never place Google credentials, provider tokens, signing secrets, the bootstrap owner email, or a recovery token in GitHub.

The primary Owner is not hardcoded. The first matching, Google-verified identity can claim ownership only while the membership table is empty. After that one-time bootstrap, D1 memberships are authoritative and changing the environment value cannot replace the Owner. New people require an email-bound invitation.

The current UI intentionally exposes one workspace and no billing. Business records, memberships, sessions, realtime hubs, and audit entries already carry `workspace_id`, so a future SaaS version can add workspace provisioning and switching without redesigning the inbox data model.

## Cost controls

The application is intended to remain on GitHub Pages and Cloudflare free plans. It uses D1 instead of Sheets, a Durable Object instead of polling, and a scheduled D1 outbox instead of a paid queue. If a free usage ceiling is reached, keep the account on the free plan so requests stop rather than generating infrastructure overage charges. Channel providers such as WhatsApp may still charge for messages.

## Safe rollout and rollback

Before migration, export D1 and record the currently deployed Worker version plus the current GitHub Pages commit. Deploy and verify the Worker/custom domain first, then publish the frontend, and switch provider callbacks last. If application behavior regresses, restore the prior Worker version and Pages commit. Migration `0004` adds the encrypted credential vault and removes only the untouched, unreferenced `wa-main` placeholder. Migration `0005` adds hashed workspace API keys, encrypted temporary outbound payloads, and idempotency records without changing existing inbox rows. Restore the D1 export if a schema migration itself must be rolled back or if data was corrupted.

