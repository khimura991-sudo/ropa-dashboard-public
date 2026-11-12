/* ROPA FMV generator page: loads the sold-units history from the published Google Sheet (parts 3 and 4)
 * and runs the estimate in the browser (fmv-engine.js). Individual past sales are never listed. */
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

  async function loadFmv() {
    const useSheet = C.sheetCsvUrl && !/PASTE-/.test(C.sheetCsvUrl);
    if (!useSheet) {
      const r = await fetch((C.fmvFile || 'fmv-data.json') + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('No sales history found. Set the Google Sheet link in config.js.');
      return r.json();
    }
    const url = C.sheetCsvUrl + (C.sheetCsvUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('The published Google Sheet could not be read (' + r.status + ').');
    const rows = parseCsv(await r.text());
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const pi = head.indexOf('part'), di = head.indexOf('data');
    const parts = rows.slice(1).filter((x) => Number(x[pi]) >= 3 && x[di]).sort((a, b) => Number(a[pi]) - Number(b[pi])).map((x) => x[di]);
    if (!parts.length) throw new Error('The sales history for the FMV generator is not in the Google Sheet yet. The Power Automate flow needs the two extra steps for parts 3 and 4.');
    let acc = '';
    for (const p of parts) { acc += p; try { return JSON.parse(acc); } catch (e) { /* keep joining */ } }
    throw new Error('The sales history in the Google Sheet is incomplete (the flow may still be writing). Reload in a minute.');
  }

  function fillSelect(sel, values, keepFirst) {
    const first = keepFirst ? sel.options[0] : null;
    sel.replaceChildren(...(first ? [first] : []), ...values.map((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; return o; }));
  }
  const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

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
    if (window.matchMedia('(max-width: 860px)').matches) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('fmv-form').addEventListener('reset', () => { $('result-empty').hidden = false; $('result-body').hidden = true; $('form-err').hidden = true; });

  loadFmv().then((f) => {
    model = FMV.prepare(FMV.unpack(f));
    const opt = FMV.options(model);
    setupForm(opt);
    const months = model.units.map((u) => u.month);
    $('asof').textContent = `${model.units.length.toLocaleString('en-PH')} sold units, ${monthName(Math.min.apply(null, months))} – ${monthName(Math.max.apply(null, months))}` +
      (f.generated_at ? ' · Data as of ' + new Date(f.generated_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
    const c = model.coef;
    $('how-coef').textContent = `about ${pctTxt(Math.exp(c.year) - 1).replace('+', '')} per newer year model, ${pctTxt(Math.exp(c.moderate) - 1)} for moderate issues, ${pctTxt(Math.exp(c.major) - 1)} for major issues, and a small mileage effect`;
    $('how-acc').textContent = 'Tested on our own past sales: for models we have sold several times, the estimate is typically within about 11% of the actual sold amount, and the likely range contains the actual price about 7 times out of 10.';
  }).catch((e) => { const el = $('load-err'); el.textContent = e.message; el.hidden = false; $('asof').textContent = ''; });
})();
