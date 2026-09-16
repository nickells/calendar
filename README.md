# Calendar

A touch-friendly, installable calendar for iPad and desktop. No build step or server-side dependencies.

- **Events:** tap a day to add an event, or drag across days to select a date range; the modal opens on release; name, start date, end date, and color, with editing and one-tap deletion. The end date is inclusive; existing events remain single-day. Single-day events display their names. Multi-day events show their name on the first visible day and a continuous line across the remaining days, with one arrowhead at the end of each calendar row it spans. Editing or deleting an event from any day updates the whole event.
- **Month:** full calendar month in the original six-row grid, with previous/next month navigation.
- **30 day:** 30 days starting at the selected date, padded with muted, selectable dates to fill complete weeks; navigation moves 30 days.
- The selected view is saved in IndexedDB and restored on reopening, including offline.
- Events sort by times in their names (for example, `4pm`, `4:30 p.m.`, or `16:30`). Times without AM/PM use the 24-hour clock. Untimed names come first; shorter names are preferred near the top when space allows. Matching times sort alphabetically. Names remain unchanged.
- Saving or editing an event leaves the selected view and date range unchanged.
- Events persist in IndexedDB on the current browser/device. There is no account or sync; clearing website data deletes events.
- The service worker caches the application for offline use after the first successful online visit.

## Run

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Deploy these static files to HTTPS for installation and offline support on an iPad. Relative asset URLs support GitHub Pages repository subpaths.

## Install on iPad

Open the HTTPS site in Safari → Share → Add to Home Screen. Launch the Home Screen icon for standalone display. Both portrait and landscape layouts are supported. For a locked kiosk, enable Settings → Accessibility → Guided Access and triple-click the top/Home button to begin a session. Configure the iPad's display sleep settings for your installation; the app does not force the screen awake.

Actual iPad installation and Guided Access must be verified on a physical device.

## Test

```sh
TZ=America/New_York node --test tests/*.test.mjs
```

Browser integration checks (requires Playwright and Google Chrome, with the local server running):

```sh
node tests/browser.cjs
```

Set `PLAYWRIGHT_MODULE` to the installed Playwright module path if it is outside this project. The checks cover IndexedDB persistence, event editing/deletion, validation, responsive layouts, and offline reloads and edits.

Online reloads fetch current application files; offline reloads use the cached shell. When shipping changed application files, increment the cache version in `sw.js`. New workers activate immediately. Local previews refresh once when replacing an older cached build; installed apps use the update on their next reload.

Typography uses Archivo Narrow, bundled locally with its SIL Open Font License in `fonts/OFL.txt`. Both font weights are cached for offline use.

Layout is calculated per calendar row by the pure packing algorithm in `layout.mjs`. Wrapped labels reserve their full height only on the starting day; their arrows align with the first line and reserve a single line on continuation days. The browser measures wrapped labels and available space beside date numerals, then the packer places single-day labels and shared multi-day spans together. Explicit time order and non-overlap are required; it prefers preserving continuing arrows’ relative order across week rows, then minimizes row height and prefers shorter untimed names and fewer gaps. A bounded beam search keeps up to eight alternatives, considering up to four next events per step, with a greedy baseline as a fallback. It is deterministic but does not promise a globally optimal layout. Events, font loading, and resizing trigger fresh measurements.

Single-day labels use the space beside a date only when other events would overflow that day and moving a fitting label into the corner reduces overflow. Sparse days retain normal spacing below the date.

New events sample random RGB colors with relative luminance at or below 0.23, allowing saturated red and blue while excluding bright green, yellow, and white. Manually selected and saved colors are unchanged.
