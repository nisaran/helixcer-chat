# Helixcer Chat for TallyPrime — build 387

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 387)**.

## Fix
Create Config fields use Company `Storage` UDFs. Clearing them on `Form Create` is too late — Tally has already painted the previous values.

Create Config menu now calls `Hxc Open Create Config`, which clears the Company draft (with `SET OBJECT : Company`) **before** opening the form.
