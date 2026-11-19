# Helixcer Chat for TallyPrime — build 399

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 399)**.

## Fix
Blank Template Name in the UI still fetched a previous template: `CreateBlank` painted the field empty while Company Storage still held the old name, and Fetch used Storage.

Before Fetch, CreateBlank is released (Storage wiped if still masked). Stale `HxcVcFetchName` is cleared with fetch vars. Empty template → **Enter Template Name first** (real HTTP only when a name is present).
