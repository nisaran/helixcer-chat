# Helixcer Chat for TallyPrime

TDL add-on that connects TallyPrime to Helixcer Chat.

## Load

1. Add `tally/helixcer-chat.tdl` in TallyPrime (F1 → TDLs & AddOns) and enable it.
2. Gateway → **Helixcer Chat** → **API Settings**.
3. Enter Workspace ID, Channel ID, API Key.
4. Press **Enter** on the API Key — Tally Progress runs and Helixcer is called.
5. Blue Status / Workspace / Channel Name (`Name (Platform)`) appear.
6. Press **Enter** or **Ctrl+A** again to save.
7. Reopen: IDs and details stay; API Key shows `******`. Enter on the key again re-fetches.

API: `GET https://api.chat.helixcer.com/api/v1/connection?channelId=…`  
Headers: `Authorization: Bearer …`, `X-Workspace-Id: …`
