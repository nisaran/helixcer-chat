# Helixcer Chat for TallyPrime — build 383

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 383)**.

## Gap fix
Unused Body3–8 Field-Inactive rows caused the empty band under `{2}`. Body/Button are **Repeat** rows (only real variables). Sync uses nested IF (no `AND`). Section flags set only after Sync INSERT. Body/Btn row Storage is per-aggregate (`BodyMapFld` / `BtnMapFld`), copied to `HxcVcDMFld*` on Accept.
