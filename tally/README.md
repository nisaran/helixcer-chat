# Helixcer Chat for TallyPrime — build 394

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 394)**.

## Fix
Fetch works with Storage; Create was still pre-filled from Company draft UDFs.

Create sets `HxcVcCreateBlank` and paints Name/Template/Language empty (`Set Always`). On first focus, `Hxc Release Create Blank` wipes Storage again then allows typing. Fetch still reads `$HxcVcDraftTemplate`.
