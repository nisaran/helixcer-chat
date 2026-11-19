# Helixcer Chat for TallyPrime — build 372

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 372)**.

## Fetch Template (same mechanism as build 368)

- **Enter** on **Language** → `SET` lang/name → `CALL : Hxc Fetch Template` → `Field Accept`
- **Alt+F**
- **Enter** on the **Fetch** gate line (keeps Enter from jumping to Accept?)

HTTP path: `Hxc Fetch Template` → `HTTP Request` → `Hxc Apply Template Response` (sets FK/FC/preview/`HxcVcFetched`).  
After success, clear draft map fields, then `CALL : Hxc Sync Map Rows From Slots` to build Body/Button Repeat rows (UI only).

`Accept?` is **Save** (Ctrl+A), not fetch.
