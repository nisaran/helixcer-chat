# Helixcer Chat API gateway

This Cloudflare Pages Function exposes the private Worker service through
`api.chat.helixcer.com` while `helixcer.com` remains on an external DNS provider.
It forwards HTTP and WebSocket requests to the `helixcer-chat-api` Worker through
a Cloudflare service binding, so no provider credentials are copied into Pages.

Deploy from this directory with:

```sh
wrangler pages deploy
```

Associate `api.chat.helixcer.com` with the Pages project before creating the
external DNS CNAME that targets `helixcer-chat-gateway.pages.dev`.
