# Helixcer Chat for TallyPrime — build 348

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer_chat.tdl

Company open. Titles **(build 348)**. API Settings saved first.

## Create Config

1. Config Name → Template Name → Language → **Enter** (fetch template)  
2. Preview + variable mapping appear only after fetch  
3. Media / voucher types / Auto / Confirm → **Ctrl+A**

## Fix in 348

TDL error `T0014`: `Inactive` is not valid on **Line**. Moved to **Field** (and `Local : Field : Default : Inactive` on map rows).
