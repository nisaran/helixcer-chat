# Helixcer Chat for TallyPrime

TDL add-on that connects TallyPrime to Helixcer Chat (WhatsApp templates and more).

## What is included so far

- **Helixcer Chat** menu item on **Gateway of Tally** (hotkey `H`)
- Submenu with **API Settings** and **About**
- **API Settings** (saved across Tally restarts):
  - Workspace ID / Channel ID / API Key (`******` when saved)
  - After verify: blue Status, Workspace, Channel Name (`Name (Platform)`)

## Load the TDL in TallyPrime

1. Open TallyPrime with a company loaded.
2. Press **F1** (Help) → **TDLs & AddOns** (or Gateway **F4** / Manage Local TDLs).
3. Add `tally/helixcer-chat.tdl` → enable → restart if prompted.
4. Gateway → **Helixcer Chat** → **API Settings**.
5. Enter Workspace ID, Channel ID, API Key.
6. Press **Enter** on the API Key field — Tally shows its Progress loader and fetches from Helixcer.
7. Blue Status / Workspace / Channel Name appear; then press **Enter** or **Ctrl+A** on **Save** to store.
8. Reopen: IDs and details stay; API Key shows `******`. Enter on the key again re-fetches.

Tally must reach `https://api.chat.helixcer.com` (outbound HTTPS).

## Helixcer API

`GET /api/v1/connection?channelId=…` with:

- `Authorization: Bearer <api key>`
- `X-Workspace-Id: <workspace id>`

Returns `workspaceName`, `channelName`, `connectorType`, `platformLabel`.
