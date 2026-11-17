# Helixcer Chat for TallyPrime

TDL add-on that connects TallyPrime to Helixcer Chat (WhatsApp templates and more).

## What is included so far

- **Helixcer Chat** menu item on **Gateway of Tally** (hotkey `H`)
- Submenu with **API Settings** and **About**
- **API Settings** fields (saved across Tally restarts):
  - Workspace ID
  - Channel ID
  - API Key (shown as `******` after save)
  - Status / Workspace / Channel Name (blue, only after verify; channel includes platform)

## Load the TDL in TallyPrime

1. Open TallyPrime with a company loaded.
2. Press **F1** (Help) → **TDLs & AddOns**  
   (or from Gateway: **F4** / Manage Local TDLs, depending on your release).
3. Add file: `tally/helixcer-chat.tdl` from this repository.
4. Set **Load TDLs on startup** / enable the file → **Yes**.
5. Restart TallyPrime if prompted.
6. On **Gateway of Tally**, open **Helixcer Chat** → **API Settings**.
7. Enter **Workspace ID**, **Channel ID**, then **API Key** (paste once; typing is masked).
8. Tab off **API Key** or press **Alt+V** — Status shows **Loading...**, then blue details appear:
   - **Status**
   - **Workspace**
   - **Channel Name** (with platform in brackets, e.g. `Helixcer (WhatsApp)`)
9. Press **Enter** / **Ctrl+A** to save.
10. Reopen API Settings — IDs, blue details, and Status stay filled; API Key shows `******`.
11. To change the key, replace `******` with a new key and Tab / Alt+V again.

Tally must be able to reach `https://api.chat.helixcer.com` (outbound HTTPS).

## Where to find the values in Helixcer

- **Workspace ID** — Workspace page in Helixcer
- **Channel ID** — the WhatsApp channel you want to send from
- **API Key** — Developer / API keys (`hxc_live_…`, shown once when created)

## Helixcer API used by this TDL

`GET /api/v1/connection?channelId=…` with headers:

- `Authorization: Bearer <api key>`
- `X-Workspace-Id: <workspace id>`

Returns `workspaceName`, `channelName`, and `connectorType` for the settings screen.

## Next steps (planned)

- Send WhatsApp template from a voucher / ledger mobile number
