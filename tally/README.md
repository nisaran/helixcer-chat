# Helixcer Chat for TallyPrime — build 379

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 379)**.

## Why the gap under Body?
Inactive Field rows for unused Body3..16 / Button slots still take vertical space in Tally (Line `Inactive` is illegal — T0014).

## Fix
Body and Button use **Repeat** collections with only real variables, so Button sits immediately under Body (or Voucher Rules if no buttons).

Fetch stays build-368 style; Sync map rows runs before the success Msg Box; Sync helpers keep step numbers under 100.
