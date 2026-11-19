# Helixcer Chat for TallyPrime — build 414

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-gap-clear-draft-b545/tally/helixcer-chat.tdl

Title must show **(build 414)**.

## New approach: config on Voucher Type

Stop using Create Config / Config Name / voucher-type lists on Company Aggregate.

1. Gateway → Alter → **Voucher Type** → pick a type (e.g. Sales)
2. Set **Alter Helixcer Chat** → **Yes**
3. Helixcer config form opens for that voucher type (no Config Name, no voucher allocation)
4. Template → Language Enter (fetch) → mapping → Auto/Confirm → **Ctrl+A**
5. Config saves onto that **Voucher Type** master (UDFs `HxcVt*`)

Also: Helixcer Chat → **Configured Voucher Types** lists types that already have a template.

## Why this shape
Company Aggregate `INSERT` / procedural save caused `c0000005` or silent non-saves. Voucher Type Storage + Form Accept matches how API Settings already persist on Company.
