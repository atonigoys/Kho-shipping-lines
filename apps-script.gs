/**
 * Brand Performance Dashboard — Sheets → JSON Web App
 *
 * Reads a single monthly tab with columns:
 *   Week | Brand | Platform | Spend | Revenue | # Clicks | ROAS | % WoW Revenue % | CPC
 *
 * Aggregates everything the dashboard needs:
 *   - weeklyDetail:  latest week's Brand × Platform rows
 *   - mtd:           per-brand totals across the whole month
 *   - revenueTrend:  per-week aggregates (one row per week)
 *   - dailySpend:    same week aggregates, displayed as bars on the spending chart
 *   - meta:          headline numbers (margin, win rate, KPI WoW deltas)
 *
 * SETUP:
 *   - Update SHEET_NAME below when you add a new month tab (e.g. 'May 2026').
 *   - Save (Ctrl+S), then Deploy → Manage deployments → edit → New version → Deploy.
 *     The Web app URL stays the same.
 */

const SPREADSHEET_ID = '19EmpiQ6QrR3FYT5FlnmEns-bWilZCk9ffqgRoJVLg7g';
// Leave SHEET_NAME blank to auto-pick the latest "MMM YYYY" tab (e.g. "April 2026", "May 2026").
// Set to a specific name to override.
const SHEET_NAME     = '';

// Normalize brand spelling variants → canonical name used by dashboard pill colors
const BRAND_ALIAS = {
  'Hemp Bombs':    'HempBombs',
  'HempBombs':     'HempBombs',
  'Green Roads':   'Greenroads',
  'Greenroads':    'Greenroads',
  'Cannabis Life': 'Cannabis Life',
  'Mystic Labs':   'Mystic Labs'
};

function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : pickLatestMonthSheet(ss);
    if (!sh) throw new Error('No matching sheet tab found' + (SHEET_NAME ? ': ' + SHEET_NAME : ' (looking for "MMM YYYY" pattern)'));
    const rows = readAllTables(sh, sh.getName());
    const payload = buildPayload(rows);
    payload.meta.source_tab = sh.getName();
    return json(payload);
  } catch (err) {
    return json({ error: err.message, stack: err.stack });
  }
}

function pickLatestMonthSheet(ss) {
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
                   january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
  let best = null, bestKey = -1;
  ss.getSheets().forEach(sh => {
    const m = sh.getName().trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return;
    const mIdx = months[m[1].toLowerCase()];
    if (mIdx === undefined) return;
    const key = parseInt(m[2], 10) * 12 + mIdx;
    if (key > bestKey) { bestKey = key; best = sh; }
  });
  return best;
}

function readRows(sh) {
  const range   = sh.getDataRange();
  const values  = range.getValues();
  const display = range.getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h).trim());
  const idx = {
    week:     find(headers, /^week$/i),
    brand:    find(headers, /^brand$/i),
    platform: find(headers, /^platform$/i),
    spend:    find(headers, /^spend$/i),
    revenue:  find(headers, /^revenue$/i),
    clicks:   find(headers, /clicks/i),
    wow:      find(headers, /wow.*revenue|revenue.*wow|%\s*wow/i)
  };

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const brandRaw = row[idx.brand];
    if (!brandRaw) continue;
    out.push({
      week:     String(row[idx.week] || '').trim(),
      brand:    normalizeBrand(brandRaw),
      platform: String(row[idx.platform] || '').trim(),
      spend:    toNum(row[idx.spend]),
      revenue:  toNum(row[idx.revenue]),
      clicks:   toNum(row[idx.clicks]),
      // WoW column may be percent-formatted (-0.1825) or text ("-18.25%") — parse from display string
      wow:      parsePct(display[i][idx.wow])
    });
  }
  return out;
}

