// The Golden Compass — app logic
(() => {
  'use strict';

  const ALL_TARGETS = TOILETS; // from data.js

  // Most of the world reads distance in meters; only a handful of countries
  // (US chief among them) default to feet. Guess from the browser's locale,
  // but only as a starting point — an explicit user choice always wins.
  function detectDefaultUnit() {
    try {
      const imperialRegions = new Set(['US', 'LR', 'MM']); // US, Liberia, Myanmar
      const langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
      for (const l of langs) {
        const region = (l.split('-')[1] || '').toUpperCase();
        if (region) return imperialRegions.has(region) ? 'ft' : 'm';
      }
    } catch (e) { /* ignore */ }
    return 'm';
  }

  const state = {
    userPos: null,        // { lat, lng, accuracy }
    heading: null,         // degrees, 0 = true/compass north, device-reported
    headingSource: null,   // 'ios' | 'absolute' | 'alpha' | null
    mode: 'nearest',       // 'nearest' | 'man' | 'chosen'
    chosenId: null,
    unit: localStorage.getItem('pc-unit') || detectDefaultUnit(),
    watchId: null,
    lastGpsAt: 0,
  };

  // ---------- geo math ----------
  const R_EARTH = 6371000; // meters
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  function haversine(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(a));
  }

  function bearing(lat1, lng1, lat2, lng2) {
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const els = {
    trailWrap: $('trail-wrap'),
    trailField: $('trail-field'),
    dots: Array.from(document.querySelectorAll('#dots .trail-dot')),
    distanceVal: $('distance-val'),
    distanceUnit: $('distance-unit'),
    targetLabel: $('target-label'),
    metaLabel: $('meta-label'),
    gpsDot: $('gps-dot'),
    gpsStatus: $('gps-status'),
    compassDot: $('compass-dot'),
    compassStatus: $('compass-status'),
    permBanner: $('permission-banner'),
    permText: $('permission-text'),
    permBtn: $('permission-btn'),
    manualBanner: $('manual-banner'),
    manualLat: $('manual-lat'),
    manualLng: $('manual-lng'),
    manualLatSign: $('manual-lat-sign'),
    manualLngSign: $('manual-lng-sign'),
    manualSet: $('manual-set'),
    modeNearest: $('mode-nearest'),
    modeMan: $('mode-man'),
    modeList: $('mode-list'),
    listPanel: $('list-panel'),
    bankList: $('bank-list'),
    listEmpty: $('list-empty'),
    unitFt: $('unit-ft'),
    unitM: $('unit-m'),
  };

  // ---------- unit handling ----------
  function fmtDistance(meters) {
    if (state.unit === 'ft') {
      // Plain feet all the way up. The whole city fits inside ~7000ft, and
      // "1.42 k ft" (kilofeet) is not a unit anyone reads at a glance.
      return { val: Math.round(meters * 3.28084).toLocaleString('en-US'), unit: 'ft' };
    }
    if (meters >= 1000) return { val: (meters / 1000).toFixed(2), unit: 'km' };
    return { val: Math.round(meters).toString(), unit: 'm' };
  }

  function setUnit(unit) {
    state.unit = unit;
    localStorage.setItem('pc-unit', unit);
    els.unitFt.classList.toggle('active', unit === 'ft');
    els.unitM.classList.toggle('active', unit === 'm');
    render();
    if (listVisible()) updateList();
  }

  els.unitFt.addEventListener('click', () => setUnit('ft'));
  els.unitM.addEventListener('click', () => setUnit('m'));

  // ---------- target selection ----------
  function nearestTarget() {
    if (!state.userPos) return null;
    let best = null, bestD = Infinity;
    for (const t of ALL_TARGETS) {
      const d = haversine(state.userPos.lat, state.userPos.lng, t.lat, t.lng);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best ? { ...best, _dist: bestD } : null;
  }

  function currentTarget() {
    if (state.mode === 'man') return { ...GOLDEN_SPIKE, _dist: state.userPos ? haversine(state.userPos.lat, state.userPos.lng, GOLDEN_SPIKE.lat, GOLDEN_SPIKE.lng) : null };
    if (state.mode === 'chosen' && state.chosenId != null) {
      const t = ALL_TARGETS.find(t => t.id === state.chosenId);
      if (t) return { ...t, _dist: state.userPos ? haversine(state.userPos.lat, state.userPos.lng, t.lat, t.lng) : null };
    }
    return nearestTarget();
  }

  const listVisible = () => !els.listPanel.classList.contains('hidden');

  els.modeNearest.addEventListener('click', () => setMode('nearest'));
  els.modeMan.addEventListener('click', () => setMode('man'));
  els.modeList.addEventListener('click', () => {
    const showing = listVisible();
    els.listPanel.classList.toggle('hidden', showing);
    els.modeList.classList.toggle('active', !showing);
    if (!showing) updateList();
  });

  function setMode(mode) {
    state.mode = mode;
    els.modeNearest.classList.toggle('active', mode === 'nearest');
    els.modeMan.classList.toggle('active', mode === 'man');
    // Leaving 'chosen' clears the highlighted row, so refresh an open list —
    // otherwise it kept highlighting a bank the compass was no longer aimed at.
    if (listVisible()) updateList();
    render();
  }

  // ---------- bank list ----------
  // Rows are created once and thereafter only updated in place. Rebuilding all
  // 45 rows on every GPS tick meant the list could reorder between touchstart
  // and click, so a tap landed on whichever bank had slid under the finger.
  // Ranking is applied via CSS `order`, which reorders visually without moving
  // any DOM node.
  const rowById = new Map();

  function buildList() {
    for (const t of ALL_TARGETS) {
      const row = document.createElement('div');
      row.className = 'bank-row';
      row.dataset.id = String(t.id);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.label;

      const tag = document.createElement('span');
      tag.className = 'tag hidden';
      tag.textContent = 'NEAREST';
      name.appendChild(tag);

      const dist = document.createElement('span');
      dist.className = 'dist';
      dist.textContent = '—';

      row.append(name, dist);
      els.bankList.appendChild(row);
      rowById.set(t.id, { row, dist, tag });
    }
  }

  // Delegated, so it is registered once and survives in-place updates.
  els.bankList.addEventListener('click', (e) => {
    const row = e.target.closest('.bank-row');
    if (!row) return;
    state.chosenId = Number(row.dataset.id);
    state.mode = 'chosen';
    els.modeNearest.classList.remove('active');
    els.modeMan.classList.remove('active');
    updateList();
    render();
  });

  function updateList() {
    const hasFix = !!state.userPos;
    els.listEmpty.classList.toggle('hidden', hasFix);
    els.bankList.classList.toggle('hidden', !hasFix);
    if (!hasFix) return;

    const ranked = ALL_TARGETS
      .map(t => ({ id: t.id, dist: haversine(state.userPos.lat, state.userPos.lng, t.lat, t.lng) }))
      .sort((a, b) => a.dist - b.dist);

    ranked.forEach((entry, i) => {
      const parts = rowById.get(entry.id);
      if (!parts) return;
      const d = fmtDistance(entry.dist);
      parts.row.style.order = String(i);
      parts.dist.textContent = `${d.val} ${d.unit}`;
      parts.row.classList.toggle('selected', state.mode === 'chosen' && state.chosenId === entry.id);
      parts.tag.classList.toggle('hidden', i !== 0);
    });
  }

  // ---------- marching trail ----------
  // CSS interpolates rotate() numerically, so handing it a value that wraps
  // (359deg -> 1deg) swings the trail backwards almost all the way round.
  // That fired constantly, because the wrap happens exactly when the target
  // passes straight ahead. Keep an unwrapped running angle instead and always
  // move by the shortest signed delta.
  let trailAngle = 0;
  function rotateTrail(deg) {
    const delta = ((deg - trailAngle) % 360 + 540) % 360 - 180;
    trailAngle += delta;
    els.trailField.style.transform = `rotate(${trailAngle}deg)`;
  }

  // The trail marches faster the closer you are. Quantised into bands so the
  // animation is not restarted on every GPS tick — reassigning duration mid
  // cycle makes the dots visibly stutter.
  const MARCH_BANDS = [
    { within: 25, seconds: 0.7 },
    { within: 60, seconds: 0.9 },
    { within: 150, seconds: 1.15 },
    { within: 300, seconds: 1.45 },
    { within: 600, seconds: 1.8 },
    { within: Infinity, seconds: 2.2 },
  ];
  let marchSeconds = null;
  function setMarchSpeed(meters) {
    const seconds = MARCH_BANDS.find((b) => meters <= b.within).seconds;
    if (seconds === marchSeconds) return;
    marchSeconds = seconds;
    // Even stagger keeps the dots equally spaced along the trail whatever the
    // speed, so the delays have to be recomputed with the duration.
    els.dots.forEach((dot, i) => {
      dot.style.animationDuration = `${seconds}s`;
      dot.style.animationDelay = `${-(i / els.dots.length) * seconds}s`;
    });
  }

  // Inside this radius the bearing is mostly GPS noise and the trail would
  // spin uselessly, so switch to a calm "you're here" pulse instead.
  const ARRIVED_M = 12;

  function render() {
    const target = currentTarget();
    if (!target) {
      els.targetLabel.textContent = 'Waiting for GPS…';
      els.distanceVal.textContent = '--';
      // Without this the placeholder kept the markup's hard-coded "ft" even
      // when the user (or their locale) had selected meters.
      els.distanceUnit.textContent = state.unit;
      return;
    }
    els.targetLabel.textContent = target.label;

    if (target._dist != null) {
      const d = fmtDistance(target._dist);
      els.distanceVal.textContent = d.val;
      els.distanceUnit.textContent = d.unit;
    } else {
      els.distanceVal.textContent = '--';
      els.distanceUnit.textContent = state.unit;
    }

    if (state.userPos) {
      const dist = target._dist != null ? target._dist : Infinity;
      const arrived = dist <= ARRIVED_M;
      els.trailWrap.classList.toggle('arrived', arrived);
      setMarchSpeed(dist);

      if (arrived) {
        els.metaLabel.textContent = 'You should be standing at it';
        return;
      }

      const brg = bearing(state.userPos.lat, state.userPos.lng, target.lat, target.lng);
      // Dots stream "up" within the field, so rotating the field by the
      // relative bearing aims them the way you actually have to walk.
      if (state.heading != null) {
        rotateTrail((brg - state.heading + 360) % 360);
        els.metaLabel.textContent = `Bearing ${Math.round(brg)}° · Heading ${Math.round(state.heading)}°`;
      } else {
        // No compass: the trail can only be drawn relative to true north, so
        // say so rather than implying the top of the screen is your facing.
        rotateTrail(brg);
        els.metaLabel.textContent = `Bearing ${Math.round(brg)}° from true north · trail is north-up`;
      }
    }
  }

  // ---------- geolocation ----------
  function onPosition(pos) {
    state.userPos = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
    state.lastGpsAt = Date.now();
    els.gpsDot.className = 'dot ' + (pos.coords.accuracy <= 15 ? 'ok' : pos.coords.accuracy <= 50 ? 'warn' : '');
    els.gpsStatus.textContent = `GPS: ±${Math.round(pos.coords.accuracy)}m`;
    els.manualBanner.classList.add('hidden');
    if (listVisible()) updateList();
    render();
  }

  function onPositionError(err) {
    els.gpsDot.className = 'dot';
    els.gpsStatus.textContent = 'GPS: ' + (err.code === 1 ? 'denied' : 'unavailable');
    if (!state.userPos) els.manualBanner.classList.remove('hidden');
  }

  function startGeolocation() {
    if (!('geolocation' in navigator)) {
      els.gpsStatus.textContent = 'GPS: not supported';
      els.manualBanner.classList.remove('hidden');
      return;
    }
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });
  }

  // iOS's decimal keypad has no minus key, so sign is a separate toggle
  // rather than something typed. Any "-" a user does manage to type
  // (e.g. on Android) is normalized away via Math.abs — the toggle wins.
  function bindSignToggle(btn, positiveLabel, negativeLabel) {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.sign) === 1 ? -1 : 1;
      btn.dataset.sign = String(next);
      btn.textContent = next === 1 ? positiveLabel : negativeLabel;
    });
  }
  bindSignToggle(els.manualLatSign, 'N', 'S');
  bindSignToggle(els.manualLngSign, 'E', 'W');

  els.manualSet.addEventListener('click', () => {
    const latMag = Math.abs(parseFloat(els.manualLat.value));
    const lngMag = Math.abs(parseFloat(els.manualLng.value));
    if (isNaN(latMag) || isNaN(lngMag)) return;
    const lat = latMag * Number(els.manualLatSign.dataset.sign);
    const lng = lngMag * Number(els.manualLngSign.dataset.sign);
    state.userPos = { lat, lng, accuracy: 9999 };
    els.gpsDot.className = 'dot warn';
    els.gpsStatus.textContent = 'GPS: manual';
    els.manualBanner.classList.add('hidden');
    if (listVisible()) updateList();
    render();
  });

  // ---------- device orientation / compass ----------
  function handleOrientation(e) {
    let heading = null;
    let source = null;
    if (typeof e.webkitCompassHeading === 'number') {
      // iOS: already a compass heading (0 = true north), lower is more accurate.
      heading = e.webkitCompassHeading;
      source = 'ios';
    } else if (e.absolute && e.alpha != null) {
      heading = 360 - e.alpha;
      source = 'absolute';
    } else if (e.alpha != null) {
      heading = 360 - e.alpha;
      source = 'alpha';
    }
    if (heading == null || isNaN(heading)) return;
    state.heading = (heading + 360) % 360;
    state.headingSource = source;
    els.compassDot.className = 'dot ' + (source === 'ios' || source === 'absolute' ? 'ok' : 'warn');
    els.compassStatus.textContent = 'Compass: ' + (source === 'ios' ? 'live' : source === 'absolute' ? 'live' : 'uncalibrated');
    render();
  }

  function startOrientation() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: needs a user gesture, handled by permission button.
      return 'needs-permission';
    }
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evName, handleOrientation);
    return 'started';
  }

  async function requestPermissions() {
    els.permBtn.disabled = true;
    els.permBtn.textContent = 'Requesting…';
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation);
        } else {
          els.compassStatus.textContent = 'Compass: denied';
        }
      }
    } catch (err) {
      els.compassStatus.textContent = 'Compass: error';
    }
    startGeolocation();
    els.permBanner.classList.add('hidden');
  }

  els.permBtn.addEventListener('click', requestPermissions);

  // ---------- boot ----------
  function boot() {
    els.unitFt.classList.toggle('active', state.unit === 'ft');
    els.unitM.classList.toggle('active', state.unit === 'm');
    const needsIOSPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if (!needsIOSPermission) {
      startOrientation();
      startGeolocation();
      els.permBanner.classList.add('hidden');
    }
    // Timeout: if no compass event arrives, tell the user it's unavailable.
    setTimeout(() => {
      if (state.heading == null) {
        els.compassStatus.textContent = 'Compass: unavailable';
      }
    }, 5000);
    buildList();
    updateList();
    render();
  }

  boot();

  // Register service worker for offline use (no-op if unsupported, e.g. file://).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
