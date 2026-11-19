# Helixcer Chat for TallyPrime — build 401

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 401)**.

## Root cause (prefill)

Create UI was bound to **Company Storage** draft UDFs (`HxcVcDraftName` / `HxcVcDraftTemplate` / `HxcVcDraftLang`) and **Aggregate** `HxcVcDraftVchs`. Those values persist in the company file, so Create kept showing the previous session (Sales / invoice_generated_doc / Service Sales / Inventory Sales). Clearing with `SET VALUE` / Aggregate `DELETE` / `CreateBlank` paint did not reliably reset field buffers — and CreateBlank caused inputs to vanish on Enter.

## Fix (build 401)

Create draft is **session Variables only**:

- Config Name / Template / Language → `##HxcVcDraftName` / `##HxcVcDraftTemplate` / `##HxcVcDraftLang`
- Voucher types → progressive `##HxcVcVchType1`…`12` (next row appears after you fill the previous; End of List / blank ends)
- Fetch reads `##HxcVcDraftTemplate` (never Company draft Storage)
- Report Create + Clear Draft `SET` all draft Variables empty on open
- Company Storage is only for **saved** `HxcVoucherConfigs` on Commit
