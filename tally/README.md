# Helixcer Chat for TallyPrime

## Invoice / Language tip
WhatsApp often stores English templates as **`en_US`**, not `en`.

If Fetch fails for one template (e.g. `invoice`) with Language `en` while others work:

1. Set Language to **`en_US`** and Fetch again, **or**
2. After the API deploy that matches base `en` → `en_US`, plain `en` works too.

Reload TDL (VT SubForm / WhatsApp Settings flow from your latest local build):
https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

## Config on Voucher Type
Alter Voucher Type → Enable Helixcer Chat → Alter Helixcer Chat WhatsApp → Yes → template + mapping → Ctrl+A.
