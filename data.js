// The Golden Compass — data
// Toilet ("John") bank locations sourced from the official Burning Man Project
// GIS release: https://github.com/burningmantech/innovate-GIS-data (2026/GeoJSON/toilets.geojson)
// Each bank was published as a footprint polygon; the coordinate below is that
// polygon's centroid. 45 banks, 2026 placement plan.
//
// NOTE: Black Rock City is re-sited each year. For 2026 the Golden Spike moved
// ~1,900 ft south-west of its 2025 position, so every coordinate here differs
// from the 2025 set by roughly that much even though the street grid and the
// banks' addresses are largely unchanged. Never carry coordinates over from a
// previous year — always regenerate from that year's GIS release.
const TOILET_YEAR = 2026;

// Bank names, in the same order as the coordinates below. Most banks sit
// right at a real street intersection, so they're named the way Burning Man
// itself names them: "{clock} & {letter}" (e.g. "430 & G" = 4:30 & G),
// derived from the official 2026 street_lines.geojson (radial streets are
// named by clock position, annular streets by letter A-K, plus ESP for the
// Esplanade and a 12:00 radial running out to deep playa).
//
// Ten banks aren't near any real intersection — either inside the Esplanade
// ring (no lettered streets there, so named for the nearest plaza/promenade)
// or out past the outermost street near the DMZ / Point 3 markers, where
// there is no grid at all (named landmark + compass direction from it, since
// that is genuinely how you'd find them).
const TOILET_LABELS = [
'930 & D', '930 & G', '230 & C', '230 & G', '3 & D',
'3 & H', '330 & D', '4 & D', '330 & H', '4 & G',
'430 & C', '430 & I', '5 & H', '5 & D', '530 & D',
'530 & H', '6 & C', '6 & H', '630 & G', '630 & D',
'7 & C', '7 & H', '730 & H', '730 & C', '8 & D',
'8 & G', '830 & C', '9 & H', '9 & D', '2 & C',
'2 & F', '10 & D', '10 & G', '300 Portal', 'Man Plaza',
'900 Promenade', 'Temple Plaza', 'Point 3 · WSW', 'Point 3 · S', '12 & J',
'DMZ · ENE', 'DMZ · SE', 'DMZ2 · SSE', 'DMZ2 · SSE II', '830 & F',
];

const TOILETS = [
[40.791956,-119.214308],[40.795078,-119.21659],[40.778457,-119.196689],[40.776584,-119.192384],
[40.776077,-119.197616],[40.77319,-119.194469],[40.774664,-119.201162],[40.77361,-119.204233],
[40.771482,-119.198692],[40.770133,-119.203138],[40.7733,-119.20781],[40.768811,-119.207603],
[40.770075,-119.212438],[40.773616,-119.211241],[40.774515,-119.214228],[40.771457,-119.21693],
[40.776688,-119.217291],[40.772967,-119.221135],[40.776509,-119.223403],[40.778375,-119.21936],
[40.78075,-119.220499],[40.779869,-119.22533],[40.783356,-119.226769],[40.783364,-119.22098],
[40.785963,-119.220549],[40.78682,-119.224942],[40.788328,-119.219111],[40.793483,-119.221054],
[40.790721,-119.216639],[40.781064,-119.195469],[40.780647,-119.192131],[40.792969,-119.211619],
[40.795928,-119.211212],[40.779886,-119.201909],[40.784183,-119.208596],[40.786079,-119.211331],
[40.787852,-119.199337],[40.797015,-119.195055],[40.791013,-119.186478],[40.798507,-119.2063],
[40.799598,-119.201567],[40.79833,-119.20278],[40.77698,-119.183363],[40.777149,-119.18338],
[40.789703,-119.222211]
].map((c, i) => ({ id: i, lat: c[0], lng: c[1], label: TOILET_LABELS[i] }));

// Golden Spike — the surveyed center point of Black Rock City, 2026.
// Source: https://github.com/burningmantech/innovate-GIS-data (2026/GeoJSON/cpns.geojson)
const GOLDEN_SPIKE = { id: 'man', lat: 40.783247, lng: -119.207884, label: 'The Man (Golden Spike)' };
