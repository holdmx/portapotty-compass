# The Golden Compass 🚽🧭

A mobile, installable, offline compass that points to the nearest porta-potty
("John") bank in Black Rock City.

## What it does

- Uses your phone's GPS + magnetometer to draw a live compass needle pointing
  at the nearest toilet bank (or "The Man", or any bank you pick from the list).
- Shows distance in feet or meters (tap the unit badge, top right).
- Works **fully offline** once loaded — all 45 bank locations are baked into
  `data.js`, no network calls at runtime. Install it to your home screen
  before you leave signal.

## Data source

Bank coordinates are centroids computed from the **official 2025 Burning Man
Project GIS release**:
https://github.com/burningmantech/innovate-GIS-data (`2025/GeoJSON/toilets.geojson`)

The Man / Golden Spike coordinate is from the same org's
[2025 Golden Spike dataset](https://innovate.burningman.org/dataset/2025-golden-spike-and-general-city-map-data/).

Burning Man re-surveys and republishes this data shortly before each event
(historically ~July). Bank placement tends to be similar year over year but
**is not guaranteed** — treat this as "close enough to walk toward," confirm
against on-playa signage, and swap in the new year's file once it drops:

1. Get `toilets.geojson` for the current year from
   [innovate.burningman.org/datasets-page](https://innovate.burningman.org/datasets-page/)
   or the GitHub repo above.
2. Compute polygon centroids (see the one-off script you'd write, or ask
   again next year — a `[lat, lng]` centroid per bank is all `data.js` needs).
3. Replace the `TOILETS` array and bump `TOILET_YEAR` in `data.js`.
4. Bump `CACHE_NAME` in `sw.js`, **and** the matching `?v=` query on
   `style.css`/`app.js`/`data.js` in both `index.html` and `sw.js`'s
   `ASSETS` list, so installed devices (and browser HTTP caches generally)
   pick up the update instead of serving a stale cached copy.

## Running it

No build step. Any static file server works, e.g.:

```bash
cd burn-compass
python3 -m http.server 8080
```

Then open `http://localhost:8080` on your phone (same Wi-Fi), or deploy the
folder as-is to GitHub Pages / Netlify / Vercel / any static host and open it
over HTTPS (required for geolocation + the service worker on a real device).

On iPhone: tap the Share icon → **Add to Home Screen** to install it as a
standalone app icon. On first launch it'll ask permission for location and
(iOS 13+) motion/compass access — grant both, then it works with the phone
in airplane mode.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell / markup |
| `style.css` | Dusty desert theme |
| `app.js` | Geolocation, compass heading, bearing/distance math, UI |
| `data.js` | Embedded toilet bank + Golden Spike coordinates |
| `manifest.json` | PWA install metadata |
| `sw.js` | Offline cache (cache-first service worker) |
| `icons/` | App icons (generated, no external assets) |
