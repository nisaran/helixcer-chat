# Helixcer Chat for TallyPrime

## Load (build 332)

Use a **new file name** so Tally does not keep an old copy:

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer-chat-build332.tdl

1. Quit Tally.
2. Disable/remove older Helixcer TDL files.
3. Add `helixcer-chat-build332.tdl`, enable, restart.
4. API Settings title must show **(build 332)**.

## API Settings

Opens with **Alter** on the current **Company**. Workspace ID and Channel ID use **Storage** UDFs (saved in the company data). API Key is stored in a UDF via `SET VALUE` so the `******` mask cannot overwrite it.

1. Enter values, Tab through fields.
2. Enter → **Do you want to save?** → Yes.
3. Reopen: IDs and masked key should still be there.

## Status

Open **Status**, press **Alt+R** to call `GET /api/v1/connection` with the saved credentials.