function buildPayload(rows) {
  if (rows.length === 0) {
    return empty();
  }

  // Discover unique weeks in order of first appearance
  const weekOrder = [];
  const seen = new Set();
  rows.forEach(r => {
    if (r.week && !seen.has(r.week)) { seen.add(r.week); weekOrder.push(r.week); }
  });
  const latestWeek = weekOrder[weekOrder.length - 1];

  // Latest-week rows: Brand × Platform breakdown
  const weeklyDetail = rows
    .filter(r => r.week === latestWeek)
    .map(r => ({
      brand:       r.brand,
      platform:    r.platform,
      spend:       r.spend,
      revenue:     r.revenue,
      clicks:      r.clicks,
      wow_rev_pct: r.wow,
      note:        ''
    }));

  // MTD per brand: sum across all rows in the tab
  const mtdBy = {};
  rows.forEach(r => {
    if (!mtdBy[r.brand]) mtdBy[r.brand] = { brand: r.brand, mtd_spend: 0, mtd_revenue: 0, mtd_clicks: 0 };
    mtdBy[r.brand].mtd_spend   += r.spend   || 0;
    mtdBy[r.brand].mtd_revenue += r.revenue || 0;
    mtdBy[r.brand].mtd_clicks  += r.clicks  || 0;
  });
  const mtd = Object.values(mtdBy);

  // Per-week aggregates for the trend chart and sparklines
  const trendBy = {};
  rows.forEach(r => {
    if (!trendBy[r.week]) trendBy[r.week] = { week_label: shortWeek(r.week), revenue: 0, spend: 0, clicks: 0 };
    trendBy[r.week].revenue += r.revenue || 0;
    trendBy[r.week].spend   += r.spend   || 0;
    trendBy[r.week].clicks  += r.clicks  || 0;
  });
  const revenueTrend = weekOrder.map(w => {
    const t = trendBy[w];
    return Object.assign({}, t, { roas: t.spend ? t.revenue / t.spend : 0 });
  });

  // dailySpend: one bar per week (data is weekly granularity)
  const dailySpend = revenueTrend.map(t => ({ date: t.week_label, spend: t.spend }));

  // Totals across the whole month
  const totals = rows.reduce((a, r) => ({
    spend:   a.spend   + (r.spend   || 0),
    revenue: a.revenue + (r.revenue || 0),
    clicks:  a.clicks  + (r.clicks  || 0)
  }), { spend: 0, revenue: 0, clicks: 0 });

  // Win rate from latest week's platforms
  const wkRows = weeklyDetail.filter(r => (r.spend || 0) > 0);
  let prof = 0, brk = 0, loss = 0;
  wkRows.forEach(r => {
    if (!r.revenue || r.revenue === 0 || r.spend === 0) { loss++; return; }
    const ro = r.revenue / r.spend;
    if (ro >= 1.5)      prof++;
    else if (ro >= 0.95) brk++;
    else                 loss++;
  });
  const winRate = wkRows.length ? Math.round((prof / wkRows.length) * 100) : 0;

  // WoW deltas: latest week vs prior week, summed across brands
  const last  = revenueTrend[revenueTrend.length - 1] || { revenue: 0, spend: 0, clicks: 0, roas: 0 };
  const prior = revenueTrend[revenueTrend.length - 2] || { revenue: 0, spend: 0, clicks: 0, roas: 0 };
  const wow = (curr, prev) => prev ? ((curr - prev) / prev) * 100 : 0;

  const margin = totals.revenue ? Math.round(((totals.revenue - totals.spend) / totals.revenue) * 100) : 0;

  const meta = {
    period_label:         'Week of ' + shortWeek(latestWeek),
    week_range:           latestWeek,
    margin_pct:           margin,
    win_rate_pct:         winRate,
    platforms_profitable: prof,
    platforms_breakeven:  brk,
    platforms_loss:       loss,
    mtd_revenue:          totals.revenue,
    mtd_revenue_wow_pct:  wow(last.revenue, prior.revenue),
    mtd_spend:            totals.spend,
    mtd_spend_wow_pct:    wow(last.spend,   prior.spend),
    blended_roas:         totals.spend ? totals.revenue / totals.spend : 0,
    roas_wow_pct:         wow(last.roas,    prior.roas),
    total_clicks:         totals.clicks,
    clicks_wow_pct:       wow(last.clicks,  prior.clicks)
  };

  // Every row, with week_label normalized to match revenueTrend (e.g. "Apr 26").
  // Used by the dashboard's week selector to filter detail/alerts/leaderboard on the fly.
  const allRows = rows.map(r => ({
    week_label: shortWeek(r.week),
    week_full:  r.week,
    brand:      r.brand,
    platform:   r.platform,
    spend:      r.spend,
    revenue:    r.revenue,
    clicks:     r.clicks,
    wow_rev_pct: r.wow,
    note:       ''
  }));

  return {
    weeklyDetail, mtd, dailySpend, revenueTrend, meta, allRows,
    generatedAt: new Date().toISOString()
  };
}

function find(headers, pattern) {
  for (let i = 0; i < headers.length; i++) if (pattern.test(headers[i])) return i;
  return -1;
}

function normalizeBrand(name) {
  const k = String(name).trim();
  return BRAND_ALIAS[k] || k;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[$,%x\s]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

// Parse a percent value from the displayed string ("-18.25%" → -18.25, "0.34%" → 0.34)
function parsePct(s) {
  if (s === null || s === undefined || s === '') return null;
  const cleaned = String(s).replace(/[%\s,]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

// "Apr 26-May 2, 2026" → "Apr 26"
function shortWeek(w) {
  const m = String(w).match(/^([A-Za-z]+\s*\d+)/);
  return m ? m[1] : String(w);
}

function empty() {
  return { weeklyDetail: [], mtd: [], dailySpend: [], revenueTrend: [], meta: {}, generatedAt: new Date().toISOString() };
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
