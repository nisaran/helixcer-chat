# Helixcer Chat for TallyPrime — build 385

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 385)**.

Based on your attached build 384 (custom value, End of List, MoveToMapping).

## Fix
Create Config now clears all Company draft UDFs on **Form Create** (`Hxc Initialize New Config`), so Config Name / Template Name / mappings / options are empty every open. Fetch still clears mapping slots; Restore Custom Mappings only runs when Alter has an EditKey.
