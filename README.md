# RECLAIM

*Life finds a way. You make one.*

You are a vine in a sidewalk crack. Humanity is gone; its intersection is not. Reach water, split the pavement, and
make room: moss, grass, flowers, trees and the things that live in them arrive on their own.

This is the first playable prototype from the design document: one abandoned intersection, one vine.

## Play

Open `index.html` from any static server (`python3 -m http.server`), on a phone or a desktop browser.

- **Drag** a glowing tip to grow. Sunlight pays for it; shade pays nothing.
- **Hold** a slab beside your vine to crack it. Water pays for it, so reach the leaking hydrant first.
- **Tap** anything to see what it is. Pinch or scroll to zoom, drag empty ground to pan.
- Two adaptations are offered as the place comes alive (Root Pressure or Water Seeking, then Climbing Tendrils or
  Constriction). Each pair plays differently.
- The intersection is reclaimed when enough ground is living, enough species have arrived, all four corners are
  linked and the soil has built up. Breaking things scores nothing by itself.

## Layout

| Path | What |
|---|---|
| `src/config.js` | every tunable number, colour and line of text |
| `src/sim.js` | the grid, the vine, water, soil and succession (no drawing, no DOM) |
| `src/render.js` | canvas renderer |
| `src/audio.js` | Web Audio: the soundscape follows the ecosystem |
| `src/main.js` | input, camera, interface, save |
| `data/intersection.json` | the level |
| `assets/` | sounds, effects, identity and icons integrated by the production pipeline |
| `audio/`, `fonts/` | extra audio layers (with mp3 fallbacks) and the Barlow typeface (OFL 1.1) |

No build step and no dependencies. Progress, best time and the sound setting are kept in `localStorage`.

RECLAIM by HaveAnApp.
