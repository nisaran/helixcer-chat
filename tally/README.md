# Helixcer Chat for TallyPrime — build 413

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 413)**.

## Fix in this build
Fetch showed **"Enter Template Name first"** even when Template Name had a value.

Cause: non-Storage fields used `On Accept : SET … : $Value`, which is empty and wiped `##HxcVcDraftTemplate`. Fetch then only read that empty variable. Commit also referenced old field names (`#HxcVcTemplateNameInput`) that do not exist on this form.

- Fetch/Commit sync from live fields `#Hxc Vc F Name` / `#Hxc Vc F Template` / `#Hxc Vc F Lang`
- Accept handlers use `$$Value` for non-Storage draft/mapping fields
- Native Storage Aggregate save from build 412 unchanged

## Test
1. Reload TDL → Create Voucher Config title shows **(build 413)**
2. Config Name + Template Name + Language `en` → Enter (or Alt+F)
3. Must fetch (not "Enter Template Name first")
4. Ctrl+A → config appears in List / Alter
