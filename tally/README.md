# Helixcer Chat for TallyPrime — build 396

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 396)**.

## Fix
Applicable Voucher Types still showed Service Sales / Inventory Sales because Company aggregate `HxcVcDraftVchs` would not clear.

Voucher types now use session Variables `HxcVcVchType1..6` (blank on Create / after clear). Alter still loads saved CSV into those slots.
