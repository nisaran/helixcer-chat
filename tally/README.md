# Helixcer Chat for TallyPrime

## Load (build 334)

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer-chat-build334.tdl

1. Quit Tally; disable older Helixcer TDLs.
2. Add `helixcer-chat-build334.tdl`, enable, restart with company open.
3. Title must show **(build 334)**.

## API Settings

Tab through Workspace ID → Channel ID → API Key (each Accept writes Storage + `##` mirrors) → Enter → Yes.

## Status

Loads company UDFs, then `GET /api/v1/connection`, then Msg Boxes for Status / Workspace / Channel.
