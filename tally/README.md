# Helixcer Chat for TallyPrime — build 393

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 393)**.

## Fix
Template Name was bound to a session `Variable`, so Fetch never saw the typed value ("Enter Template Name first").

Config Name / Template Name / Language are Company `Storage` UDFs again. Fetch reads `$HxcVcDraftTemplate`.
