/* worker.js — parses the CSV, answers queries and decodes values off the main thread.
   The page turns this function into the worker source, so it runs from a blob and also works
   when index.html is opened from disk. It receives the decoder API as `D`.

   Messages in:
     parse  { file }                  read a File and build the variable list
     view   { reqId, start, count }   one page of rows for the list
     detail { reqId, index }          the decoded value of one row
     filter { reqId, opts }           search, type filter and sort
     export { reqId, format }         build a JSON or CSV download
     scan   { reqId }                 decode every value and report warnings

   Messages out:
     progress { phase, ... }          parse, filter or scan progress
     parsed   { meta, stats, types, issues }
     viewInfo { reqId, total, stats, ms }
     viewData { reqId, start, items, total }
     detailData { reqId, detail }
     exportData { reqId, text, filename, mime, total, truncated }
     scanDone { reqId, errors, total, ok, scanned }
     error    { message } */

window.SV_workerFactory = function (D) {
  'use strict';

  /* The file as read, one object per CSV line. */
  let rows = [];
  /* Last line for each variable name: the one Skript keeps. */
  let byName = new Map();
  /* Parse problems: { line, kind, message }. */
  let issues = [];
  let issueCount = 0;
  /* File facts for the top bar and the summary. */
  let meta = { fileName: '', fileSize: 0, skriptVersion: null };
  /* Counts for the summary line. */
  let stats = { live: 0, issues: 0, ms: 0 };
  /* Types and their totals, for the Types view. */
  let types = [];
  /* Row indexes in the current filter and sort order. */
  let view = [];
  /* Current filter settings. */
  let viewOpts = { query: '', typeFilter: '', sortKey: 'name', sortDir: 1, searchValues: false };
  /* Bumped to cancel an outdated filter, scan or parse. */
  let filterToken = 0;
  let scanToken = 0;
  let parseToken = 0;

  /** Sends a message to the page. */
  const send = (m) => self.postMessage(m);
  /** Lets the worker breathe so progress messages can go out. */
  const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

  self.onmessage = (e) => {
    const m = e.data;
    switch (m.type) {
      case 'parse': parseFile(m.file); break;
      case 'view': sendViewPage(m.reqId, m.start, m.count); break;
      case 'detail': sendDetail(m.reqId, m.index); break;
      case 'filter': applyQuery(m.reqId, m.opts); break;
      case 'export': exportRows(m.reqId, m.format); break;
      case 'scan': scanValues(m.reqId); break;
    }
  };

  /** Reads the file in chunks so a large file does not block, then finishes the parse. */
  async function parseFile(file) {
    const token = ++parseToken;
    rows = []; byName = new Map(); issues = []; issueCount = 0; types = []; view = [];
    meta = { fileName: file.name, fileSize: file.size, skriptVersion: null };
    const t0 = performance.now();
    let bytesRead = 0;
    let lineNo = 0;
    let carry = '';
    let lastTick = t0;
    try {
      const reader = file.stream().getReader();
      const dec = new TextDecoder('utf-8');
      for (; ;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (token !== parseToken) return;
        const value = chunk.value;
        bytesRead += value.byteLength;
        carry += dec.decode(value, { stream: true });
        let i = 0;
        let start = 0;
        while (i < carry.length) {
          const c = carry.charCodeAt(i);
          if (c === 10 || c === 13) {
            if (c === 13 && i + 1 >= carry.length) break;
            const line = carry.slice(start, i);
            if (c === 13 && carry.charCodeAt(i + 1) === 10) i++;
            i++; start = i;
            readLine(line, ++lineNo);
          } else i++;
        }
        carry = carry.slice(start);
        const now = performance.now();
        if (now - lastTick > 120) {
          lastTick = now;
          send({ type: 'progress', phase: 'parse', bytes: bytesRead, total: file.size, rows: rows.length });
        }
      }
      carry += dec.decode();
      if (carry.length) readLine(carry, ++lineNo);
    } catch (e) {
      send({ type: 'error', message: 'Failed to read file: ' + (e && e.message ? e.message : e) });
      return;
    }
    if (token !== parseToken) return;
    finishParsing(bytesRead, performance.now() - t0);
  }

  /** Records a parse problem. Only the first 2,000 are kept. */
  function pushIssue(line, kind, message) {
    issueCount++;
    if (issues.length < 2000) issues.push({ line, kind, message });
  }

  /** Reads one CSV line into the row list, or records why it cannot be read. */
  function readLine(raw, lineNo) {
    const line = raw.trim();
    if (!line) return;
    if (line.charAt(0) === '#') {
      if (line.startsWith('# version:')) meta.skriptVersion = line.slice(10).trim();
      return;
    }
    const parts = D.splitCsvLine(line);
    if (!parts || parts.length !== 3) {
      pushIssue(lineNo, 'malformed', 'Expected 3 CSV fields, got ' + (parts ? parts.length : 'invalid syntax'));
      return;
    }
    const name = parts[0];
    const type = parts[1];
    const value = parts[2];
    const nameLower = name.toLowerCase();
    const typeLower = String(type).toLowerCase();
    if (!name) { pushIssue(lineNo, 'malformed', 'Empty variable name'); return; }
    if (type === 'null') {
      rows.push({ name, type: 'null', line: lineNo, kind: 'null', payload: null, hex: '', nameLower, typeLower: 'null' });
      return;
    }
    const payload = D.hexToBytes(value);
    if (!payload) {
      pushIssue(lineNo, 'hex', 'Invalid hexadecimal payload for "' + name + '"');
      rows.push({ name, type, line: lineNo, kind: 'invalid', payload: null, hex: value, nameLower, typeLower });
      return;
    }
    rows.push({ name, type, line: lineNo, kind: 'value', payload, hex: value, nameLower, typeLower });
  }

  /** Counts variables and payload bytes per type. */
  function countTypes() {
    const map = new Map();
    for (const i of byName.values()) {
      const r = rows[i];
      if (r.kind === 'null') continue;
      let entry = map.get(r.type);
      if (!entry) { entry = { type: r.type, count: 0, bytes: 0 }; map.set(r.type, entry); }
      entry.count++;
      entry.bytes += r.payload ? r.payload.length : 0;
    }
    types = [...map.values()].sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  }

  /** Builds the name map, the counts and the first view, then tells the page. */
  function finishParsing(bytesRead, ms) {
    byName = new Map();
    for (let i = 0; i < rows.length; i++) byName.set(rows[i].name, i);
    let live = 0;
    for (const i of byName.values()) if (rows[i].kind !== 'null') live++;
    stats = { live, issues: issueCount, ms: Math.round(ms) };
    countTypes();
    viewOpts = { query: '', typeFilter: '', sortKey: 'name', sortDir: 1, searchValues: false };
    view = [];
    for (const i of byName.values()) if (rows[i].kind !== 'null') view.push(i);
    applySort(view);
    send({ type: 'parsed', meta, stats, types, issues: issues.slice() });
    send({ type: 'viewInfo', total: view.length, stats: { ...stats, shown: view.length } });
  }

  /** One short line describing a row's value, cached on the row. */
  function previewValue(r) {
    if (r._preview !== undefined) return r._preview;
    let text;
    if (r.kind === 'null') text = 'deleted';
    else if (r.kind === 'invalid') text = 'invalid payload';
    else {
      try {
        const decoded = D.decodeRoot(r.type, r.payload);
        text = decoded.summary || '';
        if (!decoded.exact) text += ' (inexact)';
      } catch (e) {
        text = 'Decode error: ' + (e && e.message ? e.message : e);
      }
    }
    text = D.oneLine(text);
    if (text.length > 180) text = text.slice(0, 177) + '…';
    r._preview = text;
    return text;
  }

  /** Plain string comparison. */
  function compareStrings(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** Sorts row indexes in place according to the current sort settings. */
  function applySort(list) {
    const dir = viewOpts.sortDir < 0 ? -1 : 1;
    const key = viewOpts.sortKey;
    if (key === 'line') list.sort((a, b) => (rows[a].line - rows[b].line) * dir);
    else if (key === 'size') {
      list.sort((a, b) => (((rows[a].payload ? rows[a].payload.length : 0) - (rows[b].payload ? rows[b].payload.length : 0)) * dir)
        || compareStrings(rows[a].nameLower, rows[b].nameLower));
    } else if (key === 'type') {
      list.sort((a, b) => ((compareStrings(rows[a].typeLower, rows[b].typeLower) || compareStrings(rows[a].nameLower, rows[b].nameLower)) * dir));
    } else {
      list.sort((a, b) => ((compareStrings(rows[a].nameLower, rows[b].nameLower) || (rows[a].line - rows[b].line)) * dir));
    }
  }

  /** Answers with one page of the current view. */
  function sendViewPage(reqId, start, count) {
    const items = [];
    const end = Math.min(view.length, start + count);
    for (let k = start; k < end; k++) {
      const idx = view[k];
      const r = rows[idx];
      items.push({
        idx,
        name: r.name,
        type: r.type,
        line: r.line,
        size: r.payload ? r.payload.length : 0,
        preview: r.kind === 'null' ? 'deleted' : previewValue(r)
      });
    }
    send({ type: 'viewData', reqId, start, items, total: view.length });
  }

  /** Applies search, type and sort, then answers with the new total. */
  async function applyQuery(reqId, opts) {
    viewOpts = Object.assign({}, viewOpts, opts || {});
    const token = ++filterToken;
    const t0 = performance.now();
    const q = String(viewOpts.query || '').trim().toLowerCase();
    let candidates = [];
    for (const i of byName.values()) if (rows[i].kind !== 'null') candidates.push(i);
    if (q) {
      if (viewOpts.searchValues) {
        const out = [];
        for (let k = 0; k < candidates.length; k++) {
          if (token !== filterToken) return;
          const r = rows[candidates[k]];
          if (r.nameLower.includes(q) || r.typeLower.includes(q) || previewValue(r).toLowerCase().includes(q)) out.push(candidates[k]);
          if ((k & 2047) === 0) {
            send({ type: 'progress', phase: 'filter', done: k, total: candidates.length });
            await yieldToUi();
          }
        }
        candidates = out;
      } else {
        const out = [];
        for (let k = 0; k < candidates.length; k++) {
          const r = rows[candidates[k]];
          if (r.nameLower.includes(q) || r.typeLower.includes(q)) out.push(candidates[k]);
        }
        candidates = out;
      }
    }
    if (token !== filterToken) return;
    if (viewOpts.typeFilter) candidates = candidates.filter((i) => rows[i].type === viewOpts.typeFilter);
    applySort(candidates);
    view = candidates;
    send({ type: 'viewInfo', reqId, total: view.length, stats: { ...stats, shown: view.length }, ms: Math.round(performance.now() - t0) });
  }

  /** Answers with one row's decoded value, its fields and its raw hex. */
  function sendDetail(reqId, idx) {
    const r = rows[idx];
    if (!r) { send({ type: 'detailData', reqId, detail: null }); return; }
    let decoded = null;
    let error = null;
    if (r.kind === 'value') {
      try {
        const d = D.decodeRoot(r.type, r.payload);
        decoded = {
          summary: d.summary,
          fields: d.fields,
          notes: d.notes,
          code: d.code,
          node: D.trimNode(d.node, 0, { nodes: 0 }),
          exact: d.exact,
          error: d.error,
          size: d.size,
          trailing: d.trailing
        };
        error = d.error;
      } catch (e) {
        error = e && e.message ? e.message : String(e);
      }
    } else if (r.kind === 'invalid') {
      error = 'The payload is not valid hexadecimal.';
    }
    send({
      type: 'detailData', reqId, detail: {
        idx,
        name: r.name,
        type: r.type,
        line: r.line,
        size: r.payload ? r.payload.length : (r.hex ? r.hex.length / 2 : 0),
        hex: r.hex || '',
        hexPretty: r.payload ? D.prettyHex(r.payload) : (r.hex ? '(not decoded)' : '(empty payload)'),
        decoded,
        error
      }
    });
  }

  /** Decodes every value and answers with the ones that failed or had extra bytes. */
  async function scanValues(reqId) {
    const token = ++scanToken;
    const list = [];
    for (const i of byName.values()) if (rows[i].kind !== 'null') list.push(i);
    const errors = [];
    let ok = 0;
    for (let k = 0; k < list.length; k++) {
      if (token !== scanToken) return;
      const r = rows[list[k]];
      if (r.kind === 'invalid') {
        errors.push({ line: r.line, name: r.name, type: r.type, message: 'Invalid hexadecimal payload' });
        continue;
      }
      try {
        const d = D.decodeRoot(r.type, r.payload);
        if (d.error) errors.push({ line: r.line, name: r.name, type: r.type, message: d.error });
        else if (!d.exact) errors.push({ line: r.line, name: r.name, type: r.type, message: 'Payload has trailing bytes' });
        else ok++;
      } catch (e) {
        errors.push({ line: r.line, name: r.name, type: r.type, message: e && e.message ? e.message : String(e) });
      }
      if ((k & 511) === 0) {
        send({ type: 'progress', phase: 'scan', done: k, total: list.length });
        await yieldToUi();
      }
    }
    send({ type: 'scanDone', reqId, errors: errors.slice(0, 5000), total: errors.length, ok, scanned: list.length });
  }

  /** Quotes one CSV field when it needs it. */
  function csvField(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Builds a JSON or CSV export of the current view, capped at 50,000 rows. */
  function exportRows(reqId, format) {
    const CAP = 50000;
    const n = Math.min(view.length, CAP);
    const base = String(meta.fileName || 'variables').replace(/\.csv$/i, '');
    if (format === 'json') {
      const arr = [];
      for (let k = 0; k < n; k++) {
        const r = rows[view[k]];
        arr.push({
          name: r.name,
          type: r.type,
          line: r.line,
          value: r.kind === 'null' ? null : previewValue(r),
          hex: r.hex || null
        });
      }
      send({
        type: 'exportData',
        reqId,
        text: JSON.stringify(arr, null, 2),
        filename: base + '-export.json',
        mime: 'application/json',
        truncated: view.length > n,
        total: view.length
      });
    } else {
      const lines = ['name,type,line,value,hex'];
      for (let k = 0; k < n; k++) {
        const r = rows[view[k]];
        lines.push([
          r.name,
          r.type,
          String(r.line),
          r.kind === 'null' ? '' : previewValue(r),
          r.hex || ''
        ].map(csvField).join(','));
      }
      send({
        type: 'exportData',
        reqId,
        text: lines.join('\r\n') + '\r\n',
        filename: base + '-export.csv',
        mime: 'text/csv',
        truncated: view.length > n,
        total: view.length
      });
    }
  }

};
