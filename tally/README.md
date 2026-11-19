# Helixcer Chat for TallyPrime — build 385

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 385)**.

## Fix
After template HTTP fetch, Tally redraws and parks focus on **Config Name** (Focus Field during the HTTP callback is too early).

Once `##HxcVcFetched` is Yes, **Config Name / Template / Language** are `Inactive`, so redraw skips them and lands on Header/Body mapping. `On Focus` + `Hxc After Fetch Focus` as backup. Change Template to clear fetch and re-edit those fields.
