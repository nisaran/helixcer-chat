# Helixcer public downloads Worker

Optional helper Worker that serves installer packages from the
`helixcer-public-downloads` R2 bucket. Production traffic uses the same
`GET /downloads/*` route on `helixcer-chat-api` (`api.chat.helixcer.com`).

This standalone Worker remains available as `helixcer-downloads` for service
bindings or future gateway routing.
