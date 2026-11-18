# Helixcer Chat for TallyPrime — build 354

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer-chat.tdl

Title must show **(build 354)**.

## Create Config

1. Config Name → Template → Language  
2. **Fetch Template** = `Yes` → Enter (or **Alt+F**)  
3. Status line shows API result (including real error text when possible)  
4. Map vars → voucher types → Ctrl+A  

## Fetch (354)

Uses Collection HTTP JSON first (so 404/auth JSON errors can surface), then JSONEX HTTP Request fallback. Confirm **Helixcer Chat → Status** shows Connected before fetching.
