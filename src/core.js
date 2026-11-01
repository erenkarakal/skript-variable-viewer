/* core.js — small helpers, the shared state, and the status bar messages.
   Loaded first. Defines window.SV and SV.state; the other UI files read state from there. */

window.SV = window.SV || {};

(function (SV) {
  'use strict';

  /** Shorthand for document.getElementById. */
  SV.byId = (id) => document.getElementById(id);

  /** Creates an element with a class and optional text. */
  SV.create = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  };

  /** 12345 -> "12,345". */
  SV.fmtNum = (n) => (typeof n === 'number' && isFinite(n)) ? n.toLocaleString() : String(n == null ? '' : n);

  /** 1536 -> "1.5 KB". */
  SV.fmtBytes = (n) => {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };

  /** Squeezes all whitespace in a string onto single spaces. */
  SV.oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /** How many rows the list asks the worker for at a time. */
  SV.PAGE_SIZE = 120;

  /** How many pages the list keeps before dropping the farthest ones. */
  SV.MAX_PAGES = 40;

  /* Everything the page remembers while a file is open. */
  SV.state = {
    worker: null,          // the background worker
    workerUrl: null,       // blob URL of the worker source
    currentMeta: null,     // { fileName, fileSize, skriptVersion }
    currentStats: null,    // { live, issues, ms, shown }
    currentTypes: [],      // [{ type, count, bytes }]
    issueRows: [],         // parse problems from the worker
    scanErrors: [],        // decode warnings from "Scan all values"
    scanned: false,        // has the file been scanned yet
    scanInfo: null,        // { scanned, ok, warn } after a scan
    viewTotal: 0,          // how many rows the current filter matches
    selected: -1,          // index of the selected row in the view
    activeView: 'variables',
    pageCache: new Map(),  // page number -> rows already fetched
    pendingPages: new Map(), // request id -> page number being fetched
    inflight: new Set(),   // page numbers already requested
    reqSeq: 1,             // id used for worker requests
    pendingDetail: 0,      // id of the detail request we are waiting for
    pendingSelect: -1,     // row to select when its page arrives
    filterTimer: 0,        // debounce timer for filtering
    rafPending: false,     // a scroll render is already queued
    toastTimer: 0,         // hides the toast
    rowHeight: 44,         // row height read from CSS
    renderDirty: true,     // the list needs a full re-render
    renderedFirst: -1,     // first row currently in the list
    renderedLast: -1,      // last row currently in the list
    currentHex: null       // { pre, hex, fallback } for the hex dump
  };

  /** Writes the line in the bottom status bar. */
  SV.setStatus = (text) => {
    SV.byId('statusText').textContent = text;
  };

  /** Shows a short message above the status bar for a few seconds. */
  SV.showToast = (msg, kind) => {
    const t = SV.byId('toast');
    t.textContent = msg;
    t.className = 'toast' + (kind === 'error' ? ' error' : '');
    clearTimeout(SV.state.toastTimer);
    SV.state.toastTimer = setTimeout(() => t.classList.add('hidden'), 4200);
  };

  /** Shows or hides the bottom progress bar. */
  SV.setProgress = (show, done, total, label) => {
    const wrap = SV.byId('progressWrap');
    if (!show) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
    wrap.querySelector('.bar').style.width = pct + '%';
    wrap.querySelector('.pct').textContent = pct + '%';
    if (label) SV.setStatus(label);
  };

  /** Reads the row height from CSS; it is taller on phones. */
  SV.measureRowHeight = () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'));
    return Number.isFinite(v) && v > 0 ? v : 44;
  };
})(window.SV);
