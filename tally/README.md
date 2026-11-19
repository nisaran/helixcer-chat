# Helixcer Chat for TallyPrime — build 408

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 408)**.

## Fix — saved configs not showing in List/Alter
Procedural `INSERT COLLECTION OBJECT` only creates in-memory Aggregate rows. Persist with the proven shell pattern:

1. `NEW OBJECT : Company : ##SVCurrentCompany`
2. `INSERT COLLECTION OBJECT : HxcVoucherConfigs` (+ SET VALUE)
3. `SET TARGET : ..`
4. `ALTER TARGET`

List/Alter read `Hxc Voucher Config Names` (`Belongs To : Yes`).
