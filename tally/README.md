# Helixcer Chat for TallyPrime — build 381

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 381)**.

## Cursor skip fix
Repeat aggregate Body/Button rows were showing **section titles** (flags set) but **no editable fields** (collection empty), so Tab jumped from Header to Voucher Type.

## This build
- Fetch = build 368
- Body/Button = **focusable** `HxcVcDMFld*` fields (Field Inactive when slot unused)
- Button section hidden when template has no button vars
- Unused Body slots may still leave some blank space (Tally cannot Line-Inactive — T0014)
