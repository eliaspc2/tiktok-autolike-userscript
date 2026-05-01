# TikTok AutoLike Userscript

This repository contains a Greasemonkey/Tampermonkey userscript derived from a
bookmarklet. It adds a floating control panel to TikTok Web so you can run a
simple auto-like loop with pause, stop, and drag support.

## Files

- `tiktok-autolike.user.js` - the userscript itself
- `LICENSE` - MIT license

## Features

- Floating draggable panel
- Clicks or minutes mode
- Speed presets and a custom slider
- Start, pause, stop, and close controls
- Session persistence for panel position and settings

## Install

1. Install Greasemonkey, Tampermonkey, or a similar userscript manager.
2. Open `tiktok-autolike.user.js` in your browser and install it.
3. Visit `https://www.tiktok.com/` and open the panel.

## Notes

- The panel now closes into a floating `TT` launcher with a status dot.
- The open/closed state is remembered, so reopening the page brings back the same mode.
- The panel uses a top-right cross to hide into the launcher.
- The cross responds while the script is running or paused.
- The script makes a best-effort attempt to unmute the current TikTok video on load, with a couple of short retries if the player is still mounting.
- The panel starts near the top-right on first load and remembers the last dragged position.
- The default values are 50,000 clicks in `Clicks` mode and 60 minutes in `Minutes` mode.
- The script looks for the visible like control on the page and clicks it when
  it appears to be in the unliked state.
- Use only where automation is allowed.

## License

MIT
