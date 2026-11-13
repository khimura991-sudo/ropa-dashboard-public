/* ROPA Dashboard: calculations for the newer cards (sold per day, brand/series, big losses, inventory KPIs).
 * Works in the browser (window.DASH) and in Node (module.exports) for testing. */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

  // A sold date as 'YYYY-MM-DD'. Excel dates read by SheetJS can land a few seconds before midnight,
  // so 12 hours are added before taking the day (the files carry dates only, no times).
  function dayOf(v) {
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      const t = new Date(v.getTime() + 12 * 3600e3);
      return iso(t.getFullYear(), t.getMonth(), t.getDate());
    }
    if (typeof v === 'number' && v > 20000) {
      const t = new Date(Math.round((v - 25569) * 864e5));
      return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    }
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return iso(+m[3], +m[1] - 1, +m[2]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return iso(+m[1], +m[2] - 1, +m[3]);
    return null;
  }

  // Calendar of one month, Monday to Friday only. Saturday and Sunday sales are added to the Friday before,
  // or to the first workday of the month when that Friday falls in the previous month.
  function workdayCalendar(days, year, month0, today) {
    const last = new Date(year, month0 + 1, 0).getDate();
    const counts = {};
    (days || []).forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    const cells = {};
    let firstWork = null;
    for (let d = 1; d <= last; d++) {
      const wd = new Date(year, month0, d).getDay();
      if (wd >= 1 && wd <= 5) { cells[d] = { date: iso(year, month0, d), d, units: counts[iso(year, month0, d)] || 0, weekend: 0 }; if (firstWork == null) firstWork = d; }
    }
    let weekendUnits = 0;
    for (let d = 1; d <= last; d++) {
      const wd = new Date(year, month0, d).getDay(), n = counts[iso(year, month0, d)] || 0;
      if ((wd === 0 || wd === 6) && n) {
        const fri = d - (wd === 6 ? 1 : 2), to = cells[fri] ? fri : firstWork;
        if (to == null) continue;
        cells[to].units += n; cells[to].weekend += n; weekendUnits += n;
      }
    }
    const weeks = [];
    let week = null;
    for (let d = 1; d <= last; d++) {
      const wd = new Date(year, month0, d).getDay();
      if (wd === 0 || wd === 6) continue;
      if (!week || wd === 1) { week = [null, null, null, null, null]; weeks.push(week); }
      week[wd - 1] = cells[d];
    }
    const inMonth = today && today.getFullYear() === year && today.getMonth() === month0;
    const upTo = inMonth ? today.getDate() : (today && new Date(year, month0, 1) > today ? 0 : last);
    const workdaysSoFar = Object.keys(cells).filter((d) => +d <= upTo).length;
    const total = Object.values(cells).reduce((t, c) => t + c.units, 0);
    return { weeks, total, workdaysSoFar, average: workdaysSoFar ? total / workdaysSoFar : 0, weekendUnits };
  }

  // Most sold brand + model in a month (from the sales file), most units first.
  function topBrandModels(units, year, month0, fmv, n) {
    const pre = iso(year, month0, 1).slice(0, 8), g = new Map();
    (units || []).forEach((u) => {
      if (!u.day || u.day.slice(0, 8) !== pre) return;
      const name = (fmv.cleanBrand(u.brand) + ' ' + (fmv.modelOf(u.series, u.brand) || fmv.cleanSeries(u.series, u.brand))).trim();
      const r = g.get(name) || { name, units: 0, amount: 0 };
      r.units += 1; r.amount += Number(u.price) || 0; g.set(name, r);
    });
    return Array.from(g.values()).sort((a, b) => b.units - a.units || b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, n || 10);
  }

  // Units of the month that lost at least `min` (default 300K), biggest loss first, at most 10.
  function bigLosses(top, month, min) {
    const lim = min == null ? 300000 : min;
    return (top || []).filter((r) => r.month === month && r.gain <= -lim).sort((a, b) => a.gain - b.gain).slice(0, 10);
  }

  // Inventory KPIs from month-end rows by status. Sold and redeemed are outflows, not units on hand.
  function invKpis(rows) {
    if (!rows || !rows.length) return null;
    const sum = (f) => rows.filter(f).reduce((t, r) => t + (r.units || 0), 0);
    return {
      onHand: sum((r) => !/^(SOLD|REDEEMED)$/.test(r.status)),
      underLegal: sum((r) => /LEGAL/.test(r.status)),
      forSale: sum((r) => /FOR SALE/.test(r.status)),
    };
  }

  const api = { dayOf, workdayCalendar, topBrandModels, bigLosses, invKpis };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DASH = api;
})(this);
