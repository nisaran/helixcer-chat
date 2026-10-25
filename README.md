# Helixcer Chat

Helixcer Chat is a zero-monthly-cost omnichannel inbox designed for GitHub Pages and Cloudflare's free developer platform. The dashboard is static HTML, CSS, and JavaScript; the API runs on a Cloudflare Worker with D1 and a Durable Object for realtime updates.

## What is included

- Responsive shared inbox with search, filters, contacts, channel health, assignments, statuses, and demo mode.
- REST API backed by indexed D1 tables for contacts, identities, conversations, messages, webhook deduplication, retries, and audit history.
- Realtime browser refresh through a hibernatable Durable Object WebSocket.
- WhatsApp Cloud API webhooks with Meta signature verification, inbound text, outbound text, and delivery status updates.
- Telegram webhook verification and inbound/outbound text.
- Generic HTTPS connector with explicit host allowlisting and redirects disabled.
- D1 outbox with scheduled exponential-backoff retries. No paid queue is required.

## Repository layout

```text
index.html                 GitHub Pages entry point
assets/                    Dashboard JavaScript and styles
worker/src/index.js        Cloudflare Worker API
worker/migrations/         D1 schema
worker/test/               Node tests
wrangler.toml              Cloudflare deployment configuration
```

## Local preview

Serve the repository root with any static HTTP server and open the printed local URL. With no Worker URL configured, the dashboard automatically uses safe demo data.

```sh
python -m http.server 4173
```

Run the backend checks with:

```sh
node --test worker/test/*.test.mjs
```

## Cloudflare deployment

The Worker setup is documented in [`worker/README.md`](worker/README.md). In summary:

1. Create the `helixcer-chat` D1 database.
2. Put its database ID in `wrangler.toml`.
3. Apply the D1 migration.
4. Add a strong `ADMIN_TOKEN` as a Worker secret.
5. Deploy the Worker and enter its `workers.dev` URL plus the admin token in the dashboard Settings dialog. The token stays in that browser's local storage and is never committed.
6. Create channels in the dashboard, then add their provider credentials as Worker secrets.
7. Change the production provider webhook only after test messages work end to end.

Never place provider tokens, signing secrets, or the admin token in GitHub.

## Cost controls

The application is intended to remain on GitHub Pages and Cloudflare free plans. It uses D1 instead of Sheets, a Durable Object instead of polling, and a scheduled D1 outbox instead of a paid queue. If a free usage ceiling is reached, keep the account on the free plan so requests stop rather than generating infrastructure overage charges. Channel providers such as WhatsApp may still charge for messages.

## Existing Apps Script data

Keep the current Sheet and Apps Script deployment available as rollback until the Cloudflare version is verified. Export and migrate records without copying Script Properties or other secrets. Switch the live WhatsApp callback last.

