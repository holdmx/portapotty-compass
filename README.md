# The Golden Compass 🚽🧭

A mobile, installable, offline wayfinder that shows you which way to walk to
the nearest porta-potty ("John") in Black Rock City. The name is the joke —
there is no compass dial; it points with a marching trail of dots.

## What it does

- Uses your phone's GPS + magnetometer to stream a trail of glowing dots in
  the direction you need to walk to reach the nearest toilet bank (or "The
  Man", or any bank you pick from the list). The trail marches faster the
  closer you get, and hands over to a "you're here" pulse in the last few
  metres, where GPS noise makes the bearing meaningless anyway.
- Shows distance in feet or meters (ft / m switch, top right). Defaults to
  meters unless the browser's locale says otherwise; an explicit choice sticks.
- Works **fully offline** once loaded — all 45 bank locations are baked into
  `data.js`, no network calls at runtime. Install it to your home screen
  before you leave signal.

## Data source

Bank coordinates are centroids computed from the **official 2026 Burning Man
Project GIS release**:
https://github.com/burningmantech/innovate-GIS-data (`2026/GeoJSON/toilets.geojson`)

The Man / Golden Spike coordinate comes from the same release
(`2026/GeoJSON/cpns.geojson`).

**Coordinates do not carry over between years.** Black Rock City is re-sited
on the playa each year: for 2026 the Golden Spike moved ~1,900 ft south-west
of where it stood in 2025, which shifted every bank by roughly that much even
though the street grid and most of the banks' addresses were unchanged. A
2025 dataset would have sent people a third of a mile wrong. Always
regenerate from the current year's release rather than assuming things
"didn't move much":

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
