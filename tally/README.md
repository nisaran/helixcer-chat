# Helixcer Chat for TallyPrime — build 382

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 382)**.

## Fixes
1. **Null / missing Body select:** Body and Button both used `Storage : HxcVcDMFld*` for the same slot. Tally only binds one Storage field per UDF — Body `{1}` broke. Now **only Body** owns Storage; Button writes via `Hxc Write Slot Fld` on Accept.
2. **Gap under Body:** Fewer unused rows — UI shows Body1–8 and Btn1–4 (enough for typical templates). Button section hidden when no button vars. Fetch still build 368.
