# Helixcer Chat for TallyPrime — build 386

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 386)**.

## Fix
Create Config was fully unclickable when `HxcVcMoveToMapping` stayed Yes while the template was not fetched — Config Name / Template / Language were all `Skip`.

Skip those fields only when **fetched and** moving to mapping. Report/Initialize also force MoveToMapping/MoveToConfirm off on open.
