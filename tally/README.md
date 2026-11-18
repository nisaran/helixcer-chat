# Helixcer Chat for TallyPrime — build 342

## Honesty

This agent **cannot run TallyPrime**. Earlier builds guessed around `On Form Accept` / `Query Box` / nested `Form Accept` and that broke saving. Build **342** is only the pattern Tally documents for company UDFs.

## Load

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer_chat.tdl

Title must show **(build 342)**. Company must be open. Disable every older Helixcer TDL.

## Save (Tally default — no custom Yes/No)

1. Helixcer Chat → API Settings.
2. Enter Workspace ID, Channel ID, API Key (key is **visible** on purpose so you can verify).
3. **Ctrl+A** (Accept) — use Tally’s normal accept, not a custom dialog.
4. Reopen API Settings — all three values must still be there.

If reopen is blank, Storage is not attaching to the company on your Tally build; that needs a Tally TDL developer with a local Tally to debug.

## Status

After a successful Accept, Status copies company UDFs and calls `GET /api/v1/connection`.
