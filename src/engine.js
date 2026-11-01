/* engine.js — starts the worker and handles everything a file goes through:
   loading, parsing, paging, details, exports and scans.
   Defines SV.engine. */

(function (SV) {
  'use strict';

  const S = SV.state;
  const { byId, create, fmtNum, fmtBytes, showToast, setStatus, setProgress } = SV;
  const PAGE_SIZE = SV.PAGE_SIZE;

  /** Starts the background worker. Returns false when the browser refuses. */
  function init() {
    const decoder = window.SV_decoderFactory;
    const workerMain = window.SV_workerFactory;
    if (typeof decoder !== 'function' || typeof workerMain !== 'function') {
      showFatal(new Error('The worker source did not load.'));
      return false;
    }
    let url = null;
    try {
      const source = 'self.SVDecoder = (' + decoder.toString() + ')();\n(' + workerMain.toString() + ')(self.SVDecoder);\n';
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      S.worker = new Worker(url);
      S.workerUrl = url;
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      showFatal(e);
      return false;
    }
    S.worker.onmessage = onMessage;
    S.worker.onerror = (e) => showToast('Worker error: ' + ((e && e.message) || 'the worker could not start'), 'error');
    return true;
  }

  /** Replaces the drop screen with an explanation when the worker cannot start. */
  function showFatal(e) {
    const box = create('div', 'fatal');
    box.append(create('h2', '', 'The background worker could not start'));
    box.append(create('p', '', String(e && e.message ? e.message : e)));
    box.append(create('p', '', 'Try a current Chrome, Edge, Firefox or Safari. The viewer needs blob workers to keep the list responsive on large files.'));
    const welcome = byId('welcome');
    welcome.textContent = '';
    welcome.append(box);
    setStatus('Background worker unavailable');
  }

  /** Sends a message to the worker. */
  function send(msg) {
    if (S.worker) S.worker.postMessage(msg);
  }

  /** Routes a worker message to its handler. */
  function onMessage(e) {
    const message = e.data;
    switch (message.type) {
      case 'progress': onProgress(message); break;
      case 'parsed': onParsed(message); break;
      case 'viewInfo': onViewInfo(message); break;
      case 'viewData': onViewData(message); break;
      case 'detailData': onDetailData(message); break;
      case 'exportData': onExportData(message); break;
      case 'scanDone': onScanDone(message); break;
      case 'error':
        showToast(message.message, 'error');
        setProgress(false);
        setStatus('Error');
        break;
    }
  }

  /** Shows parse, filter and scan progress. */
  function onProgress(message) {
    if (message.phase === 'parse') {
      const pct = message.total > 0 ? Math.min(100, Math.round((message.bytes / message.total) * 100)) : 0;
      const box = byId('parseProgress');
      box.classList.remove('hidden');
      box.querySelector('.bar').style.width = pct + '%';
      box.querySelector('.pct').textContent = pct + '%';
      byId('parseLabel').textContent = fmtNum(message.rows) + ' variables';
      setProgress(true, message.bytes, message.total, 'Parsing… ' + fmtNum(message.rows) + ' variables');
    } else if (message.phase === 'filter') {
      setProgress(true, message.done, message.total, 'Searching values…');
    } else if (message.phase === 'scan') {
      setProgress(true, message.done, message.total, 'Scanning values…');
    }
  }

  /** A file has been read: fill the views and show the workspace. */
  function onParsed(message) {
    S.currentMeta = message.meta;
    S.currentStats = message.stats;
    S.currentTypes = message.types || [];
    S.issueRows = message.issues || [];
    S.scanErrors = [];
    S.scanned = false;
    S.scanInfo = null;
    SV.tables.renderScanReport();
    byId('parseProgress').classList.add('hidden');
    byId('parseLabel').textContent = '';
    byId('welcome').classList.add('hidden');
    byId('workspace').classList.remove('hidden');
    byId('openBtn').classList.remove('hidden');
    SV.views.showFileInBar();
    SV.views.moveTitle('workspace');
    S.viewTotal = message.stats.live;
    S.rowHeight = SV.measureRowHeight();
    SV.list.resetView();
    SV.tables.renderTypes();
    SV.tables.renderIssues();
    SV.tables.populateTypeFilter();
    SV.views.showView('variables');
    SV.detail.showEmpty();
    SV.list.requestPage(0);
    setProgress(false);
    setStatus('Loaded ' + fmtNum(message.stats.live) + ' variables in ' + fmtNum(message.stats.ms) + ' ms');
  }

  /** The filtered total changed: update the count and the list. */
  function onViewInfo(message) {
    S.viewTotal = message.total;
    S.renderDirty = true;
    if (message.stats) S.currentStats = message.stats;
    SV.list.updateSpacer();
    SV.views.renderSummary();
    byId('tabVarCount').textContent = fmtNum(message.total);
    setProgress(false);
    if (S.pendingSelect >= 0) {
      const k = S.pendingSelect;
      const items = S.pageCache.get(Math.floor(k / PAGE_SIZE));
      if (items && items[k % PAGE_SIZE]) {
        S.pendingSelect = -1;
        SV.list.selectRow(items[k % PAGE_SIZE].idx, k);
      }
    }
    SV.list.renderList();
    if (message.ms != null) setStatus('Showing ' + fmtNum(message.total) + ' variables (filtered in ' + message.ms + ' ms)');
  }

  /** One page of rows arrived: cache it and draw. */
  function onViewData(message) {
    const page = S.pendingPages.get(message.reqId);
    S.pendingPages.delete(message.reqId);
    if (page == null) return;
    S.inflight.delete(page);
    S.pageCache.set(page, message.items);
    S.renderDirty = true;
    if (S.pageCache.size > SV.MAX_PAGES) {
      const current = Math.floor(byId('listScroller').scrollTop / S.rowHeight / PAGE_SIZE);
      const keys = [...S.pageCache.keys()].sort((a, b) => Math.abs(b - current) - Math.abs(a - current));
      for (let i = 0; i < keys.length && S.pageCache.size > SV.MAX_PAGES; i++) S.pageCache.delete(keys[i]);
    }
    if (S.pendingSelect >= 0) {
      const k = S.pendingSelect;
      if (Math.floor(k / PAGE_SIZE) === page) {
        const items = S.pageCache.get(page);
        if (items && items[k % PAGE_SIZE]) {
          S.pendingSelect = -1;
          SV.list.selectRow(items[k % PAGE_SIZE].idx, k);
        }
      }
    }
    SV.list.renderList();
  }

  /** A decoded value arrived. */
  function onDetailData(message) {
    if (message.reqId !== S.pendingDetail) return;
    SV.detail.render(message.detail);
  }

  /** A download was built: save it. */
  function onExportData(message) {
    const blob = new Blob([message.text], { type: message.mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = message.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('Exported ' + fmtNum(Math.min(message.total, 50000)) + ' rows' + (message.truncated ? ' (capped at 50,000)' : ''), 'ok');
  }

  /** The scan finished: show its report. */
  function onScanDone(message) {
    S.scanErrors = message.errors || [];
    S.scanned = true;
    S.scanInfo = { scanned: message.scanned, ok: message.ok, warn: message.total };
    SV.tables.renderIssues();
    SV.tables.renderScanReport();
    const button = byId('scanBtn');
    button.disabled = false;
    button.textContent = 'Scan all values';
    setProgress(false);
    setStatus('Scanned ' + fmtNum(message.scanned) + ' values: ' + fmtNum(message.ok) + ' decoded cleanly, ' + fmtNum(message.total) + ' with warnings');
  }

  /** Opens a file: clear the old one and hand it to the worker. */
  function loadFile(file) {
    if (!file) return;
    if (!file.size) {
      showToast('That file is empty.', 'error');
      return;
    }
    resetForNewFile();
    SV.views.moveTitle('welcome');
    byId('welcome').classList.remove('hidden');
    byId('workspace').classList.add('hidden');
    const progress = byId('parseProgress');
    progress.classList.remove('hidden');
    progress.querySelector('.bar').style.width = '0%';
    progress.querySelector('.pct').textContent = '0%';
    byId('parseLabel').textContent = 'Reading ' + fmtBytes(file.size) + '…';
    setStatus('Parsing ' + file.name + '…');
    send({ type: 'parse', file });
  }

  /** Forgets the current file, its filters and its views. */
  function resetForNewFile() {
    S.viewTotal = 0;
    S.scanned = false;
    S.scanErrors = [];
    S.scanInfo = null;
    S.issueRows = [];
    S.currentMeta = null;
    S.currentStats = null;
    S.currentTypes = [];
    SV.views.clearFileBar();
    SV.list.resetView();
    const scanButton = byId('scanBtn');
    scanButton.disabled = false;
    scanButton.textContent = 'Scan all values';
    S.pendingDetail = -1;
    byId('typesTable').querySelector('tbody').textContent = '';
    byId('issuesTable').querySelector('tbody').textContent = '';
    byId('search').value = '';
    byId('searchValues').checked = false;
    byId('typeFilter').textContent = '';
    byId('typeFilter').append(new Option('All types', ''));
    byId('sortKey').value = 'name';
    byId('sortDir').dataset.dir = 'asc';
    byId('sortDir').textContent = '↑';
    byId('sortDir').setAttribute('aria-label', 'Sorted ascending, switch to descending');
    SV.detail.showEmpty();
    SV.tables.renderScanReport();
  }

  SV.engine = { init, send, loadFile, resetForNewFile };
})(window.SV);
