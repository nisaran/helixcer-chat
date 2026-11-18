# Helixcer Chat for TallyPrime — build 351

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer-chat.tdl

Title must show **(build 351)**.

## Create Config

1. Config Name → Template → Language **Enter** (fetch)
2. Preview + **variable mapping** — only fetched vars, **max 4**
3. Media Header
4. **Voucher Types** — dynamic rows (pick a type; blank row ends the list)
5. Auto / Confirm → **Ctrl+A**

## Dynamic behaviour

- Mapping rows appear only after a successful template fetch; at most four API variables are mapped (extras ignored).
- Voucher types use a repeating Aggregate list (not fixed slots 1–8).
