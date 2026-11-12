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
  // f = { B: brands, M: series, P: products, Y: body types, T: transmissions, C: conditions, r: packed rows }
  // Each row is 20 characters (base 62): brand(2) series(2) product(2) body(2) trans(2) cond(2) year(1) km(2) price(3) month(2)
  // km is in thousands (zz = unknown), price in thousands of pesos, month = (year - 2000) * 12 + month index.
  function unpack(f) {
    const out = [], W = 20;
    for (let i = 0; i + W <= f.r.length; i += W) {
      const s = f.r.substr(i, W);
      const km = dec(s.substr(13, 2));
      out.push({
        brand: f.B[dec(s.substr(0, 2))], series: f.M[dec(s.substr(2, 2))], product: f.P[dec(s.substr(4, 2))],
        body: f.Y[dec(s.substr(6, 2))], trans: f.T[dec(s.substr(8, 2))], cond: f.C[dec(s.substr(10, 2))], year: 1980 + dec(s[12]),
        km: km === 3843 ? null : km * 1000, price: dec(s.substr(15, 3)) * 1000, month: dec(s.substr(18, 2)),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- clean-up of free-text fields
  const up = (s) => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();
  function normTrans(s) {
    s = up(s);
    const gear = /AUTO|MATIC|A\/T|\bAT\b|CVT|DCT/.test(s) ? 'Automatic' : /MANUAL|M\/T|\bMT\b/.test(s) ? 'Manual' : '';
    const fuel = /DIESEL|\bD\b/.test(s) ? 'Diesel' : /GAS|PETROL|\bG\b/.test(s) ? 'Gas' : '';
    return [gear, fuel].filter(Boolean).join(' / ') || 'Other';
  }
  function normBody(s) {
    s = up(s);
    if (/MULTI ?CAB|MINI ?(TRUCK|VAN)|SCRUM|CARRY/.test(s)) return 'Multicab';
    if (/HATCH/.test(s)) return 'Hatchback';
    if (/SEDAN/.test(s)) return 'Sedan';
    if (/PICK ?-?UP/.test(s)) return 'Pick-up';
    if (/SUV/.test(s)) return 'SUV';
    if (/WAGON|AUV|MPV/.test(s)) return 'Wagon / MPV';
    if (/DROP ?SIDE/.test(s)) return 'Dropside';
    if (/TRUCK|C\/C|CAB ?& ?CHASSIS|CHASSIS|ALUMINUM|WING|REEFER|CLOSED|TRACTOR|DUMP|TANKER/.test(s)) return 'Truck';
    if (/VAN|URVAN|HIACE|COMMUTER/.test(s)) return 'Van';
    if (/MOTOR|TRICYCLE|TRIKE/.test(s)) return 'Motorcycle / tricycle';
    return s ? s.charAt(0) + s.slice(1).toLowerCase() : 'Other';
  }
  function normCond(s) {
    s = up(s);
    if (/MAJOR|ENGINE|NOT RUNNING|NON.?START/.test(s)) return 'Major issues';
    if (/MODERATE|MECHANICAL/.test(s)) return 'Moderate issues';
    if (/MINOR|BODY|GOOD|RUNNING/.test(s)) return 'Minor issues';
    return 'Not specified';
  }
  const tokens = (s) => up(s).replace(/[^A-Z0-9./ ]/g, ' ').split(' ').filter(Boolean);
  function modelOf(series) {
    const t = tokens(series);
    if (!t.length) return '';
    let m = t[0];
    const nx = t[1] || '';
    if (/^[A-Z]\d$/.test(nx) || /^(SPT|SPORT|SPORTS|URVAN|CROSS|PLUS|GRANDIA|COMMUTER)$/.test(nx)) m += ' ' + (nx === 'SPT' || nx === 'SPORTS' ? 'SPORT' : nx);
    return m;
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
    rows.forEach((u) => { (groups[u.key] = groups[u.key] || []).push(u); });
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
      const brand = up(u.brand), series = up(u.series);
      return Object.assign({}, u, { brandN: brand, seriesN: series, model: modelOf(series), key: brand + '|' + modelOf(series), tok: tokens(series),
        bodyN: normBody(u.body), transN: normTrans(u.trans), condN: normCond(u.cond), productN: up(u.product) });
    });
    const lastMonth = units.reduce((m, u) => Math.max(m, u.month || 0), 0);
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
    const brand = up(q.brand), series = up(q.series), model = modelOf(series), key = brand + '|' + model, tok = tokens(series);
    const body = q.body ? normBody(q.body) : '', trans = q.trans ? normTrans(q.trans) : '', cond = q.cond ? normCond(q.cond) : '';
    const product = up(q.product), year = Number(q.year), km = Number(q.km) > 0 ? Number(q.km) : null;
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
    };
  }

  // Lists for the form: brands, models by brand, years, etc.
  function options(m) {
    const count = (f) => { const c = {}; m.units.forEach((u) => { const k = f(u); if (k) c[k] = (c[k] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a]); };
    const seriesBy = {};
    m.units.forEach((u) => { (seriesBy[u.brandN] = seriesBy[u.brandN] || {})[u.seriesN] = 1; });
    Object.keys(seriesBy).forEach((b) => { seriesBy[b] = Object.keys(seriesBy[b]).sort(); });
    return { brands: count((u) => u.brandN).sort(), products: count((u) => u.productN), bodies: count((u) => u.bodyN), trans: count((u) => u.transN), seriesBy };
  }

  const api = { unpack, prepare, estimate, options, normBody, normTrans, normCond, modelOf, B62 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FMV = api;
})(typeof window !== 'undefined' ? window : this);
