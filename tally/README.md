# Helixcer Chat for TallyPrime — build 412

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 412)**.

## Your Native Storage approach + flush fix
Invisible Storage fields often do not write on Form Accept, so configs never appeared.

- Session Create UI kept
- Commit validates only (no procedural INSERT — avoids c0000005)
- `Hxc Vc Native Storage Part` repeats Aggregate with **Break After** empty name
- Storage fields are small but **visible** (not Invisible); Name first
- Ctrl+A → default Form Accept persists Company Aggregate
