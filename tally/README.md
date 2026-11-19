# Helixcer Chat for TallyPrime — build 404

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 404)**.

## Fix — List / Alter empty after save
Saved configs did not show in List Config / Alter Config because Commit used bare `SET TARGET` + `ALTER TARGET` during Form Accept, so Aggregate rows were not left on the Company object that Form Accept persists.

- `SET TARGET : Company : ##SVCurrentCompany` before INSERT/UPDATE
- `SET TARGET : ..` after write
- Do **not** `ALTER TARGET` inside Commit — Form Accept persists Company + Aggregate
- Collection `Belongs To : Yes` for reliable listing

Also keeps your working Create flow: `#HxcVcTemplateNameInput` fetch, List Variable voucher rows, Custom Value `Control` mandatory.
