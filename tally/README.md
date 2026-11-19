# Helixcer Chat for TallyPrime — build 388

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 388)**.

## Fix
Build 387 broke Create Config open (`Call` + `Action : Alter`). Menu is back to `Alter` so the form opens.

Create still blanks previous draft via `HxcVcCreateBlank` + `Set Always` on Storage fields (Form Create clear alone paints too late).
