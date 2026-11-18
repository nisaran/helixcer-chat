# Helixcer Chat for TallyPrime — build 352

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer-chat.tdl

Title must show **(build 352)**.

## Create Config

1. Config Name → Template → Language **Enter** (fetch)
2. Preview + **variable mapping** — only fetched vars, **max 4**
3. Media Header
4. **Voucher Types** — dynamic rows (blank ends the list)
5. Auto / Confirm → **Ctrl+A**

## Fetch fix (352)

Template HTTP URL now uses `##` variables (not `$` Storage inside the Function). Fetch is by template **name** + channel (language `en` vs `en_US` no longer 404s the request).
