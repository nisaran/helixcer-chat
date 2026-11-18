# Helixcer Chat for TallyPrime — build 350

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer-chat.tdl

Title must show **(build 350)**.

## Create
1. Config Name → Template Name → Language → **Enter** (fetch)
2. Preview + **Map Var** rows appear only after fetch (and only for returned vars)
3. Media / voucher types / settings → Ctrl+A

## Fix
Build 349 still showed empty `Map Var` labels because `Medium Prompt` was never `Inactive`. Build 350 uses prompt Fields with the same Inactive condition as the map values.
