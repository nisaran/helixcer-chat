# Helixcer Chat

Helixcer Chat is a zero-monthly-cost omnichannel inbox designed for GitHub Pages and Cloudflare's free developer platform. The dashboard is static HTML, CSS, and JavaScript; the API runs on a Cloudflare Worker with D1 and a Durable Object for realtime updates.

## What is included

- Responsive shared inbox with search, filters, contacts, channel health, assignments, statuses, and demo mode.
- Google sign-in with server-side sessions, plus Owner, Admin, and Agent workspace roles.
- Team invitations, member enable/disable controls, and protection against removing the last active Owner.
- REST API backed by indexed D1 tables for contacts, identities, conversations, messages, webhook deduplication, retries, and audit history.
- Realtime browser refresh through a hibernatable Durable Object WebSocket.
- WhatsApp Cloud API v25.0 webhooks with Meta signature verification, phone-number binding, inbound text, outbound text, delivery status updates, and encrypted Worker secrets.
- D1 outbox with scheduled exponential-backoff retries. No paid queue is required.

## Repository layout

```text
index.html                 GitHub Pages entry point
assets/                    Dashboard JavaScript and styles
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
4. Configure Google OAuth secrets and set `BOOTSTRAP_OWNER_EMAIL` to the verified Google email that may claim the first Owner membership.
5. Export the current D1 database, apply all migrations, deploy the Worker, and deploy the Pages gateway.
6. Sign in with the configured owner email and verify the inbox, team roles, and realtime connection before publishing the updated GitHub Pages frontend.
7. Add the WhatsApp Cloud API credentials as encrypted Worker secrets and verify the number from the dashboard.
8. Subscribe Meta to `https://api.chat.helixcer.com/webhooks/whatsapp/wa-main`, then confirm the dashboard reports **Live** before sending production messages.

Never place Google credentials, provider tokens, signing secrets, the bootstrap owner email, or a recovery token in GitHub.

The primary Owner is not hardcoded. The first matching, Google-verified identity can claim ownership only while the membership table is empty. After that one-time bootstrap, D1 memberships are authoritative and changing the environment value cannot replace the Owner. New people require an email-bound invitation.

The current UI intentionally exposes one workspace and no billing. Business records, memberships, sessions, realtime hubs, and audit entries already carry `workspace_id`, so a future SaaS version can add workspace provisioning and switching without redesigning the inbox data model.

## Cost controls

The application is intended to remain on GitHub Pages and Cloudflare free plans. It uses D1 instead of Sheets, a Durable Object instead of polling, and a scheduled D1 outbox instead of a paid queue. If a free usage ceiling is reached, keep the account on the free plan so requests stop rather than generating infrastructure overage charges. Channel providers such as WhatsApp may still charge for messages.

## Safe rollout and rollback

Before migration, export D1 and record the currently deployed Worker version plus the current GitHub Pages commit. Deploy and verify the Worker/custom domain first, then publish the frontend, and switch provider callbacks last. If application behavior regresses, restore the prior Worker version and Pages commit. Migration `0002` is additive and remains compatible with the previous Worker because every new business-table column has a default; restore the D1 export only if data itself was corrupted.

