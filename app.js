/* ROPA Dashboard (public version) — no sign-in; reads the published Google Sheet (or data.json) exported from ROPA MONITORING.xlsx. */
(function () {
  'use strict';
  const C = window.ROPA_CONFIG;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MS = MONTHS.map((m) => m.slice(0, 3));
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---------------------------------------------------------------- data
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function loadData() {
    const useSheet = C.sheetCsvUrl && !/PASTE-/.test(C.sheetCsvUrl);
    let d;
    if (useSheet) {
      const url = C.sheetCsvUrl + (C.sheetCsvUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('The published Google Sheet could not be read (' + r.status + '). Check it is still published to the web.');
      const rows = parseCsv(await r.text());
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const pi = head.indexOf('part'), di = head.indexOf('data');
      if (pi < 0 || di < 0) throw new Error('The Google Sheet needs a "part" column and a "data" column in row 1.');
      const parts = rows.slice(1).filter((r) => r[pi] && r[di]).sort((x, y) => Number(x[pi]) - Number(y[pi])).map((r) => r[di]);
      if (!parts.length) throw new Error('The Google Sheet has no data yet. Run the Power Automate flow once.');
      // Join parts until the text is complete JSON; leftover rows from an older, longer export are ignored.
      let acc = '';
      for (const part of parts) { acc += part; try { d = JSON.parse(acc); break; } catch (e) { /* keep joining */ } }
      if (!d) throw new Error('The data in the Google Sheet is incomplete (the flow may still be writing). Try Refresh in a minute.');
    } else {
      const r = await fetch((C.dataFile || 'data.json') + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error((C.dataFile || 'data.json') + ' is missing next to index.html.');
      d = await r.json();
    }
    if (d.v === 2) expandCompact(d);
    d.sold.forEach((s) => { s.non_starter = !!s.non_starter; });
    buildInvHist(d);
    return d;
  }

  // Month-end inventory by status: month name -> [{ status, units, opb }].
  // From the export's history (INVTY HISTORY sheet + DAILY TOTAL INVTY), or, for older exports, from DAILY TOTAL INVTY alone.
  function buildInvHist(d) {
    const H = {};
    const name = (m) => MONTHS.find((x) => x.toLowerCase() === String(m || '').trim().toLowerCase());
    if (d.ih && d.S) {
      d.ih.forEach((x) => { const k = MONTHS[x[0]]; (H[k] = H[k] || []).push({ status: d.S[x[1]], units: x[2], opb: x[3] }); });
    } else if (d.inventory) {
      const inv = d.inventory, rows = inv.rows.filter((r) => r.status !== 'GRAND TOTAL');
      if (name(inv.prev)) H[name(inv.prev)] = rows.map((r) => ({ status: r.status, units: r.units_prev, opb: r.opb_prev }));
      if (name(inv.cur)) H[name(inv.cur)] = rows.map((r) => ({ status: r.status, units: r.units_cur, opb: r.opb_cur }));
    }
    d.invHist = H;
  }

  // Compact export (v2): totals per month/product/division/condition/non-starter/loss group,
  // associate counts per month, and the 10 biggest losses per month. Rebuilt here into per-unit rows
  // that carry each group's average, so every total and count matches the full export.
  function expandCompact(d) {
    const F = ['opb', 'sold_amount', 'gain', 'storage_fee', 'notarial_fee', 'towing_fee', 'legal_fee', 'commissions', 'repair_fee'];
    const sold = [];
    d.g.forEach((x) => {
      const n = x[6];
      for (let k = 0; k < n; k++) {
        const r = { month: MONTHS[x[0]], product_type: d.P[x[1]], division: d.D[x[2]], condition: d.C[x[3]], non_starter: !!x[4], associate: '' };
        F.forEach((f, j) => { r[f] = x[7 + j] / n; });
        sold.push(r);
      }
    });
    d.sold = sold;
    d.assoc = d.a.map((x) => ({ month: MONTHS[x[0]], name: d.A[x[1]], units: x[2] }));
    d.top = d.t.map((x) => ({ month: MONTHS[x[0]], unit: x[1], product_type: d.P[x[2]], condition: d.C[x[3]], gain: x[4], recovery: x[5] }));
  }

  // ---------------------------------------------------------------- formatting
  const peso = (v) => { if (v == null || isNaN(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '-₱' : '₱';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return s + (a / 1e3).toFixed(2) + 'K'; return s + a.toFixed(2); };
  const pesoFull = (v) => (v == null || isNaN(v) ? '—' : (v < 0 ? '-₱' : '₱') + d3.format(',.0f')(Math.abs(v)));
  const int = (v) => (v == null || isNaN(v) ? '—' : d3.format(',')(v));
  const pct = (v) => (v == null || isNaN(v) ? '—' : d3.format('.1%')(v));
  const recClass = (r) => (r >= C.recoveryTarget ? 'good' : r >= C.recoveryTarget - 0.1 ? 'warn' : 'bad');
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const palette = () => ['--accent', '--accent-2', '--c3', '--c4', '--c5'].map(css);

  // ---------------------------------------------------------------- charts
  function tipBox(box) { let t = box.querySelector('.tip'); if (!t) { t = el('div', 'tip'); t.hidden = true; box.appendChild(t); } return t; }
  function showTip(box, t, lines, x, y) {
    t.replaceChildren(...lines.map((l, i) => el('div', i ? '' : 'h', l))); t.hidden = false;
    t.style.left = Math.max(0, Math.min(box.clientWidth - t.offsetWidth, x + 12)) + 'px';
    t.style.top = Math.max(0, y - t.offsetHeight - 8) + 'px';
  }
  function measure(svg, texts) { const tmp = svg.append('text').style('font-size', '12px'); let w = 0; texts.forEach((s) => { tmp.text(s); w = Math.max(w, tmp.node().getComputedTextLength()); }); tmp.remove(); return w; }
  function svgIn(box, W, H) { d3.select(box).selectAll('svg').remove(); return d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).style('display', 'block').style('font-family', 'var(--body)'); }

  function drawMonthly(box, monthly, field, kind, selIdx) {
    const W = Math.max(280, box.clientWidth), H = 240, svg = svgIn(box, W, H), acc = css('--accent');
    const v25 = (d) => d[field + '_2025'], v26 = (d) => d[field + '_2026'];
    const max = d3.max(monthly, (d) => Math.max(v25(d) || 0, v26(d) || 0)) || 1;
    const y = d3.scaleLinear([0, max * 1.08], [H - 24, 8]).nice();
    const fmt = field === 'sales' ? (v) => (v === 0 ? '0' : '₱' + d3.format('.0f')(v / 1e6) + 'M') : d3.format(',');
    const ticks = y.ticks(5), ml = Math.ceil(measure(svg, ticks.map(fmt))) + 10;
    const x = d3.scaleBand(monthly.map((d) => d.month_num), [ml, W - 6]).padding(kind === 'bar' ? 0.22 : 0.5);
    const cx = (d) => x(d.month_num) + x.bandwidth() / 2, isSel = (d) => d.month_num - 1 === selIdx;
    svg.selectAll('line.g').data(ticks).join('line').attr('x1', ml).attr('x2', W - 6).attr('y1', y).attr('y2', y).attr('stroke', 'var(--grid)');
    svg.selectAll('text.y').data(ticks).join('text').attr('x', ml - 8).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').style('font-size', '12px').attr('fill', 'var(--muted)').text(fmt);
    const every = W < 420 ? 2 : 1;
    svg.selectAll('text.x').data(monthly).join('text').attr('x', cx).attr('y', H - 6).attr('text-anchor', 'middle').style('font-size', '12px')
      .attr('fill', (d) => (isSel(d) ? 'var(--fg)' : 'var(--muted)')).style('font-weight', (d) => (isSel(d) ? 600 : 400))
      .text((d, i) => (isSel(d) || (i % every === 0 && (every === 1 || Math.abs(i - selIdx) !== 1)) ? MS[d.month_num - 1] : ''));
    if (kind === 'bar') {
      const bw = Math.min(14, x.bandwidth() / 2 - 1);
      svg.selectAll('rect.a').data(monthly.filter((d) => v25(d) != null)).join('rect').attr('x', (d) => cx(d) - bw - 1).attr('width', bw).attr('y', (d) => y(v25(d))).attr('height', (d) => y(0) - y(v25(d))).attr('rx', 3).attr('fill', 'var(--chart-muted)');
      svg.selectAll('rect.b').data(monthly.filter((d) => v26(d) != null)).join('rect').attr('x', (d) => cx(d) + 1).attr('width', bw).attr('y', (d) => y(v26(d))).attr('height', (d) => y(0) - y(v26(d))).attr('rx', 3).attr('fill', acc).attr('opacity', (d) => (isSel(d) ? 1 : 0.55));
    } else {
      const line = (fn) => d3.line().defined((d) => fn(d) != null).x(cx).y((d) => y(fn(d)));
      svg.append('path').datum(monthly).attr('d', line(v25)).attr('fill', 'none').attr('stroke', 'var(--chart-muted)').attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      svg.append('path').datum(monthly).attr('d', line(v26)).attr('fill', 'none').attr('stroke', acc).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      svg.selectAll('circle').data(monthly.filter((d) => v26(d) != null)).join('circle').attr('cx', cx).attr('cy', (d) => y(v26(d))).attr('r', (d) => (isSel(d) ? 5 : 2.5)).attr('fill', acc).attr('stroke', 'var(--panel)').attr('stroke-width', 1.5);
    }
    const t = tipBox(box), f2 = field === 'sales' ? peso : int;
    svg.on('mousemove', (ev) => { const [mx] = d3.pointer(ev); const i = Math.max(0, Math.min(monthly.length - 1, Math.floor((mx - ml) / ((W - 6 - ml) / monthly.length)))); const d = monthly[i];
      showTip(box, t, [MONTHS[d.month_num - 1], '2025: ' + f2(v25(d)), '2026: ' + f2(v26(d))], mx, y(Math.max(v25(d) || 0, v26(d) || 0))); }).on('mouseleave', () => (t.hidden = true));
  }

  function drawDonut(box, data) {
    const W = Math.max(240, box.clientWidth), H = 220, R = 78, svg = svgIn(box, W, H), P = palette();
    if (!data.length) return;
    const cx = R + 10, cy = H / 2, total = d3.sum(data, (d) => d.units), t = tipBox(box);
    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
    g.selectAll('path').data(d3.pie().sort(null).value((d) => d.units)(data)).join('path').attr('d', d3.arc().innerRadius(R * 0.62).outerRadius(R).padAngle(0.015).cornerRadius(2)).attr('fill', (d, i) => P[i % P.length])
      .on('mousemove', (ev, d) => { const [mx, my] = d3.pointer(ev, box); showTip(box, t, [d.data.name, int(d.data.units) + ' units · ' + pct(d.data.units / total)], mx, my); }).on('mouseleave', () => (t.hidden = true));
    g.append('text').attr('text-anchor', 'middle').attr('dy', '0.1em').attr('fill', 'var(--fg)').style('font-family', 'var(--display)').style('font-size', '28px').text(int(total));
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.9em').attr('fill', 'var(--muted)').style('font-size', '12px').text('units sold');
    const lx = cx + R + 16, avail = W - lx - 4;
    data.forEach((d, i) => {
      const yy = cy - (data.length - 1) * 20 + i * 40;
      svg.append('rect').attr('x', lx).attr('y', yy - 12).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', P[i % P.length]);
      const nm = svg.append('text').attr('x', lx + 16).attr('y', yy - 3).style('font-size', '12px').attr('fill', 'var(--muted)').text(d.name);
      let s = d.name; while (nm.node().getComputedTextLength() > avail - 16 && s.length > 4) { s = s.slice(0, -2); nm.text(s + '…'); }
      svg.append('text').attr('x', lx + 16).attr('y', yy + 13).style('font-size', '12px').style('font-weight', 600).attr('fill', 'var(--fg)').text(int(d.units) + ' · ' + pct(d.units / total));
    });
  }

  function drawAssoc(box, data) {
    const W = Math.max(240, box.clientWidth), rowH = 34, H = Math.max(1, data.length) * rowH + 4, svg = svgIn(box, W, H), acc = css('--accent');
    if (!data.length) return;
    const lw = Math.ceil(measure(svg, data.map((d) => d.name))) + 12, vw = Math.ceil(measure(svg, data.map((d) => int(d.units)))) + 8;
    const x = d3.scaleLinear([0, d3.max(data, (d) => d.units) || 1], [lw, W - vw]);
    data.forEach((d, i) => { const yy = i * rowH + 8;
      svg.append('text').attr('x', lw - 12).attr('y', yy + 9).attr('dy', '0.32em').attr('text-anchor', 'end').style('font-size', '12px').attr('fill', 'var(--fg)').text(d.name);
      svg.append('rect').attr('x', lw).attr('y', yy).attr('width', Math.max(2, x(d.units) - lw)).attr('height', 18).attr('rx', 4).attr('fill', i === 0 ? acc : 'var(--chart-muted)');
      svg.append('text').attr('x', x(d.units) + 6).attr('y', yy + 9).attr('dy', '0.32em').style('font-size', '12px').attr('fill', 'var(--muted)').text(int(d.units)); });
  }

  function fill(id, rows, cells, foot) {
    const tb = document.querySelector(`#${id} tbody`);
    tb.replaceChildren(...rows.map((r) => { const tr = el('tr'); if (r._tot) tr.className = 'tot';
      cells.forEach(([f, c]) => { const td = el('td'); const cls = c ? c(r) : null; if (cls) td.appendChild(el('span', cls, f(r))); else td.textContent = f(r); tr.appendChild(td); }); return tr; }));
    const tf = document.querySelector(`#${id} tfoot`);
    if (tf) { tf.replaceChildren(); if (foot) { const tr = el('tr'); foot.forEach((v) => tr.appendChild(el('td', '', v))); tf.appendChild(tr); } }
  }

  // ---------------------------------------------------------------- render
  let D = null, month = null;
  const tot = (rs) => { const s = d3.sum(rs, (r) => r.sold_amount), g = d3.sum(rs, (r) => r.gain), o = d3.sum(rs, (r) => r.opb); return { u: rs.length, s, g, opb: o, rec: s - g ? s / (s - g) : null }; };
  const chg = (a, b) => (a == null || !b ? null : (a - b) / Math.abs(b));
  const lchg = (a, b) => (a == null || !b ? null : (Math.abs(a) - Math.abs(b)) / Math.abs(b));
  function delta(v, upGood, text) {
    const s = el('span');
    if (v == null || isNaN(v)) { s.textContent = '— ' + text; return s; }
    const flat = Math.abs(v) < 1e-9; s.className = flat ? 'flat' : (v > 0) === upGood ? 'good' : 'bad';
    s.textContent = (flat ? '● ' : v > 0 ? '▲ ' : '▼ ') + d3.format('.1%')(Math.abs(v)) + ' ' + text; return s;
  }
  function kpiCard(label, value, deltas) { const c = el('div', 'card kpi'); c.append(el('div', 'lbl', label), el('div', 'val', value)); const dl = el('div', 'dl'); deltas.forEach((d) => dl.appendChild(d)); c.appendChild(dl); return c; }
  const groupSum = (rs, key) => Array.from(d3.group(rs, (r) => r[key] || 'UNCLASSIFIED'), ([name, xs]) => ({ name, ...tot(xs), xs }));

  function setupMonths() {
    const months = Array.from(new Set(D.sold.map((r) => r.month))).sort((a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b));
    const sel = $('month');
    const keep = month;
    sel.replaceChildren(...months.map((m) => new Option(m, m)));
    month = months.includes(keep) ? keep : months.includes(D.default_month) ? D.default_month : months[months.length - 1];
    sel.value = month || '';
  }

  function render() {
    if (!D || !month) return;
    const byMonth = d3.group(D.sold, (r) => r.month);
    const ovT = (i, y) => { const m = D.monthly.find((x) => x.month_num === i + 1); return m && m['sales_' + y] != null ? { u: m['units_' + y], s: m['sales_' + y], g: m['gain_' + y], rec: m['sales_' + y] / (m['sales_' + y] - m['gain_' + y]) } : null; };
    const rs = byMonth.get(month) || [], i = MONTHS.indexOf(month), pi = (i + 11) % 12;
    const c = tot(rs), p = byMonth.has(MONTHS[pi]) ? tot(byMonth.get(MONTHS[pi])) : ovT(pi, i === 0 ? '2025' : '2026'), ly = ovT(i, '2025');
    const lossUnits = rs.filter((r) => r.gain < 0).length;
    const T = C.recoveryTarget, IT = C.inventoryTarget, lm = 'vs ' + MONTHS[pi];

    $('title').textContent = month + ' sales overview';
    const tk = $('takeaway'); tk.replaceChildren();
    tk.append('Sold ', el('b', '', int(c.u)), ' units for ', el('b', '', peso(c.s)), ' at a recovery rate of ', el('b', '', pct(c.rec)), ` against the ${pct(T).replace('.0', '')} target. `, el('b', '', int(lossUnits)), ' of those units sold at a loss.');

    // Inventory snapshot for the picked month (or the latest one, for months after it), and the month before
    const outflow = (st) => /^(REDEEMED|SOLD)$/.test(st);
    const H = D.invHist || {}, snapMonths = MONTHS.filter((m) => H[m]), latest = snapMonths[snapMonths.length - 1];
    const invTot = (rows) => rows.filter((r) => !outflow(r.status)).reduce((t, r) => ({ u: t.u + (r.units || 0), o: t.o + (r.opb || 0) }), { u: 0, o: 0 });
    const invMonth = H[month] ? month : latest && i > MONTHS.indexOf(latest) ? latest : null;
    const isLater = !!invMonth && invMonth !== month;
    const invPrevMonth = invMonth && MONTHS.indexOf(invMonth) > 0 ? MONTHS[MONTHS.indexOf(invMonth) - 1] : null;
    const invCur = invMonth ? invTot(H[invMonth]) : null, invPrev = invPrevMonth && H[invPrevMonth] ? invTot(H[invPrevMonth]) : null;
    const ptsSpan = (() => { const s = el('span'); const d = c.rec != null && p && p.rec != null ? (c.rec - p.rec) * 100 : null;
      if (d == null) { s.textContent = '— pts ' + lm; return s; } s.className = Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'good' : 'bad'; s.textContent = (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '● ') + Math.abs(d).toFixed(1) + ' pts ' + lm; return s; })();
    $('kpis').replaceChildren(
      kpiCard('Total sales', peso(c.s), [delta(chg(c.s, p && p.s), true, lm), delta(chg(c.s, ly && ly.s), true, 'vs same month 2025')]),
      kpiCard('Total units sold', int(c.u), [delta(chg(c.u, p && p.u), true, lm), delta(chg(c.u, ly && ly.u), true, 'vs same month 2025')]),
      kpiCard('Recovery rate', pct(c.rec), [delta(c.rec == null ? null : (c.rec - T) / T, true, `vs ${pct(T).replace('.0', '')} target`), ptsSpan]),
      kpiCard('Total gain / (loss)', peso(c.g), [delta(lchg(c.g, p && p.g), false, 'loss ' + lm), delta(lchg(c.g, ly && ly.g), false, 'loss vs same month 2025')]),
      kpiCard(isLater ? `Total inventory (${invMonth})` : 'Total inventory', invCur ? int(invCur.u) : '—', !invCur ? [el('span', '', 'No inventory snapshot for this month')] :
        [...(isLater ? [el('span', 'flat', `Latest snapshot: ${invMonth}. ${month} not in the inventory sheets yet`)] : []),
         ...(invPrev ? [delta(chg(invCur.u, invPrev.u), false, 'vs ' + invPrevMonth)] : []), delta((invCur.u - IT) / IT, false, `vs ${IT} target`)]),
    );

    drawMonthly($('line'), D.monthly, 'sales', 'line', i);
    drawMonthly($('bars'), D.monthly, 'units', 'bar', i);

    const recCell = [(r) => pct(r.rec), (r) => 'pill ' + recClass(r.rec)];
    const prod = groupSum(rs, 'product_type').sort((a, b) => b.u - a.u).map((r) => ({ ...r, share: c.g ? r.g / c.g : 0, rec: r.opb ? r.s / r.opb : 0 }));
    fill('top5', prod.slice(0, 5), [[(r) => r.name], [(r) => int(r.u)], [(r) => pesoFull(r.s)], [(r) => pesoFull(r.g)], recCell]);

    drawDonut($('div'), groupSum(rs, 'division').sort((a, b) => b.u - a.u).map((r) => ({ name: r.name, units: r.u })));
    drawDonut($('cond'), groupSum(rs, 'condition').sort((a, b) => b.u - a.u).map((r) => ({ name: r.name, units: r.u })));
    drawAssoc($('assoc'), (D.assoc ? D.assoc.filter((r) => r.month === month && r.name !== 'PINNACLE').map((r) => ({ name: r.name, units: r.units }))
      : groupSum(rs.filter((r) => r.associate && r.associate !== 'PINNACLE'), 'associate').map((r) => ({ name: r.name, units: r.u })))
      .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name)).slice(0, 5));

    $('ns-title').textContent = 'Non-starter accounts per division · ' + month;
    const nsRows = groupSum(rs, 'division').map((r) => ({ name: r.name, ...tot(r.xs.filter((x) => x.non_starter)) })).sort((a, b) => b.u - a.u);
    const nsT = tot(rs.filter((x) => x.non_starter));
    fill('ns', nsRows, [[(r) => r.name], [(r) => int(r.u)], [(r) => pesoFull(r.s)], [(r) => pesoFull(r.g)], [(r) => (r.u ? pct(r.rec) : '-'), (r) => (r.u ? 'pill ' + recClass(r.rec) : null)]],
      ['Total', int(nsT.u), pesoFull(nsT.s), pesoFull(nsT.g), pct(nsT.rec)]);

    $('loss-title').textContent = 'ROPA cause of losses · ' + month;
    $('loss-line').textContent = `Units sold at a loss: ${int(lossUnits)} of ${int(c.u)}. Net loss: ${pesoFull(c.g)}.`;
    const order = { 'MINOR ISSUES': 1, 'MODERATE ISSUES': 2, 'MAJOR ISSUES': 3 };
    const cond = groupSum(rs, 'condition').map((r) => ({ ...r, share: c.g ? r.g / c.g : 0, rec: r.opb ? r.s / r.opb : 0 })).sort((a, b) => (order[a.name] || 9) - (order[b.name] || 9));
    const foot = ['Total', int(c.u), pesoFull(c.g), '100.0%', pct(c.rec)];
    fill('lc', cond, [[(r) => r.name], [(r) => int(r.u)], [(r) => pesoFull(r.g)], [(r) => pct(r.share)], recCell], foot);
    fill('lp', prod, [[(r) => r.name], [(r) => int(r.u)], [(r) => pesoFull(r.g)], [(r) => pct(r.share)], recCell], foot);
    const fees = [['Storage fee', 'storage_fee'], ['Notarial fee', 'notarial_fee'], ['Towing fee', 'towing_fee'], ['Legal fee', 'legal_fee'], ['Commissions', 'commissions'], ['Repair fee', 'repair_fee']];
    const costRows = fees.map(([name, f]) => ({ name, a: d3.sum(rs, (r) => r[f]) })), ct = d3.sum(costRows, (r) => r.a);
    fill('costs', costRows, [[(r) => r.name], [(r) => pesoFull(r.a)], [(r) => pct(c.s ? r.a / c.s : 0)], [(r) => pesoFull(c.u ? r.a / c.u : 0)]], ['Total', pesoFull(ct), pct(c.s ? ct / c.s : 0), pesoFull(c.u ? ct / c.u : 0)]);
    fill('top10', (D.top ? D.top.filter((r) => r.month === month) : rs.slice()).sort((a, b) => a.gain - b.gain).slice(0, 10), [[(r) => r.unit], [(r) => r.product_type], [(r) => r.condition], [(r) => pesoFull(r.gain), () => 'bad'], [(r) => pct(r.recovery), (r) => 'pill ' + recClass(r.recovery)]]);

    // Inventory breakdown: picked month vs the month before
    const pmName = invPrevMonth || 'previous month';
    $('inv-title').textContent = 'Total breakdown inventories · ' + (!invMonth ? month + ' (no snapshot)' : invPrev ? `${invPrevMonth} vs ${invMonth}` : invMonth);
    const ih = el('tr'); ['Status', `Units (${invMonth || month})`, `Units vs ${pmName}`, `OPB (${invMonth || month})`, `OPB vs ${pmName}`].forEach((h) => ih.appendChild(el('th', '', h)));
    document.querySelector('#inv thead').replaceChildren(ih);
    const vs = (a, b, f) => { if (b == null) return '–'; const d = chg(a, b); return (d == null ? '–' : Math.abs(d) < 1e-9 ? '● 0.0%' : (d > 0 ? '▲ ' : '▼ ') + d3.format('.1%')(Math.abs(d))) + '  vs ' + f(b); };
    const vcls = (r, a, b) => { const d = chg(a, b); if (d == null || Math.abs(d) < 1e-9) return 'flat'; return (d > 0) === outflow(r.status) ? 'good' : 'bad'; };
    let invRows = [];
    if (invMonth) {
      const prevRows = invPrev ? H[invPrevMonth] : [];
      const pr = (st) => prevRows.find((r) => r.status === st) || {};
      const all = H[invMonth].filter((r) => !(r.status === 'UNCLASSIFIED' && !r.units && !(pr(r.status).units)))
        .map((r) => ({ status: r.status, units_cur: r.units, opb_cur: r.opb, units_prev: invPrev ? pr(r.status).units ?? null : null, opb_prev: invPrev ? pr(r.status).opb ?? null : null }));
      invRows = [...all.filter((r) => !outflow(r.status)), ...all.filter((r) => outflow(r.status)),
        { status: 'GRAND TOTAL', units_cur: invCur.u, opb_cur: invCur.o, units_prev: invPrev ? invPrev.u : null, opb_prev: invPrev ? invPrev.o : null, _tot: true }];
    }
    fill('inv', invRows, [
      [(r) => r.status], [(r) => int(r.units_cur)],
      [(r) => vs(r.units_cur, r.units_prev, int), (r) => vcls(r, r.units_cur, r.units_prev)],
      [(r) => pesoFull(r.opb_cur)],
      [(r) => vs(r.opb_cur, r.opb_prev, peso), (r) => vcls(r, r.opb_cur, r.opb_prev)],
    ]);
  }

  // ---------------------------------------------------------------- loading + refresh
  let busy = false;
  async function refresh() {
    if (busy) return; busy = true;
    const btn = $('btn-refresh'); btn.disabled = true; btn.textContent = 'Refreshing…';
    try {
      D = await loadData();
      setupMonths(); render();
      $('load-err').hidden = true;
      $('asof').textContent = 'Data as of ' + new Date(D.generated_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      $('load-err').textContent = 'Could not load the latest data. ' + (e && e.message ? e.message : e) + (D ? ' Showing the last numbers loaded.' : '');
      $('load-err').hidden = false;
    } finally { busy = false; btn.disabled = false; btn.textContent = 'Refresh'; $('loading').hidden = true; }
  }

  async function start() {
    $('month').addEventListener('change', (e) => { month = e.target.value; render(); });
    $('btn-refresh').addEventListener('click', refresh);
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);
    $('app').hidden = false;
    await refresh();
    if (C.autoRefreshMinutes > 0) {
      setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, C.autoRefreshMinutes * 60000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    }
  }
  start();
})();
