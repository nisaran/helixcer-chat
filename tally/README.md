# Helixcer Chat — build 341

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer_chat.tdl

## Why replacement failed

You entered new UUIDs + key and got **Do you want to save?**, but reopen showed the old `Sddcsdfsdfc` / single `*`.

Cause: Confirm Save returned Yes **without** running `Form Accept`, so company **Storage was never committed**.

## Fix

After Yes → **`Form Accept`** (commits Alter) → **Helixcer saved** Msg Box.

## Steps

1. Title **(build 341)**.
2. Enter new Workspace / Channel / full API Key (many `*`).
3. Enter → Yes.
4. Must see **Helixcer saved** with the **new** WS/CH and KeyChars ≥ 20.
5. Reopen — new values must still be there (not the old dummy IDs).
