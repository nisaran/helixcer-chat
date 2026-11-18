# Helixcer Chat for TallyPrime

## Load (build 335)

Use this exact file (same name as many local copies):

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer_chat.tdl

1. Quit Tally.
2. Replace your local `helixcer_chat.tdl` with this file (or point TDL list at it).
3. Disable other Helixcer TDL files.
4. API Settings title must show **(build 335)**.

## Save check

1. Tab Workspace ID → Channel ID → API Key.
2. Enter → Yes.
3. You must see **Helixcer saved** with `WS=[...] CH=[...] KeyChars=N`.
4. If KeyChars=0 or WS/CH brackets empty, values did not write — Tab each field again.

## Status

Uses the saved `##` values (and `HelixcerChat.pvf` if needed). If still empty, the Msg Box shows `Not saved. WS=[...]` so you can see which part is missing.
