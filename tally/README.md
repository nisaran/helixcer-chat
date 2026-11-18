# Helixcer Chat for TallyPrime — build 340

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer_chat.tdl

## What was wrong

1. **Form Create sync wiped Status mirrors** before Company UDFs were bound → Status always said “save first” even when IDs showed in Settings.
2. **API Key UDF was a single `*`** (invalid). Settings showed one star; Status had no real key.

## What to do

1. Replace TDL; title **(build 340)**.
2. API Settings → put cursor on API Key → **Delete** the single `*` → type the **full** `hxc_live_...` key.
3. Tab Workspace + Channel (confirm still filled) → Enter → Yes.
4. Must see **Helixcer saved** with `KeyChars=` **20 or more**.
5. If you see **API Key missing**, the key was still too short / still `*`.
6. Then open Status.
