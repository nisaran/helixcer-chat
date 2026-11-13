# Helixcer Chat desktop (Windows)

The browser “Install app” PWA cannot hide to the Windows system tray when you click **X**. This Electron shell loads the live Helixcer Chat site and keeps the app running in the tray instead.

## Behaviour

- Closing the window (**X**) hides Helixcer Chat to the system tray (near the clock).
- Click the tray icon (or **Open Helixcer Chat**) to bring the window back.
- Choose **Quit** from the tray menu to exit fully.
- Only one instance runs; opening the app again focuses the existing window.

## Run locally

```sh
cd desktop
npm install
npm start
```

Optional start URL (defaults to `https://chat.helixcer.com`):

```sh
# PowerShell
$env:HELIXCER_APP_URL="https://app.chat.helixcer.com"; npm start
```

## Build a Windows installer

On a Windows machine with Node.js:

```sh
cd desktop
npm install
npm run dist
```

Outputs land in `desktop/dist/`:

- `HelixcerChat-*-x64.exe` — NSIS installer
- `HelixcerChat-*-x64.exe` portable build from electron-builder portable target

Install that build instead of the Edge/Chrome PWA if you want close-to-tray.

## Notes

- Auth, inbox, and push still come from the hosted web app and API.
- Uninstall the old PWA from Windows Settings → Apps if both shortcuts are confusing.
