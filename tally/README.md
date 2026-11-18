# Helixcer Chat for TallyPrime

## Load (build 339)

https://raw.githubusercontent.com/nisaran/helixcer-chat/cursor/tally-live-field-vars-b545/tally/helixcer_chat.tdl

Title **(build 339)**. Company must be open.

## API Key fix

Workspace/Channel already used `Storage` and stayed. API Key used mask/`SET VALUE` and came back blank.

Now the API Key field is named with **Password** (shows `*`) and uses the same **Storage** UDF as the IDs.

1. Re-enter the API Key once (shows as `*`).
2. Tab → Enter → Yes → **Helixcer saved** with KeyChars &gt; 0.
3. Reopen — API Key should show as asterisks, not empty.
