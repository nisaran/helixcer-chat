# Helixcer Chat for TallyPrime — build 347

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-minimal-storage-b545/tally/helixcer_chat.tdl

Company open. Titles **(build 347)**. API Settings must be saved first.

## Create Config

1. Config Name  
2. Template Name  
3. Language → **Enter** (fetches `GET /api/v1/whatsapp/templates/{name}?channelId=&language=`)  
4. **Template Preview** appears (body text)  
5. **Variable Mapping** rows appear only for vars returned by the API  
6. Media Header, Voucher Types (multi), Auto / Confirm  
7. **Ctrl+A**

Mapping and preview stay hidden until fetch succeeds.

## Honesty

Cannot run TallyPrime here. If preview/vars stay blank after a successful-looking fetch, the JSON walk (`items` / `components` / `variables`) may need a local TDL adjust. True left/right layout is limited in TDL — preview is a section above mapping.
