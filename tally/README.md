# Helixcer Chat for TallyPrime — build 386

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 386)**.

## Why Config Name kept stealing focus
After Language Enter → HTTP fetch, Body/Header rows are still Invisible/Inactive, so Field Accept has nowhere to go and wraps to **Config Name**.

## Fix
Always-active **Continue** field after Language. Successful fetch lands there (not Config Name). Enter on Continue → mapping. Name/Template/Language stay Inactive once fetched.
