// The Golden Compass — data
// Toilet ("John") bank locations sourced from the official Burning Man Project
// GIS release: https://github.com/burningmantech/innovate-GIS-data (2025/GeoJSON/toilets.geojson)
// Each bank was published as a footprint polygon; the coordinate below is that
// polygon's centroid. 45 banks, 2025 placement plan.
// Bank layout is redrawn each year but historically shifts only modestly —
// treat these as "close enough to walk toward" until the current year's
// official map is out, then swap this file (see README).
const TOILET_YEAR = 2025;

// Bank names, in the same order as the coordinates below. Most banks sit
// right at a real street intersection, so they're named the way Burning Man
// itself names them: "{clock} & {letter}" (e.g. "430 & G" = 4:30 & G),
// derived from the official 2025 street_lines.geojson (radial streets are
// named by clock position, arc streets spell that year's theme — 2025 was
// science-fiction authors, A=Atwood ... K=Kilgore).
//
// A handful of banks aren't near any real intersection — either inside the
// Esplanade ring (no lettered streets there, so named for the nearest named
// plaza/promenade) or out past the outermost street in the open "deep playa"
// entrance near the DMZ / Point 3 perimeter markers (named landmark + the
// compass direction from it, since that's genuinely how you'd find them).
const TOILET_LABELS = [
'930 & H', '930 & D', '9 & D', '9 & H', '830 & G',
'830 & C', '8 & D', '8 & G', '730 & C', '730 & H',
'7 & G', '7 & C', '630 & D', '630 & G', '6 & H',
'6 & C', '615 & B', '6 & B', '530 & D', '530 & G',
'5 & G', '5 & D', '430 & I', '430 & C', '4 & C',
'4 & G', '330 & H', '330 & C', '3 & H', '3 & D',
'230 & C', '230 & H', '10 & G', '10 & B', '900 Promenade',
'Man Plaza', '300 Promenade', '2 & F', '2 & B', 'Temple Plaza',
'DMZ · ESE', 'DMZ · NNE', 'DMZ · WNW', 'DMZ · E', 'Point 3 · S',
];

const TOILETS = [
[40.798873,-119.211993],[40.79572,-119.209571],[40.794418,-119.211908],[40.797104,-119.215931],
[40.793807,-119.218238],[40.791968,-119.214035],[40.78973,-119.215845],[40.790525,-119.220026],
[40.78708,-119.216106],[40.787062,-119.22183],[40.783563,-119.22034],[40.784487,-119.215702],
[40.782106,-119.214526],[40.780263,-119.218559],[40.776707,-119.216247],[40.780392,-119.212411],
[40.78118,-119.212037],[40.780521,-119.211516],[40.778263,-119.209446],[40.775052,-119.211616],
[40.773839,-119.207619],[40.777303,-119.206284],[40.772584,-119.202816],[40.777012,-119.202924],
[40.77738,-119.199528],[40.773899,-119.198344],[40.775219,-119.193846],[40.778409,-119.196387],
[40.776925,-119.189618],[40.779887,-119.193015],[40.782119,-119.191654],[40.780213,-119.187245],
[40.799989,-119.208015],[40.795374,-119.205686],[40.789821,-119.206417],[40.786705,-119.200265],
[40.784226,-119.198799],[40.784273,-119.18656],[40.784911,-119.191161],[40.79114,-119.193264],
[40.801382,-119.196232],[40.803629,-119.197903],[40.802915,-119.203693],[40.801305,-119.190902],
[40.795203,-119.182015]
].map((c, i) => ({ id: i, lat: c[0], lng: c[1], label: TOILET_LABELS[i] }));

// Golden Spike — the surveyed center point of Black Rock City, 2025.
// Source: https://innovate.burningman.org/dataset/2025-golden-spike-and-general-city-map-data/
const GOLDEN_SPIKE = { id: 'man', lat: 40.786958, lng: -119.202994, label: 'The Man (Golden Spike)' };
