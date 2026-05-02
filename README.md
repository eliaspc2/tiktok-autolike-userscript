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
- Session persistence for panel position, settings, and runtime state

## Install

1. Install Greasemonkey, Tampermonkey, or a similar userscript manager.
2. Open `tiktok-autolike.user.js` in your browser and install it.
3. Visit `https://www.tiktok.com/` and open the panel.

## Notes

- The panel now closes into a floating `TT` launcher with a status dot, anchored in the bottom-left by default.
- The open/closed state is remembered, so reopening the page brings back the same mode.
- The last execution state is also remembered, including whether it was running or paused, the elapsed time, the count, and the next break thresholds, so a reload can resume the session instead of resetting it.
- The panel uses a top-right cross in the header controls, with `pointerdown` and `Escape` fallback.
- The script shows a boot line in the panel and launcher title so you can see whether it is loading, mounting, trying to unmute, or already unmuted.
- The script starts trying to unmute on load, keeps retrying while the TikTok player mounts, checks accessible same-origin frames, and then tries the real unmute control with a full pointer/mouse click sequence or the `M` shortcut when the player still appears muted.
- The panel starts near the top-right on first load and remembers the last dragged position.
- The default values are 50,000 clicks in `Clicks` mode and 60 minutes in `Minutes` mode.
- The script looks for the visible like control on the page and clicks it when
  it appears to be in the unliked state.
- Use only where automation is allowed.

## License

MIT
