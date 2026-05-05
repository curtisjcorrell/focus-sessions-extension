# Focus Sessions

A minimal local Chrome extension for lightweight focus accountability.

## What It Does

- Prompts on HTTP/HTTPS sites for what you plan to use the site for.
- Starts timing only after you submit a purpose or click **Skip**.
- Logs tab sessions locally by domain, purpose, date, and duration.
- Tracks zero-duration **Early Exit** events when you choose to leave a site instead.
- Opens a dashboard tab from the extension toolbar button.
- Shows today's grouped stats, early exits, and whitelist controls.
- Lets you whitelist domains that should not prompt or appear in analytics.

## Privacy And Storage

Focus Sessions does not use accounts, remote APIs, analytics services, or network requests.

Completed records are stored in the local Chrome profile with `chrome.storage.local` under `focusSessions`. A record includes the domain, stated purpose, status, date, timestamps, and duration. Active in-progress state is stored temporarily with `chrome.storage.session` under `activeFocusSessions` and `pendingFocusPrompts`.

Whitelisted domains are stored locally under `whitelistedDomains`. A whitelisted domain such as `example.com` also matches subdomains such as `docs.example.com`.

The extension does not encrypt local data itself. Anyone with access to your Chrome profile or device may be able to inspect extension storage.

## Permissions

- `storage`: saves local session records, active state, and whitelisted domains.
- `tabs`: detects tab lifecycle, opens the dashboard tab, and closes a tab when you choose **Exit instead**.
- `http://*/*` and `https://*/*`: injects the lightweight prompt on normal websites automatically.

The extension does not use redirect interception, `webRequest`, remote scripts, or remote services.

## Limitations

- Chrome does not allow the prompt on restricted pages such as `chrome://newtab`.
- This is an accountability aid, not a tamper-proof blocker.
- Whitelisted domains are skipped entirely and are not tracked in analytics.

## Build

```powershell
npm install
npm run build
```

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the generated `dist` folder.

## License

MIT
