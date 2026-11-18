# Helixcer Chat for TallyPrime

## Load

1. Add `tally/helixcer-chat.tdl` (F1 → TDLs & AddOns) and enable it.
2. Gateway → **Helixcer Chat** → **API Settings**.
3. Enter Workspace ID, Channel ID, API Key (Tab through each field).
4. Enter / Ctrl+A → **Do you want to save?** → Yes.
5. Reopen: IDs stay filled; API Key shows `******`.

## How values are kept

- System **Persistent** variables (via **Modify System**, not Modify Variable)
- Backup file `HelixcerChat.pvf` via Save Variable / Load Variable

`Storage:` is for master/voucher/UDF fields in an object context. This settings screen uses Persistent variables instead.

This screen **saves only** — it does not call the Helixcer API.
