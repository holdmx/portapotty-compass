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

  // Fold any angle to the signed shortest form, [-180, 180).
  const fold = a => ((a % 360) + 540) % 360 - 180;

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const els = {
    sceneCanvas: $('scene'),
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

  function addRow(t) {
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

  function buildList() {
    for (const t of ALL_TARGETS) addRow(t);
  }

  // ---------- test mode ----------
  // ?test drops synthetic johns around your first fix, so the whole pee
  // pipeline can be exercised anywhere on Earth (say, a hotel in Miami)
  // without flying to Black Rock City. One lands exactly where you stand
  // (instant arrival — walk away and come back), the rest at walkable
  // distances on spread bearings to hit every flow regime.
  const TEST_MODE = new URLSearchParams(location.search).has('test');
  let testPointsAdded = false;

  function addTestPoints(lat, lng) {
    if (!TEST_MODE || testPointsAdded) return;
    testPointsAdded = true;
    const mLat = 111320; // meters per degree latitude
    const mLng = 111320 * Math.cos(toRad(lat));
    const defs = [
      { label: 'TEST · right here', dN: 0, dE: 0 },
      { label: 'TEST · 80 m N', dN: 80, dE: 0 },
      { label: 'TEST · 250 m W', dN: 0, dE: -250 },
      { label: 'TEST · 700 m SW', dN: -495, dE: -495 },
    ];
    for (const d of defs) {
      const t = {
        id: ALL_TARGETS.length, // real banks use array indices, so these follow on
        lat: lat + d.dN / mLat,
        lng: lng + d.dE / mLng,
        label: d.label,
      };
      ALL_TARGETS.push(t);
      addRow(t);
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

  // ---------- the pee stream ----------
  // The marching dot trail is gone. The compass is now a first-person pee
  // stream: the bottom edge of the scene is your fly, the stream launches up
  // over the playa and lands ahead, and TWO things guide you home:
  //   direction — the arc bends toward the target (a porta-potty glyph
  //   walks in from the horizon as you close the distance), and
  //   pressure — flow = alignment x urgency. Dead-on and close is a
  //   firehose; off-bearing decays through dribble, drips, then "stage
  //   fright"; long range sputters in drip-spurts.
  //
  // Everything below is driven per-frame by rAF (CSS keyframes can't retune
  // continuously without restarting — the stutter the old MARCH_BANDS code
  // banded around). Droplets are capped and the loop skips to ~30fps to keep
  // all-day playa battery use sane.

  // Inside this radius the bearing is mostly GPS noise; you are standing at
  // it — full release.
  const ARRIVED_M = 12;

  // The palette has no yellow, and flame-as-pee does not read as pee. The
  // fluid gets its own dedicated colors, used by nothing else.
  const PEE = { core: '#FFD447', bright: '#FFF3B0', amber: '#E3A81C', puddle: '#F4CB35' };
  // The john, in real-world rental blue with the white domed cap.
  const PORTA = { body: '#3E8FCC', shade: '#2E6EA6', dark: '#1F4E78', roof: '#D9DEE2', roofEdge: '#AEB6BC', sign: '#F4F4EF' };
  const BONE = '#EADEDE';
  const FLAME = '#F58840'; // app ember — dry-mode guide arc, not fluid

  // What render() knows, handed to the animation loop.
  const scene = {
    active: false,  // GPS fix + target with a distance
    dist: null,     // meters to target
    rel: null,      // signed relative bearing (deg); null = no compass
    northLean: 0,   // no-compass fallback: bearing, drawn north-up
    isMan: false,   // target is the Man — different glyph, same disrespect
    // Pee is for emergencies only: it fires in Nearest mode. Navigating to
    // the Man or a hand-picked bank draws a dry marching-dash guide instead
    // (in-universe: you only really NEED to go when it's the nearest one).
    pee: true,
    dryCaption: '',
  };

  const MAX_D = 900; // m — beyond this urgency bottoms out
  const urgencyAt = d => (1 - Math.min(d, MAX_D) / MAX_D) ** 1.3;

  // flow = alignment(aim error) x (0.30 + 0.70 x urgency). Gaussian sweet
  // spot ~±15°, hard zero ("stage fright") past 105°. Dead-on aim always
  // gives ≥30% so the compass never feels broken at range.
  function flowAt(offDeg, distM) {
    const a = Math.abs(offDeg);
    if (a > 105) return 0;
    return Math.exp(-((a / 38) ** 2)) * (0.3 + 0.7 * urgencyAt(distM));
  }

  function stateLabel(flow, distM) {
    if (distM != null && distM <= ARRIVED_M) return 'Sweet relief';
    if (flow >= 0.8) return 'FIREHOSE';
    if (flow >= 0.45) return 'Steady stream';
    if (flow >= 0.18) return 'Dribble';
    if (flow > 0.02) return 'Drops…';
    return 'Stage fright';
  }

  // Caption writes are cheap but flickery captions are worse than none:
  // only swap the text when it actually changed, with a short dwell.
  let capText = null, capAt = 0;
  function setCaption(text) {
    if (text === capText) return;
    const now = performance.now();
    if (capText !== null && now - capAt < 250) return;
    capText = text;
    capAt = now;
    els.metaLabel.textContent = text;
  }

  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sceneRenderer = (() => {
    const cvs = els.sceneCanvas;
    const ctx = cvs && cvs.getContext ? cvs.getContext('2d') : null;
    if (!ctx) return { requestStaticFrame: () => {}, start: () => {} };

    const W = 300, H = 360;             // logical size, scaled by CSS
    const SRC = { x: 150, y: 358 };     // bottom edge = your fly
    const HORIZON_Y = 70;
    const SCREEN_G = 380;               // px/s^2 — droplets fall like liquid
    const TWIST_K = (Math.PI * 2) / 16; // twist wavelength along the arc
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    cvs.width = W * dpr;
    cvs.height = H * dpr;
    ctx.scale(dpr, dpr);

    const drops = [];    // ballistic droplets (breakup, drips, splash)
    const rings = [];    // impact ripples (foreshortened ellipses)
    const packets = [];  // drip-spurt slugs flying the arc
    const pools = [];    // puddles: volume accumulators, they dry when unfed
    let packetAcc = 0, sourceDripAcc = 0, breakAcc = 0, splashAcc = 0;
    let solidMode = false; // solid stream vs drip-spurt, with hysteresis
    let dripClock = 0, ringClock = 0, arrivedRingClock = 0;
    let arrivedT = 0;
    let glintPhase = 0, twistPhase = 0, dashPhase = 0;
    let sputterEnv = 1;
    let flowS = 0; // EMA-smoothed flow so compass jitter never flickers it
    let last = performance.now();
    let lastDraw = 0;
    let raf = 0;

    // Volume lands somewhere: feed the nearby puddle or start a new one.
    // Lone drips add so little they evaporate before ever pooling — only a
    // sustained stream held on one spot grows a real puddle.
    function addVolume(x, y, dA) {
      for (const p of pools) {
        if (Math.hypot(p.x - x, p.y - y) < 16 + Math.sqrt(p.A / Math.PI)) {
          p.A += dA;
          p.x += (x - p.x) * 0.08;
          p.y += (y - p.y) * 0.08;
          return;
        }
      }
      pools.push({ x, y, A: dA });
      if (pools.length > 3) {
        let mi = 0;
        for (let i = 1; i < pools.length; i++) if (pools[i].A < pools[mi].A) mi = i;
        pools.splice(mi, 1);
      }
    }

    // Ballistic arc as a quadratic Bezier whose chord obeys the aim: lean
    // bends it toward the target, range scales with flow (pseudo-perspective:
    // far = high on screen). `attract` locks the landing onto the john when
    // you're close + well-aimed — and clamps so you never overshoot it.
    function buildArc(flowA, leanDeg, attract) {
      const leanRad = (Math.max(-60, Math.min(60, leanDeg)) * Math.PI) / 180;
      const rangeM = 0.5 + 4.3 * flowA ** 1.25;
      let Ly = 332 - 250 * (rangeM / (rangeM + 2.2));
      let Lx = Math.max(45, Math.min(255, 150 + Math.sin(leanRad) * (50 + 130 * (rangeM / 5))));
      if (attract) {
        Lx += (attract.x - Lx) * attract.w;
        Ly += (attract.y - Ly) * attract.w;
        Ly = Math.max(Ly, attract.y - 2); // land short of the john, never past it
      }
      let apexY = 300 - 230 * flowA;
      apexY = Math.min(apexY, Ly - 12 - 20 * flowA);
      const Cx = (SRC.x + Lx) / 2 + Math.sin(leanRad) * 30;
      const Cy = (4 * apexY - SRC.y - Ly) / 2;
      const P = (t) => {
        const s = 1 - t;
        return {
          x: s * s * SRC.x + 2 * s * t * Cx + t * t * Lx,
          y: s * s * SRC.y + 2 * s * t * Cy + t * t * Ly,
        };
      };
      let len = 0, prev = P(0);
      for (let i = 1; i <= 12; i++) {
        const cur = P(i / 12);
        len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
        prev = cur;
      }
      return { P, L: { x: Lx, y: Ly }, len, flow: flowA, wMul: 1 };
    }

    // The arrival hose: one massive stream square into the middle of the
    // door. Fixed geometry — you're standing right in front of it.
    function buildArrivalArc(flowA) {
      const Cq = { x: 162, y: 190 };
      const Lq = { x: 152, y: 277 };
      const P = (t) => {
        const s = 1 - t;
        return {
          x: s * s * SRC.x + 2 * s * t * Cq.x + t * t * Lq.x,
          y: s * s * SRC.y + 2 * s * t * Cq.y + t * t * Lq.y,
        };
      };
      let len = 0, prev = P(0);
      for (let i = 1; i <= 12; i++) {
        const cur = P(i / 12);
        len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
        prev = cur;
      }
      return { P, L: Lq, len, flow: flowA, wMul: 1.9 };
    }

    // One solid stream: two thin strands braided around a faint core, twist
    // pattern traveling WITH the flow, bright glints racing along it. The
    // arc itself never wobbles — animate along the path, never the path
    // (a waving arc reads as flame, not liquid).
    function drawStream(arc) {
      const w0 = (2.2 + 4.2 * arc.flow) * arc.wMul;
      const N = 26;
      const pts = [];
      for (let i = 0; i <= N; i++) pts.push(arc.P(i / N));
      ctx.lineCap = 'round';

      if (arc.flow > 0.25) {
        for (const strandPhase of [0, Math.PI]) {
          let prev = null;
          for (let i = 0; i <= N; i++) {
            const t = i / N;
            const a = pts[Math.max(0, i - 1)];
            const b = pts[Math.min(N, i + 1)];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dl = Math.hypot(dx, dy) || 1;
            const amp = (0.5 + 2.0 * t) * (0.7 + 0.5 * arc.flow) * Math.sqrt(arc.wMul);
            const off = amp * Math.sin((t * arc.len - twistPhase) * TWIST_K + strandPhase);
            const q = { x: pts[i].x + (-dy / dl) * off, y: pts[i].y + (dx / dl) * off };
            if (prev) {
              ctx.strokeStyle = PEE.core;
              ctx.globalAlpha = 0.9;
              ctx.lineWidth = Math.max(0.5, w0 * (1 - 0.6 * t) * 0.62);
              ctx.beginPath();
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
            }
            prev = q;
          }
        }
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = PEE.core;
        ctx.lineWidth = Math.max(0.8, w0 * 0.35);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i <= N; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      } else {
        // weak flow: a single thin ribbon, no coherent twist left
        let prev = pts[0];
        for (let i = 1; i <= N; i++) {
          ctx.strokeStyle = PEE.core;
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = Math.max(0.6, w0 * (1 - (0.6 * i) / N));
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          prev = pts[i];
        }
      }

      for (let k = 0; k < 3; k++) {
        const t0 = (glintPhase + k / 3) % 1;
        const t1 = Math.min(1, t0 + 0.05);
        if (t1 - t0 < 0.01) continue;
        const a = arc.P(t0), b = arc.P(t1);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = PEE.bright;
        ctx.lineWidth = Math.max(0.8, w0 * (1 - 0.6 * t0) * 0.5);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Miniature of the classic blue porta-potty. Detail falls away at small
    // sizes; the horizon marker keeps the silhouette (blue box, white dome).
    function drawJohn(cx, baseY, h, alpha) {
      const w = h * 0.62;
      const l = cx - w / 2, r = cx + w / 2;
      const roofH = h * 0.13;
      const bodyTop = baseY - h + roofH;
      const taper = w * 0.04;
      ctx.globalAlpha = alpha;
      if (h > 30) {
        ctx.fillStyle = PORTA.dark;
        ctx.fillRect(l + 1, baseY - 1, 4, 3);
        ctx.fillRect(r - 5, baseY - 1, 4, 3);
      }
      ctx.fillStyle = PORTA.body;
      ctx.beginPath();
      ctx.moveTo(l, baseY);
      ctx.lineTo(l + taper, bodyTop);
      ctx.lineTo(r - taper, bodyTop);
      ctx.lineTo(r, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PORTA.dark;
      ctx.lineWidth = Math.max(0.8, h * 0.02);
      ctx.stroke();
      const dw = w * 0.5;
      const dl = cx - dw / 2;
      const dTop = bodyTop + h * 0.08;
      const dBot = baseY - h * 0.06;
      ctx.fillStyle = PORTA.shade;
      ctx.beginPath();
      ctx.moveTo(dl, dBot);
      ctx.lineTo(dl, dTop + dw * 0.35);
      ctx.quadraticCurveTo(dl, dTop, cx, dTop);
      ctx.quadraticCurveTo(dl + dw, dTop, dl + dw, dTop + dw * 0.35);
      ctx.lineTo(dl + dw, dBot);
      ctx.closePath();
      ctx.fill();
      if (h > 26) {
        ctx.fillStyle = PORTA.sign;
        ctx.fillRect(cx - (dw * 0.72) / 2, dTop + h * 0.14, dw * 0.72, h * 0.18);
        ctx.fillStyle = PORTA.dark;
        ctx.beginPath();
        ctx.arc(dl + dw + w * 0.09, (dTop + dBot) / 2, Math.max(0.7, h * 0.018), 0, Math.PI * 2);
        ctx.fill();
      }
      if (h > 34) {
        ctx.strokeStyle = PORTA.dark;
        ctx.lineWidth = 0.8;
        for (let v = 0; v < 3; v++) {
          const vy = bodyTop + h * 0.06 + v * h * 0.045;
          ctx.beginPath();
          ctx.moveTo(l + w * 0.08, vy);
          ctx.lineTo(l + w * 0.24, vy);
          ctx.stroke();
        }
      }
      const rl = l - w * 0.05, rr = r + w * 0.05;
      const rb = bodyTop, rt = bodyTop - roofH;
      ctx.fillStyle = PORTA.roof;
      ctx.beginPath();
      ctx.moveTo(rl, rb);
      ctx.lineTo(rl, rb - roofH * 0.35);
      ctx.quadraticCurveTo(rl, rt, rl + w * 0.22, rt);
      ctx.lineTo(rr - w * 0.22, rt);
      ctx.quadraticCurveTo(rr, rt, rr, rb - roofH * 0.35);
      ctx.lineTo(rr, rb);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PORTA.roofEdge;
      ctx.lineWidth = Math.max(0.7, h * 0.015);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The Man, arms up, for 'man' mode. He can take it.
    function drawMan(cx, baseY, h, alpha) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = BONE;
      ctx.lineWidth = Math.max(1, h * 0.055);
      ctx.lineCap = 'round';
      const head = h * 0.13;
      const top = baseY - h;
      ctx.beginPath();
      ctx.arc(cx, top + head, head, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, top + head * 2);
      ctx.lineTo(cx, baseY - h * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - h * 0.3, top + head * 0.5);
      ctx.lineTo(cx, top + head * 2.4);
      ctx.lineTo(cx + h * 0.3, top + head * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - h * 0.22, baseY);
      ctx.lineTo(cx, baseY - h * 0.35);
      ctx.lineTo(cx + h * 0.22, baseY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function spawnFountain(arc) {
      // the arrival hose hits the door mid-body — its splash falls all the
      // way to the ground at the base, not to the impact height
      const groundY = arc.wMul > 1 ? 301 + Math.random() * 3 : arc.L.y + 2 + Math.random() * 3;
      drops.push({
        x: arc.L.x + (Math.random() * 2 - 1) * 4,
        y: arc.L.y,
        vx: (Math.random() * 2 - 1) * (18 + 60 * arc.flow) * arc.wMul,
        vy: -(30 + Math.random() * (60 + 130 * arc.flow)),
        r: (0.7 + Math.random() * 1.0) * (arc.wMul > 1 ? 1.3 : 1),
        t: 0,
        ttl: 0.8,
        dieY: groundY,
        bright: Math.random() < 0.35,
        secondary: true, // the fountain IS splash — no re-splash cascade
      });
    }

    // Shared per-frame scene math, used by both the live loop and the
    // reduced-motion static frame. In dry mode (pee=false) the arc slot
    // carries the guide curve instead — fixed medium shape, no fluid.
    function sceneGeometry(flow, offDeg, arrived, d, pee) {
      const johnT = arrived ? 1 : Math.max(0, Math.min(1, (150 - d) / 138));
      const hClamp = Math.max(-80, Math.min(80, offDeg));
      const johnX = arrived ? 150 : Math.max(18, Math.min(282,
        150 + Math.sin((hClamp * Math.PI) / 180) * 115 * (1 - johnT ** 1.2)));
      const johnY = arrived ? 300 : HORIZON_Y - 1 + (300 - (HORIZON_Y - 1)) * johnT ** 1.8;
      const johnH = arrived ? 50 : 15 + 35 * johnT ** 1.6;
      let arc = null;
      if (arrived) {
        arc = pee ? buildArrivalArc(flow) : null;
      } else if (!pee || flow > 0.02) {
        const wAttract = Math.min(0.95,
          Math.max(0, (80 - d) / 55) * Math.exp(-((offDeg / 25) ** 2)));
        arc = buildArc(pee ? flow : 0.6, offDeg, { x: johnX, y: johnY - 4, w: wAttract });
      }
      return { johnT, johnX, johnY, johnH, arc };
    }

    // Dry mode: same ballistic guide curve, but drawn as marching dashes in
    // the app's own ember — a nod to the old dot trail, zero pee involved.
    function drawGuide(arc) {
      ctx.save();
      ctx.strokeStyle = FLAME;
      ctx.shadowColor = FLAME;
      ctx.shadowBlur = 5;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.setLineDash([7, 9]);
      ctx.lineDashOffset = -dashPhase;
      ctx.beginPath();
      const p0 = arc.P(0);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i <= 26; i++) {
        const q = arc.P(i / 26);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawBackdrop() {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = BONE;
      ctx.globalAlpha = 0.08;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, HORIZON_Y);
      ctx.lineTo(W, HORIZON_Y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function drawTargetGlyph(g, offDeg, arrived, johnT) {
      const nearAim = Math.exp(-((offDeg / 50) ** 2));
      const alpha = arrived ? 0.92 : Math.min(0.95, 0.3 + 0.6 * nearAim + 0.3 * johnT);
      (scene.isMan ? drawMan : drawJohn)(g.johnX, g.johnY, g.johnH, alpha);
    }

    function step(now) {
      raf = requestAnimationFrame(step);
      // ~30fps is plenty for pee and kind to the battery
      if (now - lastDraw < 31) return;
      lastDraw = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tsec = now / 1000;

      if (!scene.active) {
        drawBackdrop();
        return;
      }

      const d = scene.dist;
      const pee = scene.pee;
      const arrived = d <= ARRIVED_M;
      arrivedT = arrived ? arrivedT + dt : 0;
      const grow = Math.min(1, arrivedT / 5);
      const off = scene.rel != null ? scene.rel : scene.northLean;
      const aAbs = Math.abs(off);

      // flow: aim x urgency (or urgency alone when there is no compass to
      // judge aim by), EMA-smoothed, with long-range sputter on top.
      // Dry mode targets zero, so switching away from Nearest lets the
      // stream die out and the puddles dry instead of vanishing abruptly.
      const target = !pee ? 0
        : arrived ? 0.85
        : scene.rel != null ? flowAt(off, d)
        : 0.75 * (0.3 + 0.7 * urgencyAt(d));
      flowS += (target - flowS) * Math.min(1, dt * 6);
      const sputterStrength = arrived ? 0 : Math.max(0, Math.min(1, 1 - urgencyAt(d) * 1.6));
      const noise = 0.5 + (Math.sin(tsec * 6.7) + 0.6 * Math.sin(tsec * 11.9 + 2.1) + 0.4 * Math.sin(tsec * 23.7 + 0.7)) / 4;
      const gate = noise > sputterStrength * 0.62 ? 1 : 0.12;
      sputterEnv += (gate - sputterEnv) * Math.min(1, dt * 14);
      const flow = arrived ? flowS : flowS * sputterEnv;

      if (solidMode && flow < 0.36) solidMode = false;
      else if (!solidMode && flow > 0.44) solidMode = true;
      const solid = arrived || solidMode;

      const g = sceneGeometry(flow, off, arrived, d, pee);
      const arc = g.arc;
      const crossTime = 0.9 - 0.45 * flow;
      glintPhase = (glintPhase + dt / crossTime) % 1;
      twistPhase += ((arc ? arc.len : 100) / crossTime) * dt;
      dashPhase += 26 * dt; // dry-mode dashes march toward the target

      // ---- emission ----
      if (pee && arc && solid) {
        addVolume(arrived ? 150 : arc.L.x, arrived ? 302 : arc.L.y,
          240 * Math.min(1.4, arc.flow * arc.wMul) ** 1.8 * dt);
        breakAcc += (4 + 26 * arc.flow) * dt;
        while (breakAcc >= 1 && drops.length < 150) {
          breakAcc -= 1;
          const tr = 0.75 + Math.random() * 0.2;
          const p0 = arc.P(tr);
          const p1 = arc.P(Math.min(1, tr + 0.02));
          const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
          const v = (arc.len / crossTime) * 0.85;
          drops.push({
            x: p0.x, y: p0.y,
            vx: ((p1.x - p0.x) / dl) * v + (Math.random() * 2 - 1) * 14,
            vy: ((p1.y - p0.y) / dl) * v,
            r: 0.9 + Math.random() * 1.1,
            t: 0, ttl: 0.9, dieY: arc.L.y + 3,
            bright: Math.random() < 0.3,
          });
        }
        splashAcc += (10 + 55 * arc.flow) * arc.wMul * dt;
        while (splashAcc >= 1 && drops.length < 170) {
          splashAcc -= 1;
          spawnFountain(arc);
        }
      } else if (pee && arc) {
        // drip-spurt regime: ragged slugs of liquid, plus drips falling short
        packetAcc += (1.0 + 4 * flow) * dt;
        while (packetAcc >= 1 && packets.length < 10) {
          packetAcc -= 1;
          const lenFrac = 0.04 + 0.16 * flow + Math.random() * 0.05;
          packets.push({
            t: -lenFrac,
            lenFrac,
            wander: (Math.random() * 2 - 1) * 2.6,
            speed: 0.85 + Math.random() * 0.3,
            bright: Math.random() < 0.3,
          });
        }
        sourceDripAcc += (2 + 9 * flow) * dt;
        while (sourceDripAcc >= 1 && drops.length < 150) {
          sourceDripAcc -= 1;
          const p0 = arc.P(0);
          const p1 = arc.P(0.06);
          const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
          const v = (arc.len / crossTime) * (0.35 + Math.random() * 0.22);
          drops.push({
            x: p0.x, y: p0.y,
            vx: ((p1.x - p0.x) / dl) * v + (Math.random() * 2 - 1) * 10,
            vy: ((p1.y - p0.y) / dl) * v,
            r: 1.2 + Math.random() * 0.9,
            t: 0, ttl: 1.4,
            dieY: SRC.y - (SRC.y - arc.L.y) * (0.25 + Math.random() * 0.3),
            bright: Math.random() < 0.2,
          });
        }
      } else if (pee && !arrived && target > 0 && aAbs <= 105) {
        // the lone sad drip off the bottom edge
        dripClock += dt;
        if (dripClock > 2.0) {
          dripClock = 0;
          drops.push({
            x: SRC.x + (Math.random() * 2 - 1) * 3,
            y: SRC.y - 6,
            vx: (Math.random() * 2 - 1) * 6, vy: -25,
            r: 1.8, t: 0, ttl: 1.2, dieY: 353, bright: false,
          });
        }
      }

      // ---- packets fly the arc, shed drips, then slap down ----
      if (pee && arc && !solid) {
        for (let i = packets.length - 1; i >= 0; i--) {
          const pk = packets[i];
          pk.t += (dt / crossTime) * pk.speed;
          const stretch = 1 + 1.1 * Math.max(0, Math.min(1, pk.t));
          if (pk.t + pk.lenFrac * stretch >= 1) {
            packets.splice(i, 1);
            addVolume(arc.L.x, arc.L.y, 18);
            for (let s = 0; s < 4 && drops.length < 170; s++) {
              const a2 = Math.random() * Math.PI * 2;
              const sp = 20 + Math.random() * 40;
              drops.push({
                x: arc.L.x, y: arc.L.y,
                vx: Math.cos(a2) * sp, vy: -Math.abs(Math.sin(a2)) * sp - 20,
                r: 0.7 + Math.random() * 0.9,
                t: 0, ttl: 0.3 + Math.random() * 0.15,
                dieY: arc.L.y + 2 + Math.random() * 2,
                secondary: true, bright: Math.random() < 0.4,
              });
            }
            rings.push({ x: arc.L.x, y: arc.L.y, r: 2, max: 9 + Math.random() * 5 });
            continue;
          }
          if (Math.random() < dt * 5 && drops.length < 160) {
            const tt = Math.max(0, pk.t) + 0.01;
            if (tt < 0.9) {
              const p0 = arc.P(tt);
              const p1 = arc.P(Math.min(1, tt + 0.02));
              const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
              const v = (arc.len / crossTime) * 0.45 * pk.speed;
              drops.push({
                x: p0.x, y: p0.y,
                vx: ((p1.x - p0.x) / dl) * v + (Math.random() * 2 - 1) * 6,
                vy: ((p1.y - p0.y) / dl) * v,
                r: 0.8 + Math.random() * 0.6,
                t: 0, ttl: 1.2,
                dieY: SRC.y + (arc.L.y - SRC.y) * Math.min(0.95, tt + 0.25 + Math.random() * 0.3),
                bright: Math.random() < 0.25,
              });
            }
          }
        }
      } else {
        packets.length = 0;
      }

      // ---- puddles dry back into the playa unless liquid keeps coming ----
      for (let i = pools.length - 1; i >= 0; i--) {
        pools[i].A -= (14 + 0.02 * pools[i].A) * dt;
        if (pools[i].A <= 4) pools.splice(i, 1);
      }

      // ripple rings
      ringClock += dt;
      arrivedRingClock += dt;
      if (pee && !arrived && arc && solid && flow > 0.35 && ringClock > 0.7) {
        ringClock = 0;
        rings.push({ x: arc.L.x, y: arc.L.y, r: 3, max: 16 + 18 * flow });
      }
      if (pee && arrived && pools.length && arrivedRingClock > 0.45) {
        arrivedRingClock = 0;
        const p = pools[Math.floor(Math.random() * pools.length)];
        rings.push({
          x: p.x + (Math.random() * 2 - 1) * 8,
          y: p.y + (Math.random() * 2 - 1) * 3,
          r: 3, max: 14 + Math.random() * 14,
        });
      }
      // dry arrival: the old calm "you're here" pulse, no fluids involved
      if (!pee && arrived && arrivedRingClock > 0.85) {
        arrivedRingClock = 0;
        rings.push({ x: 150, y: 274, r: 14, max: 85, dry: true });
      }

      // ---- droplet physics ----
      for (let i = drops.length - 1; i >= 0; i--) {
        const dp = drops[i];
        dp.t += dt;
        dp.vy += SCREEN_G * dt;
        dp.x += dp.vx * dt;
        dp.y += dp.vy * dt;
        const landed = dp.vy > 0 && dp.y >= dp.dieY;
        if (!landed && dp.t < dp.ttl) continue;
        drops.splice(i, 1);
        if (landed && !dp.secondary && drops.length < 170) {
          addVolume(dp.x, dp.dieY, 2.5); // a lone drip barely wets the dust
          const n = 2 + (Math.random() < 0.5 ? 1 : 0);
          for (let s = 0; s < n; s++) {
            drops.push({
              x: dp.x + (Math.random() * 2 - 1) * 2,
              y: dp.dieY - 1,
              vx: (Math.random() * 2 - 1) * 34,
              vy: -(24 + Math.random() * 46),
              r: Math.max(0.5, dp.r * (0.35 + Math.random() * 0.3)),
              t: 0, ttl: 0.3 + Math.random() * 0.15,
              dieY: dp.dieY + 2,
              secondary: true, bright: Math.random() < 0.4,
            });
          }
          if (dp.r >= 1.1 && !arrived) {
            rings.push({ x: dp.x, y: dp.dieY, r: 1.5, max: 7 + Math.random() * 4 });
          }
        }
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].r += 30 * dt;
        if (rings[i].r >= rings[i].max) rings.splice(i, 1);
      }

      // ---- draw ----
      drawBackdrop();
      drawTargetGlyph(g, off, arrived, g.johnT);
      if (pee && arrived && !scene.isMan) {
        // runoff streaking down from the door hit as the hose-down goes on
        ctx.globalAlpha = 0.45 * (0.3 + 0.7 * grow);
        ctx.strokeStyle = PEE.amber;
        ctx.lineWidth = 1.4;
        for (const [sx, ph] of [[145, 0.6], [158, 2.3]]) {
          ctx.beginPath();
          ctx.moveTo(sx, 276);
          for (let j = 1; j <= 5; j++) {
            ctx.lineTo(sx + Math.sin(j * 1.5 + ph + tsec * 2) * 1.6, 276 + j * 4.6);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      for (const ring of rings) {
        ctx.globalAlpha = Math.max(0, 0.5 * (1 - ring.r / ring.max));
        ctx.strokeStyle = ring.dry ? BONE : PEE.amber;
        ctx.lineWidth = ring.dry ? 2 : 1.5;
        ctx.beginPath();
        if (ring.dry) {
          ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        } else {
          ctx.ellipse(ring.x, ring.y, ring.r, ring.r * 0.32, 0, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      for (let i = 0; i < pools.length; i++) {
        const p = pools[i];
        const r = Math.min(38, Math.sqrt(p.A / Math.PI));
        if (r < 1.6) continue;
        const wob = 1 + 0.04 * Math.sin(tsec * 4 + i * 1.7);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = PEE.puddle;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * wob, r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = PEE.amber;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.shadowColor = PEE.core;
      ctx.shadowBlur = 5;

      if (!pee && arc) {
        drawGuide(arc);
      } else if (arc && solid) {
        drawStream(arc);
      } else if (arc) {
        ctx.lineCap = 'round';
        for (const pk of packets) {
          const stretch = 1 + 1.1 * Math.max(0, Math.min(1, pk.t));
          const effLen = pk.lenFrac * stretch;
          const t0 = Math.max(0, pk.t);
          const tEnd = Math.min(1, pk.t + effLen);
          if (tEnd <= 0.002 || t0 >= 1) continue;
          const wBase = ((2.0 + 3.6 * arc.flow) / Math.sqrt(stretch)) * 1.1;
          let prevQ = null;
          const n = 6;
          for (let i = 0; i <= n; i++) {
            const tt = t0 + ((tEnd - t0) * i) / n;
            const a = arc.P(Math.max(0, tt - 0.02));
            const b = arc.P(Math.min(1, tt + 0.02));
            const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const base = arc.P(tt);
            const offW = pk.wander * Math.sin(Math.PI * tt);
            const q = { x: base.x + (-(b.y - a.y) / dl) * offW, y: base.y + ((b.x - a.x) / dl) * offW };
            if (prevQ) {
              // tapered at BOTH ends — a slug of liquid, not a tracer round
              const wid = Math.max(0.6, wBase * Math.sin(Math.PI * (i / n)) ** 0.7 * (1 - 0.45 * tt));
              ctx.strokeStyle = pk.bright ? PEE.bright : PEE.core;
              ctx.globalAlpha = 0.9;
              ctx.lineWidth = wid;
              ctx.beginPath();
              ctx.moveTo(prevQ.x, prevQ.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
            }
            prevQ = q;
          }
        }
        ctx.globalAlpha = 1;
      }

      for (const dp of drops) {
        const speed = Math.hypot(dp.vx, dp.vy);
        ctx.globalAlpha = Math.max(0.15, 1 - dp.t / dp.ttl) * 0.9;
        const color = dp.bright ? PEE.bright : PEE.core;
        if (speed > 60) {
          const len = Math.max(1.5, Math.min(6, speed * 0.016));
          ctx.strokeStyle = color;
          ctx.lineWidth = dp.r * 1.6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(dp.x - (dp.vx / speed) * len, dp.y - (dp.vy / speed) * len);
          ctx.lineTo(dp.x, dp.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(dp.x, dp.y, dp.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 0;

      // ---- caption ----
      if (!pee) {
        setCaption(arrived ? 'You should be standing at it' : (scene.dryCaption || '\u00a0'));
        return;
      }
      let label = stateLabel(arrived ? 1 : flow, d);
      if (!arrived && sputterStrength > 0.55 && flowS > 0.15) label = 'Sputtering…';
      if (arrived) setCaption('Sweet relief — let it flow');
      else if (label === 'Stage fright') setCaption('Stage fright — turn around');
      else if (scene.rel == null) setCaption(`${label} · north-up (no compass)`);
      else setCaption(`${label} · flow ${Math.round(flow * 100)}%`);
    }

    // Reduced motion: one static frame per state change — the arc, the john
    // and the caption carry all the information; nothing animates.
    function staticFrame() {
      drawBackdrop();
      if (!scene.active) {
        setCaption('\u00a0');
        return;
      }
      const d = scene.dist;
      const pee = scene.pee;
      const arrived = d <= ARRIVED_M;
      const off = scene.rel != null ? scene.rel : scene.northLean;
      const flow = !pee ? 0.6
        : arrived ? 0.85
        : scene.rel != null ? flowAt(off, d)
        : 0.75 * (0.3 + 0.7 * urgencyAt(d));
      const g = sceneGeometry(flow, off, arrived, d, pee);
      drawTargetGlyph(g, off, arrived, g.johnT);
      if (g.arc && !pee) {
        drawGuide(g.arc);
      } else if (g.arc) {
        ctx.shadowColor = PEE.core;
        ctx.shadowBlur = 5;
        const w0 = (2.2 + 4.2 * g.arc.flow) * g.arc.wMul;
        ctx.lineCap = 'round';
        let prev = g.arc.P(0);
        for (let i = 1; i <= 26; i++) {
          const cur = g.arc.P(i / 26);
          ctx.strokeStyle = PEE.core;
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = Math.max(0.6, w0 * (1 - (0.6 * i) / 26));
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(cur.x, cur.y);
          ctx.stroke();
          prev = cur;
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
      if (!pee) {
        setCaption(arrived ? 'You should be standing at it' : (scene.dryCaption || '\u00a0'));
        return;
      }
      const label = stateLabel(arrived ? 1 : flow, d);
      if (arrived) setCaption('Sweet relief — let it flow');
      else if (label === 'Stage fright') setCaption('Stage fright — turn around');
      else if (scene.rel == null) setCaption(`${label} · north-up (no compass)`);
      else setCaption(`${label} · flow ${Math.round(flow * 100)}%`);
    }

    function start() {
      if (REDUCED) {
        staticFrame();
        return;
      }
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(step);
      // Pee pauses when nobody is looking (battery lives matter on playa).
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          cancelAnimationFrame(raf);
        } else {
          last = performance.now();
          raf = requestAnimationFrame(step);
        }
      });
    }

    return {
      start,
      requestStaticFrame: () => { if (REDUCED) staticFrame(); },
    };
  })();

  function render() {
    const target = currentTarget();
    if (!target) {
      els.targetLabel.textContent = 'Waiting for GPS…';
      els.distanceVal.textContent = '--';
      // Without this the placeholder kept the markup's hard-coded "ft" even
      // when the user (or their locale) had selected meters.
      els.distanceUnit.textContent = state.unit;
      scene.active = false;
      sceneRenderer.requestStaticFrame();
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

    if (state.userPos && target._dist != null) {
      const brg = bearing(state.userPos.lat, state.userPos.lng, target.lat, target.lng);
      scene.active = true;
      scene.dist = target._dist;
      scene.isMan = target.id === 'man';
      // Pee is reserved for the Nearest john — that's the emergency. The
      // Man and hand-picked banks get the dry marching-dash guide. In test
      // mode a hand-picked point pees too, so any TEST target can exercise
      // the full pipeline without walking the exact nearest-first order.
      scene.pee = state.mode === 'nearest' || (TEST_MODE && state.mode === 'chosen');
      if (state.heading != null) {
        // aim error: how far your facing is off the bearing to the target
        scene.rel = fold(brg - state.heading);
        scene.dryCaption = `Bearing ${Math.round(brg)}° · Heading ${Math.round(state.heading)}°`;
      } else {
        // No compass: alignment is unknowable, so the stream runs at a
        // steady urgency-only flow and leans by bearing, north-up.
        scene.rel = null;
        scene.northLean = fold(brg);
        scene.dryCaption = `Bearing ${Math.round(brg)}° from true north · north-up`;
      }
    } else {
      scene.active = false;
    }
    sceneRenderer.requestStaticFrame();
  }

  // ---------- geolocation ----------
  function onPosition(pos) {
    state.userPos = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
    state.lastGpsAt = Date.now();
    addTestPoints(state.userPos.lat, state.userPos.lng);
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
    addTestPoints(lat, lng);
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
    sceneRenderer.start();
  }

  boot();

  // Register service worker for offline use (no-op if unsupported, e.g. file://).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
