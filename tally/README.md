# Helixcer Chat for TallyPrime

TDL add-on that connects TallyPrime to Helixcer Chat (WhatsApp templates and more).

## What is included so far

- **Helixcer Chat** menu item on **Gateway of Tally** (hotkey `H`)
- Submenu with **API Settings** and **About**
- **API Settings** fields (saved across Tally restarts):
  - Workspace ID
  - Channel ID
  - API Key

## Load the TDL in TallyPrime

1. Open TallyPrime with a company loaded.
2. Press **F1** (Help) → **TDLs & AddOns**  
   (or from Gateway: **F4** / Manage Local TDLs, depending on your release).
3. Add file: `tally/helixcer-chat.tdl` from this repository.
4. Set **Load TDLs on startup** / enable the file → **Yes**.
5. Restart TallyPrime if prompted.
6. On **Gateway of Tally**, open **Helixcer Chat** → **API Settings**.
7. Enter your Helixcer values and accept/save.

## Where to find the values in Helixcer

- **Workspace ID** — Workspace page in Helixcer
- **Channel ID** — the WhatsApp channel you want to send from
- **API Key** — Developer / API keys (`hxc_live_…`, shown once when created)

## Next steps (planned)

- Send WhatsApp template from a voucher / ledger mobile number
