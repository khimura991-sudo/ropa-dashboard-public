/* ROPA fair market value engine.
 * Estimates what a repossessed unit is likely to sell for, from the company's own past sales:
 *  1. Learns, across all sold units, how price moves with year model, mileage, condition and transmission
 *     (a regression on log price within each brand + model, so model differences don't distort it).
 *  2. Takes the most similar sold units (same brand and model first, then broader groups), adjusts each one's
 *     sold price to the unit being valued, and weights them by similarity and how recent the sale was.
 *  3. Returns the weighted median as the fair market value, with a likely range and a confidence level.
 * Works in the browser (window.FMV) and in Node (module.exports) for testing.
 */
(function (root) {
  'use strict';

  const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const dec = (s) => { let n = 0; for (const ch of s) n = n * 62 + B62.indexOf(ch); return n; };

  // ---------------------------------------------------------------- unpack the export
  // f = { B: brands, M: series, P: products, Y: body types, T: transmissions, C: conditions, r: packed rows, w: row width }
  // Each row (base 62): brand(2) series(2) product(2) body(2) trans(2) cond(2) year(1) km(2) price(3), then
  //   w = 20: month(2)   w = 23: opb(3) month(2)   w = 24: opb(3) day(3)
  // km is in thousands (zz = unknown), price and OPB in thousands of pesos, month = (year - 2000) * 12 + month index,
  // day = days since 1 Jan 2000 (0 = unknown).
  const isoDay = (d) => { const t = new Date(Date.UTC(2000, 0, 1) + d * 864e5); return t.toISOString().slice(0, 10); };
  function unpack(f) {
    const out = [], W = f.w || 20, hasOpb = W >= 23;
    for (let i = 0; i + W <= f.r.length; i += W) {
      const s = f.r.substr(i, W);
      const km = dec(s.substr(13, 2));
      const u = {
        brand: f.B[dec(s.substr(0, 2))], series: f.M[dec(s.substr(2, 2))], product: f.P[dec(s.substr(4, 2))],
        body: f.Y[dec(s.substr(6, 2))], trans: f.T[dec(s.substr(8, 2))], cond: f.C[dec(s.substr(10, 2))], year: 1980 + dec(s[12]),
        km: km === 3843 ? null : km * 1000, price: dec(s.substr(15, 3)) * 1000, opb: hasOpb ? dec(s.substr(18, 3)) * 1000 || null : null,
      };
      if (W >= 24) {
        const d = dec(s.substr(21, 3));
        u.day = d ? isoDay(d) : null;
        u.month = d ? (Number(u.day.slice(0, 4)) - 2000) * 12 + Number(u.day.slice(5, 7)) - 1 : null;
      } else u.month = dec(s.substr(hasOpb ? 21 : 18, 2));
      out.push(u);
    }
    const last = out.reduce((m, u) => Math.max(m, u.month || 0), 0);
    out.forEach((u) => { if (u.month == null) u.month = last; });
    return out;
  }

  // ---------------------------------------------------------------- clean-up of free-text fields
  // The same rules clean the sales file and what people type in the form, so both always match.
  const up = (s) => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();
  const NONE = /^(N\/?A|NONE|NULL|-+|0|UNKNOWN|NOT SPECIFIED)$/;

  const BRAND_FIX = { 'MITSUBIHSI': 'MITSUBISHI', 'MITSUBISHI-FUSO': 'FUSO', 'MITSUBISHI FUSO': 'FUSO', 'KIA MOTORS': 'KIA', 'SINOTRUCK': 'SINOTRUK',
    'REBUILT ISUZU': 'ISUZU', 'MERCEDES': 'MERCEDES-BENZ', 'MERCEDES BENZ': 'MERCEDES-BENZ', 'VW': 'VOLKSWAGEN' };
  function cleanBrand(s) { s = up(s); return BRAND_FIX[s] || s; }

  // Series: tidy spacing and hyphens, drop notes that are not part of the model name (NEW, DET., W/ ..., the brand repeated)
  function cleanSeries(s, brand) {
    s = up(s).replace(/\s*-\s*/g, '-').replace(/[^A-Z0-9./\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (NONE.test(s) || /^W\//.test(s)) return '';
    let t = s.split(' ');
    while (t.length && /^(NEW|ALL-NEW|ALL|DET\.?|DETACHABLE|THE)$/.test(t[0])) t.shift();
    const b = cleanBrand(brand);
    if (t.length > 1 && t[0] === b) { if (/^\d$/.test(t[1])) { t = [t[0] + t[1]].concat(t.slice(2)); } else t.shift(); }
    return t.join(' ');
  }

  const MODEL_FIX = { MONTEROSPORT: 'MONTERO SPORT', MONTERO: 'MONTERO SPORT', XPANPER: 'XPANDER', ADVENTURES: 'ADVENTURE', NAVARRA: 'NAVARA',
    TRAVIS: 'TRAVIZ', STAFE: 'STAREX', SUPERGREAT: 'SUPER GREAT', NV350: 'NV350 URVAN', DMAX: 'D-MAX', MUX: 'MU-X', CRV: 'CR-V', BRV: 'BR-V',
    HRV: 'HR-V', XTRAIL: 'X-TRAIL', H100: 'H-100', BT50: 'BT-50', ECOSPORTS: 'ECOSPORT', VIOZ: 'VIOS', INOVA: 'INNOVA', FORTUNNER: 'FORTUNER' };
  const NO_MODEL = /^(TRUCK|ALUMINUM|BUS|REBUILT|REF|CANOPY|ROOFRACK|ROOF|PIPE|CARGO|DUMP|WING|VAN|CLOSED|GRILLS?|RAILINGS?|POWER|LIFTER|BODY|STEEL|SIDING|EXT)$/;
  // Base model from a series: MIRAGE G4 GLX 1.2 CVT -> MIRAGE G4, D-MAX 3.0 4X4 -> D-MAX, GRAND STAREX GL -> GRAND STAREX
  function modelOf(series, brand) {
    const t = cleanSeries(series, brand).split(' ').filter(Boolean);
    if (!t.length || NO_MODEL.test(t[0])) return '';
    const a = t[0], n = t[1] || '';
    if (/^\d+$/.test(a) && /^WH/.test(n)) return a + ' WHEELER';
    if (a === 'ECO' && n === 'SPORT') return 'ECOSPORT';
    if (a === 'SUPER' && n === 'GREAT') return 'SUPER GREAT';
    if (a === 'GRAND' && n) return 'GRAND ' + (MODEL_FIX[n] || n);
    if (a === 'COROLLA' && n === 'CROSS') return 'COROLLA CROSS';
    if (a === 'NV350' || (a === 'NISSAN' && n === 'URVAN')) return 'NV350 URVAN';
    if (MODEL_FIX[a.replace(/-/g, '')]) return MODEL_FIX[a.replace(/-/g, '')];
    if (MODEL_FIX[a]) return MODEL_FIX[a];
    if (/^[A-Z]\d$/.test(n)) return a + ' ' + n;
    return a;
  }
  const tokens = (s) => up(s).replace(/[^A-Z0-9./\- ]/g, ' ').split(' ').filter(Boolean);

  function normTrans(s) {
    s = up(s);
    const gear = /AUTO|MATIC|A\/T|\bAT\b|CVT|DCT/.test(s) ? 'Automatic' : /MANUAL|M\/T|\bMT\b/.test(s) ? 'Manual' : '';
    const fuel = /DIESEL|\bCRDI\b/.test(s) ? 'Diesel' : /GAS|PETROL|GASOLINE/.test(s) ? 'Gas' : '';
    return [gear, fuel].filter(Boolean).join(' / ') || 'Not specified';
  }
  function normBody(s) {
    s = up(s);
    if (/MULTI ?CAB|SCRUM|\bCARRY\b/.test(s)) return 'Multicab';
    if (/MOTOR|TRICYCLE|TRIKE/.test(s)) return 'Motorcycle / tricycle';
    if (/HATCH/.test(s)) return 'Hatchback';
    if (/SEDAN/.test(s)) return 'Sedan';
    if (/DROP ?SIDE/.test(s)) return 'Dropside';
    if (/DUMP|WING|CLOSED VAN|FREEZER|REEFER|REFRIGERAT|ALUMINUM|BOOM|TRACTOR|TANKER|CHASSIS|C\/C|TRUCK|WHEELER/.test(s)) return 'Truck';
    if (/PICK|DOUBLE ?CAB|SINGLE ?CAB/.test(s)) return 'Pick-up';
    if (/SUV|SPORTS? UTILITY|\bCUV\b|CROSSOVER/.test(s)) return 'SUV';
    if (/WAGON|MPV|AUV/.test(s)) return 'Wagon / MPV';
    if (/VAN|SHUTTLE|COMMUTER|\bFB\b|JITNEY|\bBUS\b/.test(s)) return 'Van';
    return 'Not specified'; // e.g. blank, N/A, UTILITY VEHICLE, SUB COMPACT: filled from the model's usual body type
  }
  function normCond(s) {
    s = up(s);
    if (/MAJOR|ENGINE|NOT RUNNING|TOWED|NON.?START|FLOOD|WRECK/.test(s)) return 'Major issues';
    if (/MODERATE|MECHANICAL/.test(s)) return 'Moderate issues';
    if (/MINOR|BODY|GOOD|RUNNING/.test(s)) return 'Minor issues';
    return 'Not specified';
  }
  // Mileage in km, or null when unreadable (N/A, NOT WORKING, NO DISPLAY, under 1,000 or over 999,999 km)
  function normKm(v) {
    if (typeof v === 'number') return v >= 1000 && v <= 999999 ? Math.round(v) : null;
    const s = up(v);
    if (!s || /NOT WORK|NO DISPLAY|DEFECT|BROKEN|N\/A|NONE|UNKNOWN/.test(s)) return null;
    const m = s.match(/\d[\d,.]*/);
    if (!m) return null;
    let x = m[0];
    x = /^\d{1,3}(\.\d{3})+$/.test(x) ? x.replace(/\./g, '') : x.replace(/,/g, '');
    const n = Number(x);
    return n >= 1000 && n <= 999999 ? Math.round(n) : null;
  }
  const jaccard = (a, b) => { const A = new Set(a), Bs = new Set(b); let i = 0; A.forEach((x) => { if (Bs.has(x)) i++; }); const u = A.size + Bs.size - i; return u ? i / u : 0; };

  // ---------------------------------------------------------------- learn price adjustments
  // log(price) = group effect + bYear*year + bKm*ln(km) + bMod*moderate + bMaj*major + bAuto*automatic
  function solve(A, b) { // small Gaussian elimination
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-9) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function learn(units) {
    const rows = units.filter((u) => u.price > 0 && u.year > 1980);
    const kmKnown = rows.filter((u) => u.km > 0);
    const medKm = kmKnown.length ? kmKnown.map((u) => u.km).sort((a, b) => a - b)[kmKnown.length >> 1] : 80000;
    const feat = (u) => [u.year, Math.log(u.km > 0 ? u.km : medKm), u.condN === 'Moderate issues' ? 1 : 0, u.condN === 'Major issues' ? 1 : 0, /Automatic/.test(u.transN) ? 1 : 0];
    const groups = {};
    rows.forEach((u) => { if (u.key) (groups[u.key] = groups[u.key] || []).push(u); });
    const X = [], y = [];
    Object.values(groups).forEach((g) => {
      if (g.length < 2) return;
      const F = g.map(feat), L = g.map((u) => Math.log(u.price));
      const mf = F[0].map((_, j) => F.reduce((s, r) => s + r[j], 0) / F.length), ml = L.reduce((s, v) => s + v, 0) / L.length;
      F.forEach((r, i) => { X.push(r.map((v, j) => v - mf[j])); y.push(L[i] - ml); });
    });
    const k = 5, ridge = [2, 2, 2, 2, 2]; // light shrinkage keeps small samples sensible
    const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? ridge[i] : 0)));
    const b = Array.from({ length: k }, (_, i) => X.reduce((s, r, n) => s + r[i] * y[n], 0));
    const w = (X.length >= 20 && solve(A, b)) || [0.07, -0.08, -0.08, -0.2, 0.05];
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    return {
      year: clamp(w[0], 0.02, 0.15), km: clamp(w[1], -0.25, 0), moderate: clamp(w[2], -0.3, 0), major: clamp(w[3], -0.5, 0),
      auto: clamp(w[4], -0.05, 0.12), medKm, n: X.length,
    };
  }

  function prepare(raw) {
    const units = raw.filter((u) => u.price > 0).map((u) => {
      const brand = cleanBrand(u.brand), series = cleanSeries(u.series, u.brand), model = modelOf(u.series, u.brand);
      return Object.assign({}, u, { brandN: brand, seriesN: series, model, key: model ? brand + '|' + model : '', tok: tokens(series),
        bodyN: normBody(u.body), transN: normTrans(u.trans), condN: normCond(u.cond), productN: up(u.product),
        km: typeof u.km === 'number' ? normKm(u.km) : normKm(u.km) });
    });
    // Fill a missing or vague body type with the body type most often recorded for that model
    const mode = {};
    units.forEach((u) => { if (u.key && u.bodyN !== 'Not specified') { const m = (mode[u.key] = mode[u.key] || {}); m[u.bodyN] = (m[u.bodyN] || 0) + 1; } });
    units.forEach((u) => { if (u.bodyN === 'Not specified' && mode[u.key]) { const m = mode[u.key]; u.bodyN = Object.keys(m).sort((a, b) => m[b] - m[a])[0]; } });
    const lastMonth = units.reduce((m, x) => Math.max(m, x.month || 0), 0);
    return { units, coef: learn(units), lastMonth };
  }

  // ---------------------------------------------------------------- weighted percentiles
  function wq(pairs, q) {
    const s = pairs.slice().sort((a, b) => a.v - b.v), tot = s.reduce((t, p) => t + p.w, 0);
    let acc = 0;
    for (const p of s) { acc += p.w; if (acc >= q * tot) return p.v; }
    return s.length ? s[s.length - 1].v : null;
  }

  // ---------------------------------------------------------------- estimate one unit
  // q = { product, brand, series, year, body, trans, km, cond } (body, trans, km, cond, product optional)
  function estimate(m, q, opts) {
    opts = opts || {};
    const c = m.coef;
    const brand = cleanBrand(q.brand), series = cleanSeries(q.series, q.brand), model = modelOf(q.series, q.brand), key = model ? brand + '|' + model : '\u0000', tok = tokens(series);
    const body = q.body && normBody(q.body) !== 'Not specified' ? normBody(q.body) : '', trans = q.trans && normTrans(q.trans) !== 'Not specified' ? normTrans(q.trans) : '', cond = q.cond ? normCond(q.cond) : '';
    const product = up(q.product), year = Number(q.year), km = normKm(Number(q.km));
    const pool = m.units.filter((u) => u !== opts.exclude);

    const tiers = [
      { name: 'same brand and model', test: (u) => u.key === key, w: 1 },
      { name: 'same brand and body type', test: (u) => u.brandN === brand && (!body || u.bodyN === body), w: 0.12 },
      { name: 'same body type', test: (u) => (body ? u.bodyN === body : u.productN === product), w: 0.02 },
    ];
    const comps = [];
    let level = null, sameModel = 0;
    for (const t of tiers) {
      pool.forEach((u) => {
        if (comps.some((x) => x.u === u) || !t.test(u)) return;
        const dy = Math.abs(u.year - year);
        let w = t.w * Math.exp(-dy / 3) * Math.exp(-Math.max(0, m.lastMonth - u.month) / 12);
        w *= 1 + 2 * jaccard(tok, u.tok);
        if (body && u.bodyN === body) w *= 1.5;
        if (trans && u.transN === trans) w *= 1.3;
        if (product && u.productN === product) w *= 1.2;
        if (cond && u.condN === cond) w *= 1.2;
        // adjust the comparable's sold price to the unit being valued
        let adj = c.year * (year - u.year);
        if (km && u.km > 0) adj += c.km * (Math.log(km) - Math.log(u.km));
        const cv = (s) => (s === 'Moderate issues' ? c.moderate : s === 'Major issues' ? c.major : 0);
        if (cond && cond !== 'Not specified' && u.condN !== 'Not specified') adj += cv(cond) - cv(u.condN);
        if (trans && /Automatic|Manual/.test(trans) && /Automatic|Manual/.test(u.transN)) adj += c.auto * ((/Automatic/.test(trans) ? 1 : 0) - (/Automatic/.test(u.transN) ? 1 : 0));
        adj = Math.max(-0.7, Math.min(0.7, adj));
        comps.push({ u, w, v: u.price * Math.exp(adj), tier: t.name });
        if (t.w === 1) sameModel++;
      });
      const wsum = comps.reduce((s, x) => s + x.w, 0);
      if (!level && comps.length) level = t.name;
      if (comps.length >= 8 && wsum >= 1.5) break;
    }
    if (!comps.length) return null;

    const fmv = wq(comps, 0.5);
    // Likely range: middle of the adjusted comparables, never narrower than the method's typical error
    const minBand = sameModel >= 5 ? 0.12 : sameModel >= 2 ? 0.17 : 0.25;
    let low = wq(comps, 0.15), high = wq(comps, 0.85);
    low = Math.min(low, fmv * (1 - minBand)); high = Math.max(high, fmv * (1 + minBand));
    const spread = (high - low) / fmv;
    const effN = Math.pow(comps.reduce((s, x) => s + x.w, 0), 2) / comps.reduce((s, x) => s + x.w * x.w, 0);
    const confidence = sameModel >= 5 && spread <= 0.5 ? 'High' : sameModel >= 2 || (comps.length >= 5 && spread <= 0.7) ? 'Medium' : 'Low';
    const months = comps.map((x) => x.u.month);
    const r5 = (v) => Math.round(v / 5000) * 5000;
    return {
      fmv: r5(fmv), low: r5(low), high: r5(high), confidence, comps: comps.length, sameModel, effN, level,
      fromMonth: Math.min.apply(null, months), toMonth: Math.max.apply(null, months), model, bodyN: body, transN: trans, condN: cond,
      rawFmv: fmv,
      // Closest sold units (most similar first): what the estimate leaned on most
      top: comps.slice().sort((a, b) => b.w - a.w).slice(0, 10).map((x) => ({
        brand: x.u.brandN, model: x.u.model, series: x.u.seriesN, year: x.u.year, body: x.u.bodyN, trans: x.u.transN, cond: x.u.condN,
        km: x.u.km, month: x.u.month, price: x.u.price, adjusted: x.v, match: x.tier })),
    };
  }

  // Lists for the form: brands, models by brand, years, etc.
  function options(m) {
    const count = (f) => { const c = {}; m.units.forEach((u) => { const k = f(u); if (k) c[k] = (c[k] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a]); };
    // Suggestions per brand: the clean model names, most sold first
    const seriesBy = {};
    m.units.forEach((u) => { if (!u.model) return; const c = (seriesBy[u.brandN] = seriesBy[u.brandN] || {}); c[u.model] = (c[u.model] || 0) + 1; });
    Object.keys(seriesBy).forEach((b) => { const c = seriesBy[b]; seriesBy[b] = Object.keys(c).sort((x, y) => c[y] - c[x]); });
    return { brands: count((u) => u.brandN).sort(), products: count((u) => u.productN), bodies: count((u) => u.bodyN), trans: count((u) => u.transN), seriesBy };
  }

  const api = { unpack, prepare, estimate, options, normBody, normTrans, normCond, normKm, modelOf, cleanBrand, cleanSeries, B62 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FMV = api;
})(typeof window !== 'undefined' ? window : this);
