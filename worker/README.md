# Helixcer Chat Cloudflare backend

This replaces the former Apps Script + Sheets backend with Cloudflare Workers, D1, and a Durable Object WebSocket hub. It has no runtime dependencies and targets Cloudflare's free allowances for a small support team.

## Included

- Indexed D1 schema for channels, contacts, identities, conversations, messages, webhook deduplication, retries, agents, and audit logs.
- REST endpoints used by the GitHub Pages dashboard.
- Hibernatable Durable Object WebSocket fan-out for live refreshes.
- WhatsApp verification, `X-Hub-Signature-256` validation, inbound normalization, delivery-status processing, and outbound text.
- Telegram secret-token verification plus inbound and outbound text messages.
- Generic signed webhook/HTTP connector with an explicit destination-host allowlist.
- D1 outbox and one-minute scheduled retry with exponential backoff.

## One-time setup

These commands create or change Cloudflare resources. Run them from an authenticated Wrangler session.

```sh
npx wrangler d1 create helixcer-chat-v2
```

Put the returned database ID in `wrangler.toml`, then run:

```sh
npx wrangler d1 migrations apply helixcer-chat-v2 --remote
npx wrangler secret put ADMIN_TOKEN
```

For a WhatsApp channel whose `secretKey` is `WA_MAIN`, configure:

```sh
npx wrangler secret put WA_MAIN_ACCESS_TOKEN
npx wrangler secret put WA_MAIN_PHONE_NUMBER_ID
npx wrangler secret put WA_MAIN_VERIFY_TOKEN
npx wrangler secret put WA_MAIN_APP_SECRET
npx wrangler deploy
```

For a Telegram channel whose `secretKey` is `TELEGRAM_MAIN`:

```sh
npx wrangler secret put TELEGRAM_MAIN_BOT_TOKEN
npx wrangler secret put TELEGRAM_MAIN_WEBHOOK_TOKEN
```

Meta callback URL:

```text
https://YOUR-WORKER.workers.dev/webhooks/whatsapp/CHANNEL_ID
```

Never commit tokens. Wrangler secrets are encrypted bindings.

## API

Authenticated routes accept `Authorization: Bearer ADMIN_TOKEN`.

- `GET /health`
- `GET /api/bootstrap`
- `GET|POST /api/channels`
- `GET /api/conversations`
- `PATCH /api/conversations/:id`
- `GET|POST /api/conversations/:id/messages`
- `GET|POST /api/contacts`
- `POST /api/demo/seed`
- `GET /api/realtime?token=ADMIN_TOKEN` (WebSocket)
- `GET|POST /webhooks/whatsapp/:channelId`
- `POST /webhooks/telegram/:channelId`
- `POST /webhooks/generic/:channelId`

For a larger team, replace the shared token with Cloudflare Access or OAuth. The token is suitable for a controlled MVP and must never appear in committed JavaScript.

## Generic connector security

`config.allowedHosts` must include the host in `config.endpoint`. A webhook caller sends `X-Webhook-Token`. With `secretKey` `CUSTOM`, configure `CUSTOM_WEBHOOK_TOKEN`; a template reference such as `{{secret:API_TOKEN}}` resolves `CUSTOM_API_TOKEN`.

## Tests

```sh
node --test worker/test/*.test.mjs
```
