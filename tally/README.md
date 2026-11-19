# Helixcer Chat for TallyPrime — build 406

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 406)**.

## Fix — config not saving
`SET TARGET : Company` during Form Accept moved Aggregate writes off the form’s Company object, so Form Accept did not persist them. Msg Box inside Commit could also interrupt Accept.

- Write Aggregate on the form’s current Company object (no `SET TARGET : Company`)
- Persist with Form Accept first, then show “Config saved.”
