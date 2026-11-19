# Helixcer Chat for TallyPrime — build 409

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 409)**.

## Fix — data not saving
Create/Alter used `Object : Company` + Form Accept after `ALTER TARGET`. Form Accept wrote the form’s stale Company object back and wiped the Aggregate.

- Persist with `NEW OBJECT : Company` + `SAVE TARGET`
- Create/Alter have **no** `Object : Company` (session UI only)
- After save: Msg Box → Form Reject (close UI, do not re-accept Company)
- List still uses `Object : Company` to read saved rows
