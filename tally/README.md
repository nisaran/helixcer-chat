# Helixcer Chat for TallyPrime

## Why older builds lost data

`Modify Variable` edits the **parent** menu scope. Values never stayed in durable storage, so reopen showed blank fields.

## Load (build 337)

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer_chat.tdl

1. Quit Tally; replace `helixcer_chat.tdl`; disable other Helixcer TDLs.
2. Title must show **(build 337)**.
3. First open may be empty — that is expected before the first save.

## Save (must see confirmation)

1. Tab Workspace ID → Channel ID → API Key.
2. Enter → Yes.
3. **Helixcer saved** must appear with `WS=[...] CH=[...] KeyChars=N`.
4. Reopen API Settings — values reload from `HelixcerChat.pvf`.
5. Status uses the system mirrors filled on that save.

## Technical

- Report-scoped Persistent vars + `Save Variable` / `Load Variable`
- Open with `Display` (report owns the variables)
- `HxcSys*` system copies for Status HTTP
