# Helixcer Chat for TallyPrime

## Load (build 338)

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer_chat.tdl

Title must show **(build 338)**. Company must be open.

## What crashed / what works

| Action | Result |
|--------|--------|
| `Display` API Settings | `c0000005` crash |
| `Modify Variable` | Opens, does **not** persist |
| `Alter` + Company `Storage` | Opens + keeps values on company |
| Status `Call` + Msg Box | OK (no Display) |

## Save

1. API Settings (Alter) → Tab all three fields → Enter → Yes.
2. Must see **Helixcer saved** with `WS=[...] CH=[...] KeyChars=N`.
3. Reopen — IDs and `******` should still be there.
4. Status uses mirrors filled on that save.
