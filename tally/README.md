# Helixcer Chat for TallyPrime — build 380

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 380)**.

## What was going wrong
- **Fixed Body1–16 fields:** Body showed, but unused slots left a **gap** (Field Inactive still takes space; Line Inactive = T0014).
- **Repeat + Sync with `AND` in IF:** Sync failed in Tally, so **only Header** showed.

## Fix
Sync uses **nested IF** (same style as build 368), no `AND`. Body/Button Repeat rows only include real variables → Body shows, Button sits immediately under Body, no empty-slot gap.
