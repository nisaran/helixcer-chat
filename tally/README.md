# Helixcer Chat for TallyPrime — build 390

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 390)**.

## Fix
Fetch said "Enter Template Name first" while Template Name showed a value — session Variables were not updated from the field buffer before fetch. Name/Template/Language now `SET` the draft vars on Accept, and Fetch falls back to `$$Value:Hxc Vc F Template`.
