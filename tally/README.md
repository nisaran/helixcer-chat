# Helixcer Chat for TallyPrime — build 403

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 403)**.

## Fix
When a Header / Body / Button variable is mapped to **Custom Value**, the text input is mandatory.

- Custom inputs use `Modifies` so typed text syncs into the draft Variable
- Empty Accept on a Custom Value input shows: "Custom Value text is required." and stays on the field
- Ctrl+A still blocks save via `@@HxcVcMissingCustomValue` if any Custom Value text is blank
