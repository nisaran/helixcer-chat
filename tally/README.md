# Helixcer Chat for TallyPrime — build 411

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 411)**.

## Fix — c0000005 while saving
Procedural save (`NEW OBJECT` / `SAVE TARGET` / `ACCEPT ALTER`) on Form Accept crashes Tally (`c0000005`).

**Crash-free path (same as API Settings / build 345):**
- Create/Alter: `Alter` + `Object : Company` + `Storage` on Aggregate
- Config Name line → **Detail SubForm** (fetch + mapping + voucher types + settings)
- **Ctrl+A** on detail, then **Ctrl+A** on the name list (default Form Accept — no custom object code)

## Flow
1. Create Config → type name on blank line → detail opens
2. Template + Language → Enter/Alt+F fetch → map fields
3. Ctrl+A (detail) → Ctrl+A (list) → List Configs shows the row
