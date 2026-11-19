# Helixcer Chat for TallyPrime — build 405

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 405)**.

## Fix
Based on your working build 402 file. Only change: Commit now does `SET TARGET : Company : ##SVCurrentCompany` before writing `HxcVoucherConfigs`, so List Configs / Alter Config can see saved rows.
