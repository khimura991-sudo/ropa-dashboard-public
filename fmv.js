/* ROPA FMV generator (the FMV menu of index.html): loads the sold-units history from fmv-data.xlsx (or parts 3-4 of the published
 * Google Sheet) and runs the estimate in the browser (fmv-engine.js). Individual past sales are never listed. */
(function () {
  'use strict';
  const C = window.ROPA_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = (m) => MON[m % 12] + ' ' + (2000 + Math.floor(m / 12));
  const peso = (v) => '₱' + Math.round(v).toLocaleString('en-PH');
  const pctTxt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(1).replace('.0', '') + '%';
  let model = null;

  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Sales history: fmv-data.xlsx next to this page (first sheet, one row per sold unit, column names in row 1).
  // Falls back to parts 3-4 of the published Google Sheet if there is no Excel file.
  const COLS = {
    brand: ['BRAND'], series: ['SERIES', 'MODEL', 'MODEL / SERIES'], product: ['PRODUCT TYPE', 'PRODUCT'], body: ['BODY TYPE', 'BODY'],
    trans: ['TRANSMISSION/FUEL', 'TRANSMISSION', 'TRANSMISSION / FUEL'], cond: ['CONDITION CLASS (DASH)', 'CONDITION', "CLASSIFICATION OF UNIT'S CONDITION"],
    year: ['YEAR MODEL', 'YEAR'], km: ['MILEAGE', 'KM'], price: ['SOLD AMOUNT', 'SOLD PRICE', 'PRICE'], date: ['DATE SOLD', 'SOLD DATE', 'DATE'],
  };
  const dayOf = (v) => (window.DASH ? window.DASH.dayOf(v) : null);
  const numOf = (v) => (typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0);
  function monthOf(v) {
    if (v instanceof Date && !isNaN(v)) return (v.getFullYear() - 2000) * 12 + v.getMonth();
    if (typeof v === 'number' && v > 20000) { const d = new Date(Math.round((v - 25569) * 86400000)); return (d.getUTCFullYear() - 2000) * 12 + d.getUTCMonth(); }
    const s = String(v == null ? '' : v), m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/), iso = s.match(/(\d{4})-(\d{2})/);
    if (m) return (Number(m[3]) - 2000) * 12 + Number(m[1]) - 1;
    if (iso) return (Number(iso[1]) - 2000) * 12 + Number(iso[2]) - 1;
    return null;
  }
  function fromSheet(rows) {
    const head = (rows[0] || []).map((h) => String(h == null ? '' : h).replace(/\s+/g, ' ').trim().toUpperCase());
    const at = {};
    Object.keys(COLS).forEach((k) => { at[k] = COLS[k].map((n) => head.indexOf(n)).find((i) => i >= 0); });
    const missing = ['brand', 'series', 'year', 'price'].filter((k) => at[k] === undefined);
    if (missing.length) throw new Error('fmv-data.xlsx is missing these columns in row 1: ' + missing.map((k) => COLS[k][0]).join(', ') + '.');
    const get = (r, k) => (at[k] === undefined ? '' : r[at[k]]);
    const units = [];
    // Every row's DATE SOLD, cleaned or not, for the dashboard's sold-per-day calendar
    units.allDays = rows.slice(1).map((r) => dayOf(get(r, 'date'))).filter(Boolean);
    let latest = 0;
    rows.slice(1).forEach((r) => {
      const price = numOf(get(r, 'price')), year = Math.round(numOf(get(r, 'year')));
      if (!(price > 0) || year < 1980 || !String(get(r, 'brand') || '').trim()) return;
      const month = monthOf(get(r, 'date'));
      if (month != null) latest = Math.max(latest, month);
      units.push({ brand: get(r, 'brand'), series: get(r, 'series'), product: get(r, 'product'), body: get(r, 'body'), trans: get(r, 'trans'),
        cond: get(r, 'cond'), year, km: numOf(get(r, 'km')) || null, price, month, day: dayOf(get(r, 'date')) });
    });
    units.forEach((u) => { if (u.month == null) u.month = latest; });
    if (!units.length) throw new Error('fmv-data.xlsx has no sold units with a sold amount, brand and year model.');
    return units;
  }

  async function loadFmv() {
    const file = C.fmvFile || 'fmv-data.xlsx';
    const r = await fetch(file + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok && window.XLSX) {
      const wb = XLSX.read(await r.arrayBuffer(), { type: 'array', cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      const units = fromSheet(rows);
      return { units, days: units.allDays, asOf: r.headers.get('last-modified') };
    }
    const useSheet = C.sheetCsvUrl && !/PASTE-/.test(C.sheetCsvUrl);
    if (!useSheet) throw new Error('No sales history found: upload fmv-data.xlsx next to index.html.');
    const g = await fetch(C.sheetCsvUrl + (C.sheetCsvUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!g.ok) throw new Error('No sales history found: upload fmv-data.xlsx next to index.html.');
    const rows = parseCsv(await g.text());
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const pi = head.indexOf('part'), di = head.indexOf('data');
    const parts = rows.slice(1).filter((x) => Number(x[pi]) >= 3 && x[di]).sort((a, b) => Number(a[pi]) - Number(b[pi])).map((x) => x[di]);
    if (!parts.length) throw new Error('No sales history found: upload fmv-data.xlsx next to index.html.');
    let acc = '';
    for (const p of parts) { acc += p; try { const f = JSON.parse(acc); return { units: FMV.unpack(f), asOf: f.generated_at }; } catch (e) { /* keep joining */ } }
    throw new Error('The sales history in the Google Sheet is incomplete. Reload in a minute.');
  }

  function fillSelect(sel, values, keepFirst) {
    const first = keepFirst ? sel.options[0] : null;
    sel.replaceChildren(...(first ? [first] : []), ...values.map((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; return o; }));
  }
  const title = (s) => (/^(BYD|GAC|JAC|JMC|MG|DFSK|BMW|MAN)$/.test(s) ? s : s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));

  function setupForm(opt) {
    fillSelect($('f-brand'), opt.brands, true);
    [...$('f-brand').options].slice(1).forEach((o) => { o.textContent = title(o.value); });
    fillSelect($('f-product'), opt.products, true);
    [...$('f-product').options].slice(1).forEach((o) => { o.textContent = title(o.value); });
    fillSelect($('f-body'), opt.bodies.filter((b) => b !== 'Other'), true);
    fillSelect($('f-trans'), opt.trans.filter((t) => t !== 'Other'), true);
    const now = new Date().getFullYear() + 1, years = [];
    for (let y = now; y >= 1990; y--) years.push(String(y));
    fillSelect($('f-year'), years, true);
    const updSeries = () => {
      const list = opt.seriesBy[$('f-brand').value] || [];
      $('series-list').replaceChildren(...list.map((s) => { const o = document.createElement('option'); o.value = s; return o; }));
    };
    $('f-brand').addEventListener('change', updSeries);
    updSeries();
    $('btn-go').disabled = false;
  }

  function show(e, q) {
    $('result-empty').hidden = true; $('result-body').hidden = false;
    $('r-val').textContent = peso(e.fmv);
    $('r-low').textContent = peso(e.low); $('r-high').textContent = peso(e.high);
    // range bar: band spans low..high on a scale of 0.5x..1.5x of the estimate
    const lo = e.fmv * 0.5, hi = e.fmv * 1.5, pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    $('r-band').style.left = pos(e.low) + '%'; $('r-band').style.width = (pos(e.high) - pos(e.low)) + '%';
    $('r-dot').style.left = pos(e.fmv) + '%';
    const conf = $('r-conf');
    conf.textContent = e.confidence + ' confidence';
    conf.className = 'pill ' + (e.confidence === 'High' ? 'good' : e.confidence === 'Medium' ? 'warn' : 'bad');
    const when = e.fromMonth === e.toMonth ? monthName(e.toMonth) : monthName(e.fromMonth) + ' – ' + monthName(e.toMonth);
    $('r-basis').textContent = e.sameModel > 0
      ? `Based on ${e.sameModel} sold ${title(q.brand)} ${title(e.model)} unit${e.sameModel === 1 ? '' : 's'}` + (e.comps > e.sameModel ? ` plus ${e.comps - e.sameModel} similar units` : '') + `, sold ${when}.`
      : `No ${title(q.brand)} ${title(e.model)} has been sold yet, so this uses ${e.comps} similar units (${e.level}), sold ${when}. Treat it as a rough guide.`;
    const c = model.coef, li = [];
    li.push(`Year model: each newer year adds about ${pctTxt(Math.exp(c.year) - 1).replace('+', '')} to the price.`);
    if (q.km) li.push(`Mileage: ${Number(q.km).toLocaleString('en-PH')} km was compared with each sold unit's mileage.`); else li.push('Mileage not given: sold units are taken as they were.');
    if (q.cond) li.push(`Condition: moderate issues ${pctTxt(Math.exp(c.moderate) - 1)}, major issues ${pctTxt(Math.exp(c.major) - 1)} compared with minor issues.`); else li.push('Condition not given: estimate assumes a typical mix of conditions.');
    $('r-adj').replaceChildren(...li.map((t) => { const x = document.createElement('li'); x.textContent = t; return x; }));
  }

  // Comparable sold units table: 5 closest, "Show 5 more" for up to 10
  let shown = 5, lastTop = [];
  const matchLabel = (t) => (t === 'same brand and model' ? 'Same model' : t === 'same brand and body type' ? 'Same brand & body' : 'Same body type');
  function renderComps() {
    const tb = document.querySelector('#comps-table tbody');
    const td = (txt, cls) => { const c = document.createElement('td'); c.textContent = txt; if (cls) c.className = cls; return c; };
    tb.replaceChildren(...lastTop.slice(0, shown).map((u, i) => {
      const tr = document.createElement('tr');
      const unit = document.createElement('td');
      const nm = document.createElement('div'); nm.className = 'cu'; nm.textContent = title(u.brand) + ' ' + (u.series || title(u.model) || '');
      const tag = document.createElement('div'); tag.className = 'ct'; tag.textContent = matchLabel(u.match);
      unit.append(nm, tag);
      tr.append(td(String(i + 1), 'muted'), unit, td(String(u.year)), td(u.body === 'Not specified' ? '—' : u.body), td(u.trans === 'Not specified' ? '—' : u.trans),
        td(u.km ? u.km.toLocaleString('en-PH') + ' km' : '—'), td(u.cond === 'Not specified' ? '—' : u.cond.replace(' issues', '')),
        td(monthName(u.month)), td(peso(u.price), 'num'), td(peso(Math.round(u.adjusted / 1000) * 1000), 'num strong'));
      return tr;
    }));
    const more = $('btn-more');
    more.hidden = lastTop.length <= 5;
    more.textContent = shown > 5 ? 'Show fewer' : `Show ${Math.min(5, lastTop.length - 5)} more`;
  }
  $('btn-more').addEventListener('click', () => { shown = shown > 5 ? 5 : 10; renderComps(); });
  function showComps(e) {
    lastTop = e.top || []; shown = 5;
    $('comps-wrap').hidden = !lastTop.length; $('comps-foot').hidden = !lastTop.length;
    $('comps-note').textContent = lastTop.length ? `The ${Math.min(5, lastTop.length)} closest of the ${e.comps} sold units this estimate used.` : 'No comparable sold units found.';
    renderComps();
  }

  $('fmv-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = { brand: $('f-brand').value, series: $('f-series').value.trim(), year: $('f-year').value, product: $('f-product').value,
      body: $('f-body').value, trans: $('f-trans').value, km: $('f-km').value, cond: $('f-cond').value };
    const err = $('form-err');
    if (!q.brand || !q.series || !q.year) { err.textContent = 'Please fill in the brand, model / series and year model.'; err.hidden = false; return; }
    err.hidden = true;
    const e = FMV.estimate(model, q);
    if (!e) { err.textContent = 'There are no similar sold units to compare with yet. Try adding the body type.'; err.hidden = false; return; }
    show(e, q);
    showComps(e);
    if (window.matchMedia('(max-width: 860px)').matches) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('fmv-form').addEventListener('reset', () => { $('result-empty').hidden = false; $('result-body').hidden = true; $('form-err').hidden = true;
    lastTop = []; $('comps-wrap').hidden = true; $('comps-foot').hidden = true; $('btn-more').hidden = true; $('comps-note').textContent = 'Get a fair market value to see the closest sold units it was based on.'; });

  // The dashboard's Sales and Losses menus use the same sales history (sold per day, brand/series).
  window.ROPA_SALES = loadFmv();
  window.ROPA_SALES.then((f) => {
    model = FMV.prepare(f.units);
    const opt = FMV.options(model);
    setupForm(opt);
    const months = model.units.map((u) => u.month);
    $('fmv-asof').textContent = `${model.units.length.toLocaleString('en-PH')} sold units, ${monthName(Math.min.apply(null, months))} – ${monthName(Math.max.apply(null, months))}` +
      (f.asOf && !isNaN(new Date(f.asOf)) ? ' · File updated ' + new Date(f.asOf).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  }).catch((e) => { const el = $('fmv-err'); el.textContent = e.message; el.hidden = false; $('fmv-asof').textContent = ''; });
})();
