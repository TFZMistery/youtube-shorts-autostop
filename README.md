## YouTube Shorts AutoPause (Tampermonkey)

Auto‑pause YouTube Shorts after a configurable number of seconds or loops. Works across SPA navigation (YouTube homepage → Shorts), resets when you scroll to a new Short, and logs activity in the DevTools console.

## Features
- Auto‑pause by seconds or loop count
- Handles SPA navigation and homepage → Shorts transitions
- Detects new Shorts even when YouTube reuses the same `<video>` element
- Resets counters on each new Short
- Verbose console logs with `[YSAP]` prefix for easy debugging

## Requirements
- Tampermonkey (or compatible userscript manager) for Chrome
- YouTube website or m.youtube.com
- Permissions: none beyond page access

## Installation
1. Install Tampermonkey from the [Tampermonkey website](https://www.tampermonkey.net/).
2. Create a new userscript:
   - Click the Tampermonkey icon → Create a new script...
3. Paste the script from this repository’s `userscript.js` file into the editor.
4. Save and ensure the script is enabled.
5. Reload YouTube.

## Configuration
Edit the top of the userscript to adjust behavior:

```javascript
const MODE = 'loops';     // 'seconds' or 'loops'
const SECONDS_LIMIT = 25; // When MODE === 'seconds'
const LOOPS_LIMIT = 2;    // When MODE === 'loops'
const DEBUG = true;       // Set to false to silence console logs
```

- Set `MODE` to `'seconds'` to pause after X seconds of actual playback.
- Set `MODE` to `'loops'` to pause after X full loops of the Short.
- Toggle `DEBUG` to control console verbosity.

## How It Works
- Hooks into YouTube’s SPA events (`yt-navigate-*`, `yt-page-data-updated`) and DOM changes to detect the active Short.
- Resets state when:
  - The Shorts URL changes
  - New media metadata loads (`loadedmetadata`)
  - A different Shorts renderer becomes active
- Detects loops via:
  - `ended` event (when available)
  - Time wrap-around (seamless loops)
  - Seeks to zero at loop boundaries

## Usage
- Open a Short and let it play. The script will pause when the configured limit is reached.
- Scroll to a new Short: counters reset automatically.
- Open DevTools (F12 → Console) to see `[YSAP]` logs of detection, loop counts, and pauses.

## Troubleshooting
- Not pausing:
  - Verify `MODE` and limit values.
  - Ensure the script is enabled in Tampermonkey and matches `https://www.youtube.com/*` and `https://m.youtube.com/*`.
  - Check the console for `[YSAP]` logs. If you see repeated “wrap” logs after scrolling, ensure you’re on the latest script version in this repo.
- Excessive logs:
  - Set `DEBUG = false`.
- Works for first Short but not the next:
  - Confirm the script includes resets on `loadedmetadata` and URL changes (latest version).
- Still stuck?
  - Copy the last 20–30 `[YSAP]` console lines and open an issue with details (Chrome version, YouTube URL pattern, your config).

## Known Limitations
- YouTube’s DOM and SPA internals change. If detection breaks after a site update, update the script from this repo.
- Extremely short or malformed Shorts may have unusual timeupdate behavior; thresholds are tuned but may need tweaks.

## Development
- Clone the repo and edit `userscript.js`.
- Test by pasting into a new Tampermonkey script.
- Keep indentation and style consistent with the existing file.

## Changelog
- 1.1.1
  - Reset state on URL change and `loadedmetadata` even when the same `<video>` element is reused
  - Suppress false wrap detection right after resets
  - Reduce log spam after pause
- 1.1.0
  - Added detailed `[YSAP]` logs and more robust loop detection
- 1.0.0
  - Initial release: seconds/loops modes, basic SPA handling

## License
MIT License. See `LICENSE` for details.