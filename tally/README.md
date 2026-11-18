# Helixcer Chat for TallyPrime — build 345

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer_chat.tdl

Company must be open. Titles must show **(build 345)**.

## Crash note (344)

Build **344** crashed (`c0000005`) on Create/Alter/List because those used `Display` + custom `On Form Accept` / procedural insert. Build **345** uses only **`Alter` + `Object : Company` + `Storage`**, same as API Settings.

## API Settings

Workspace ID / Channel ID / API Key → **Ctrl+A**.

## Voucher Config

| Menu | What |
|------|------|
| **Create Config** | Type **Config Name** on the blank line → **detail popup** (Template, Language, Voucher Type, Media, Auto, Confirm) → **Ctrl+A** |
| **Alter Config** | Select a name → same popup → **Ctrl+A** |
| **List Configs** | Read-only table |

## Honesty

Cannot run TallyPrime here. If Create still crashes, say which menu item and whether the name line appeared before the error.
