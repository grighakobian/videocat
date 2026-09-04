# Grabbit — App Overview

## Project
 - Use ElectronJS
 - Supports Windows/MacOS

## Download Sources
 - Youtube(MVP)
 - Other sources later

A desktop (Windows/Mac) video downloader app design. Two theme explorations, four screens, tweakable accent color.

## Files
- `Grabbit Downloader.dc.html` — **V1: Bold & playful** — chunky neobrutalist style: warm cream palette, 2px ink borders, hard offset shadows, Bricolage Grotesque + Outfit type, animated striped progress bars.
- `Grabbit Downloader v2.dc.html` — **V2: Clean** — hairline borders, soft shadows, quiet neutrals, Outfit only, pill progress bars, segmented controls, SVG line icons.

## Screens (both versions)
1. **Downloads** — global URL paste bar with primary download button and ⌘V hint; clipboard-detect banner; active queue cards (thumbnail, quality/format chips, progress %, speed, ETA, pause/cancel); a queued item with an expanded quality picker (4K / 1080p / 720p / MP3-only + file sizes, subtitles checkbox); "Completed today" quick list.
2. **Completed** — history grouped by day (Today / Yesterday) with Play and Show in Finder actions, weekly totals, Clear history.
3. **Library** — 3-column grid of downloaded media with duration badges, format chips, sizes, and All / Video / Audio filters.
4. **Settings** — Downloads (save folder, default quality segmented control, simultaneous-downloads stepper) and Behavior (watch clipboard, subtitles, speed limit, notifications toggles), version + update links.

## Interactions
- Sidebar navigation switches pages; titlebar reflects the active page.
- Disk-space indicator in the sidebar footer.

## Tweaks (both files)
- `accent` — theme accent color (default `#E8501F`; violet, green, blue presets).
- `showClipboard` — toggle the clipboard-detect banner.

## Design tokens (V2)
- Background `#FCFCFB` / panels `#F7F6F3`, borders `#E7E4DE`, text `#22201C`, muted `#8B857A`, accent `#E8501F`.
- Radius 8–16px, 44px inputs, 1px hairlines, soft 24px drop shadow on the window.

## Design tokens (V1)
- Background `#FBF8F2` / panels `#F4EEE3`, ink `#211C15`, accent `#E8501F`, chips `#D9EBFF` / `#EFE6FF` / `#FFE9A8`.
- 2px borders, 3–4px hard offset shadows, radius 10–18px.

## Placeholders
Video thumbnails are striped placeholders — drop in real artwork when available.
