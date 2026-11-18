# Helixcer Chat for TallyPrime — build 344

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer_chat.tdl

Company must be open. Titles must show **(build 344)**.

## API Settings

Enter Workspace ID / Channel ID / API Key → **Ctrl+A**.

## Status

Connection check via Helixcer `GET /api/v1/connection`.

## Voucher Config

Helixcer Chat → **Voucher Config**:

| Menu | What |
|------|------|
| **Create Config** (`C`) | Popup form: Config Name, Template, Language, Voucher Type, Media Header, Auto Select, Confirm → **Ctrl+A** |
| **Alter Config** (`A`) | Select config → same form → **Ctrl+A** |
| **List Configs** (`L`) | Read-only table |

**Not in this build:** template API fetch, variable mapping, preview, send.

## Honesty

Create/Alter save uses Tally procedural `INSERT COLLECTION OBJECT` / `WALK` + `ALTER TARGET` on Company Aggregate UDF. This agent cannot run TallyPrime — if save fails, report the exact message.
