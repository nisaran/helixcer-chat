# Helixcer Chat for TallyPrime — build 343

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer_chat.tdl

Company must be open. Title must show **(build 343)**.

## API Settings

Enter Workspace ID / Channel ID / API Key → **Ctrl+A**.

## Status

Connection check via Helixcer `GET /api/v1/connection`.

## Voucher Config (phase 1 shell)

Menu → **Voucher Config** (`V`).

| Column | Meaning |
|--------|---------|
| Config Name | Your label |
| Template | WhatsApp template name (fetch in phase 2) |
| Lang | e.g. `en_US` |
| Voucher Types | Pick from list or type names |
| Media | None / Voucher PDF / HTML / XML / Excel |
| Auto | Auto-select after voucher save? |
| Confirm | Confirm before send? (used when Auto = Yes) |

Add rows in the grid → **Ctrl+A**.

**Not in phase 1:** template API fetch, variable mapping, preview, send.

## Honesty

This agent cannot run TallyPrime. Verify Accept/list locally. If Aggregate rows do not persist, report the exact Tally message.
