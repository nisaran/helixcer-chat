# Helixcer Chat for TallyPrime — build 410

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 410)**.

## Fix — Software Exception c0000005 on save
Build 409 crashed with `c0000005` using `NEW OBJECT` + `SAVE TARGET` + `Form Reject` on Form Accept.

Safe path:
- Function `Object : Company : ##SVCurrentCompany`
- `INSERT` / update Aggregate + `ACCEPT ALTER`
- Create/Alter form has no `Object : Company`
- Close with `Form Accept` (UI only)
