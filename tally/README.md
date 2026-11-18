# Helixcer Chat for TallyPrime — build 361

## Web Create Config UI

Modern Create Voucher Config screen (product mockup):

- From repo root: `python3 -m http.server 8765 --bind 127.0.0.1`
- Open `http://127.0.0.1:8765/tally/ui/`

Flow: Config / Template / Language → **Fetch Template** → dynamic maps + preview → voucher types → Save Config.

Without API credentials, sample templates drive the UI. Optional API connection uses Helixcer template fetch. Saved configs download as JSON and copy a Tally maps pack string. Day-to-day sending still runs in Tally via the TDL.

## TallyPrime TDL

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer-chat.tdl

Title must show **(build 361)**.

### Create (in Tally)

Name → Template → Language **Enter** (or **Alt+F**) → header/maps → vouchers → Ctrl+A.

`Inactive` belongs on Fields only (T0014).
