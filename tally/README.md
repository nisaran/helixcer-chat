# Helixcer Chat for TallyPrime — build 384

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 384)**.

Your corrected build 382, with one focus fix:

After a successful template fetch, cursor moves to the first mapping field (Header / Body / Button / Voucher Type) instead of jumping back to **Config Name** (which re-ran fetch).

Language Enter still fetches; it no longer runs `Field Accept` after the HTTP call.
