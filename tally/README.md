# Helixcer Chat for TallyPrime — build 407

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 407)**.

## Alter Config
Removed the old Alter form. New Alter loads the Company `HxcVoucherConfigs` row saved by Create:

1. Select Config (table of saved names) → Enter
2. Loads name/template/lang/maps/customs/voucher types/settings from company DB
3. Fetches that template and restores field mappings from `HxcVcVarMapsText`
4. Edit + Ctrl+A updates the same Aggregate row
