/* main.js — connects the controls on the page and starts the app.
   Loaded last. Defines nothing global. */

(function (SV) {
  'use strict';

  const S = SV.state;
  const { byId, showToast, setStatus, setProgress } = SV;

  /* ------------------------------------------------------------ open a file */

  byId('openBtn').addEventListener('click', () => byId('fileInput').click());
  byId('pickBtn').addEventListener('click', () => byId('fileInput').click());
  byId('dropCard').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    byId('fileInput').click();
  });
  byId('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) SV.engine.loadFile(file);
  });

  /* ------------------------------------------------------------ drag and drop */

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    byId('dropCard').classList.add('drag');
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) byId('dropCard').classList.remove('drag');
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    byId('dropCard').classList.remove('drag');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) SV.engine.loadFile(file);
  });

  /* ------------------------------------------------------------ filters and sort */

  byId('search').addEventListener('input', () => SV.filters.apply(true));
  byId('searchValues').addEventListener('change', () => SV.filters.apply(true));
  byId('typeFilter').addEventListener('change', () => SV.filters.apply(true));
  byId('sortKey').addEventListener('change', () => SV.filters.apply(true));
  byId('sortDir').addEventListener('click', () => {
    const wasDesc = byId('sortDir').dataset.dir === 'desc';
    byId('sortDir').dataset.dir = wasDesc ? 'asc' : 'desc';
    byId('sortDir').textContent = wasDesc ? '↑' : '↓';
    byId('sortDir').setAttribute('aria-label', wasDesc ? 'Sorted ascending, switch to descending' : 'Sorted descending, switch to ascending');
    SV.filters.apply(true);
  });
  byId('filtersBtn').addEventListener('click', () => SV.filters.togglePanel());

  /* ------------------------------------------------------------ export menu */

  byId('exportBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    SV.filters.toggleExport();
  });
  document.addEventListener('click', (e) => {
    if (!byId('exportMenu').classList.contains('hidden') && !e.target.closest('.menu-wrap')) SV.filters.toggleExport(false);
  });
  byId('exportJson').addEventListener('click', () => {
    SV.filters.toggleExport(false);
    if (!S.viewTotal) {
      showToast('Nothing to export.', 'error');
      return;
    }
    SV.engine.send({ type: 'export', reqId: ++S.reqSeq, format: 'json' });
    setStatus('Building JSON export…');
  });
  byId('exportCsv').addEventListener('click', () => {
    SV.filters.toggleExport(false);
    if (!S.viewTotal) {
      showToast('Nothing to export.', 'error');
      return;
    }
    SV.engine.send({ type: 'export', reqId: ++S.reqSeq, format: 'csv' });
    setStatus('Building CSV export…');
  });

  /* ------------------------------------------------------------ scan and views */

  byId('scanBtn').addEventListener('click', () => {
    if (!S.currentStats) return;
    byId('scanBtn').disabled = true;
    byId('scanBtn').textContent = 'Scanning…';
    S.scanErrors = [];
    S.scanned = false;
    SV.engine.send({ type: 'scan', reqId: ++S.reqSeq });
    setProgress(true, 0, 100, 'Scanning all values…');
  });

  for (const button of document.querySelectorAll('.view')) {
    button.addEventListener('click', (e) => SV.views.showView(button.dataset.tab, e.detail === 0));
  }

  /* ------------------------------------------------------------ list scrolling and selection */

  byId('listScroller').addEventListener('scroll', () => {
    if (S.rafPending) return;
    S.rafPending = true;
    requestAnimationFrame(() => {
      S.rafPending = false;
      SV.list.renderList();
      SV.list.updateJumpTop();
    });
  }, { passive: true });

  byId('jumpTop').addEventListener('click', () => {
    const scroller = byId('listScroller');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.focus({ preventScroll: true });
    scroller.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    SV.list.updateJumpTop();
  });

  byId('listRows').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const k = Number(row.dataset.k);
    if (!Number.isFinite(k)) return;
    const items = S.pageCache.get(Math.floor(k / SV.PAGE_SIZE));
    if (!items) return;
    const item = items[k % SV.PAGE_SIZE];
    if (item) SV.list.selectRow(item.idx, k);
  });

  /* ------------------------------------------------------------ keyboard */

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!byId('exportMenu').classList.contains('hidden')) {
        SV.filters.toggleExport(false);
        byId('exportBtn').focus();
        e.preventDefault();
        return;
      }
      if (byId('toolbar').classList.contains('filters-open')) {
        SV.filters.togglePanel(false);
        byId('filtersBtn').focus();
        return;
      }
    }
    if (e.target && e.target.matches && e.target.matches('input,select,textarea,[contenteditable]')) return;
    if (S.activeView !== 'variables' || !S.viewTotal) return;
    const listFocused = document.activeElement === byId('listScroller');
    let k = null;
    if (e.key === 'ArrowDown') k = S.selected < 0 ? 0 : S.selected + 1;
    else if (e.key === 'ArrowUp') k = S.selected < 0 ? 0 : S.selected - 1;
    else if (listFocused && e.key === 'Home') k = 0;
    else if (listFocused && e.key === 'End') k = S.viewTotal - 1;
    if (k == null) return;
    e.preventDefault();
    k = Math.max(0, Math.min(S.viewTotal - 1, k));
    const items = S.pageCache.get(Math.floor(k / SV.PAGE_SIZE));
    if (items && items[k % SV.PAGE_SIZE]) {
      SV.list.selectRow(items[k % SV.PAGE_SIZE].idx, k);
      SV.list.scrollRowIntoView(k);
    } else {
      S.pendingSelect = k;
      SV.list.requestPage(Math.floor(k / SV.PAGE_SIZE));
      SV.list.scrollRowIntoView(k);
    }
  });

  /* ------------------------------------------------------------ resize and start */

  window.addEventListener('resize', () => {
    const height = SV.measureRowHeight();
    if (height !== S.rowHeight) {
      S.rowHeight = height;
      SV.list.updateSpacer();
      S.renderDirty = true;
      S.renderedFirst = S.renderedLast = -1;
      byId('listRows').textContent = '';
    }
    SV.list.renderList(true);
    SV.detail.updateHexDump();
  });

  window.addEventListener('beforeunload', () => {
    if (S.workerUrl) URL.revokeObjectURL(S.workerUrl);
  });

  SV.detail.init();
  S.rowHeight = SV.measureRowHeight();
  if (SV.engine.init()) setStatus('');
})(window.SV);
