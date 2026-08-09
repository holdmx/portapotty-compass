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
    needleWrap: $('needle-wrap'),
    labels: $('compass-labels'),
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
    unitFt: $('unit-ft'),
    unitM: $('unit-m'),
  };

  // ---------- unit handling ----------
  function fmtDistance(meters) {
    if (state.unit === 'ft') {
      const ft = meters * 3.28084;
      if (ft >= 1000) return { val: (ft / 1000).toFixed(2), unit: 'k ft' };
      return { val: Math.round(ft).toString(), unit: 'ft' };
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
    if (!els.listPanel.classList.contains('hidden')) renderList();
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

  els.modeNearest.addEventListener('click', () => setMode('nearest'));
  els.modeMan.addEventListener('click', () => setMode('man'));
  els.modeList.addEventListener('click', () => {
    const showing = !els.listPanel.classList.contains('hidden');
    els.listPanel.classList.toggle('hidden', showing);
    els.modeList.classList.toggle('active', !showing);
    if (!showing) renderList();
  });

  function setMode(mode) {
    state.mode = mode;
    els.modeNearest.classList.toggle('active', mode === 'nearest');
    els.modeMan.classList.toggle('active', mode === 'man');
    render();
  }

  function renderList() {
    if (!state.userPos) {
      els.bankList.innerHTML = '<p style="color:var(--cream-dim);font-size:0.8rem;padding:8px;">Waiting for GPS to sort by distance…</p>';
      return;
    }
    const withDist = ALL_TARGETS.map(t => ({ ...t, _dist: haversine(state.userPos.lat, state.userPos.lng, t.lat, t.lng) }));
    withDist.sort((a, b) => a._dist - b._dist);
    els.bankList.innerHTML = withDist.map((t, i) => {
      const d = fmtDistance(t._dist);
      const selected = state.mode === 'chosen' && state.chosenId === t.id;
      const tag = i === 0 ? '<span class="tag">NEAREST</span>' : '';
      return `<div class="bank-row${selected ? ' selected' : ''}" data-id="${t.id}">
        <span class="name">${t.label}${tag}</span>
        <span class="dist">${d.val} ${d.unit}</span>
      </div>`;
    }).join('');
    els.bankList.querySelectorAll('.bank-row').forEach(row => {
      row.addEventListener('click', () => {
        state.chosenId = Number(row.dataset.id);
        state.mode = 'chosen';
        els.modeNearest.classList.remove('active');
        els.modeMan.classList.remove('active');
        renderList();
        render();
      });
    });
  }

  // ---------- rendering ----------
  function render() {
    const target = currentTarget();
    if (!target) {
      els.targetLabel.textContent = 'Waiting for GPS…';
      return;
    }
    els.targetLabel.textContent = target.label;

    if (target._dist != null) {
      const d = fmtDistance(target._dist);
      els.distanceVal.textContent = d.val;
      els.distanceUnit.textContent = d.unit;
    } else {
      els.distanceVal.textContent = '--';
    }

    if (state.userPos) {
      const brg = bearing(state.userPos.lat, state.userPos.lng, target.lat, target.lng);
      // The dial face (N/E/S/W) stays fixed — only the needle turns, showing
      // where the target is relative to the way the phone is currently
      // pointed. (Rotating the dial too, by -heading, would cancel out the
      // needle's own -heading term and make it look frozen relative to the
      // ring as you turned in place — that was the bug.)
      if (state.heading != null) {
        const rel = (brg - state.heading + 360) % 360;
        els.needleWrap.style.transform = `rotate(${rel}deg)`;
        els.metaLabel.textContent = `Bearing ${Math.round(brg)}° · Heading ${Math.round(state.heading)}°`;
      } else {
        // No compass sensor: show absolute bearing, dial stays N-up.
        els.needleWrap.style.transform = `rotate(${brg}deg)`;
        els.metaLabel.textContent = `Bearing ${Math.round(brg)}° from true north (align phone manually)`;
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
    if (els.listPanel && !els.listPanel.classList.contains('hidden')) renderList();
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
    renderList();
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
