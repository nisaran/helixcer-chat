# Helixcer Chat for TallyPrime

TDL add-on that connects TallyPrime to Helixcer Chat (WhatsApp templates and more).

## What is included so far

- **Helixcer Chat** menu item on **Gateway of Tally** (hotkey `H`)
- Submenu with **API Settings** and **About**
- **API Settings** fields (saved across Tally restarts):
  - Workspace ID
  - Channel ID
  - API Key
  - Workspace Name / Channel Name (fetched automatically)
  - Connection status

## Load the TDL in TallyPrime

1. Open TallyPrime with a company loaded.
2. Press **F1** (Help) → **TDLs & AddOns**  
   (or from Gateway: **F4** / Manage Local TDLs, depending on your release).
3. Add file: `tally/helixcer-chat.tdl` from this repository.
4. Set **Load TDLs on startup** / enable the file → **Yes**.
5. Restart TallyPrime if prompted.
6. On **Gateway of Tally**, open **Helixcer Chat** → **API Settings**.
7. Enter **Workspace ID**, **Channel ID**, then **API Key**.
8. Leave the **API Key** field (Tab / Enter) — Tally calls Helixcer and fills **Workspace Name** and **Channel Name** below. Those names are kept permanently with your other settings.
9. Optional: press **Alt+V** (Verify) to fetch again.
10. **Accept** (Ctrl+A) to close the form.
11. Close Tally and reopen to confirm IDs, key, and names still appear.

Tally must be able to reach `https://api.chat.helixcer.com` (outbound HTTPS).

## Where to find the values in Helixcer

- **Workspace ID** — Workspace page in Helixcer
- **Channel ID** — the WhatsApp channel you want to send from
- **API Key** — Developer / API keys (`hxc_live_…`, shown once when created)

## Helixcer API used by this TDL

`GET /api/v1/connection?channelId=…` with headers:

- `Authorization: Bearer <api key>`
- `X-Workspace-Id: <workspace id>`

Returns `workspaceName` and `channelName` for the settings screen.

## Next steps (planned)

- Send WhatsApp template from a voucher / ledger mobile number
