# Helixcer Chat for TallyPrime — build 392

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 392)**.

## Fix
"Enter Template Name first" while Template Name was filled: Language Accept overwrote `HxcVcFetchName` with empty `##HxcVcDraftTemplate`, and Fetch did the same.

Template Accept now sets `FetchName` from `$Value` after clear. Language/Fetch **keep** that `FetchName` instead of wiping it.
