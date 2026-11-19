# Helixcer Chat for TallyPrime — build 402

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 402)**.

## Fix
Fetch said "Enter Template Name first" while Template Name was filled on screen: fields used `Variable` without `Modifies`, so the typed input never landed in `##HxcVcDraftTemplate`. Fetch then read the empty Variable (not the input field).

- Name / Template / Language / voucher slots use `Modifies` (same pattern as API Settings)
- Template Accept locks `HxcVcFetchName` from `$Value`
- Language Accept does not overwrite FetchName with an empty Variable
- `Clear Fetch Vars` no longer wipes FetchName / FetchLang (request inputs)
