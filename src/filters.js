/* filters.js — search, type filter, sort, the filters panel and the export menu.
   Defines SV.filters. */

(function (SV) {
  'use strict';

  const S = SV.state;
  const { byId, setStatus, setProgress } = SV;

  /** Waits a moment, then sends the current filter settings to the worker. */
  function apply(reset) {
    clearTimeout(S.filterTimer);
    S.filterTimer = setTimeout(() => {
      if (reset) {
        SV.list.resetView();
        S.pendingDetail = -1;
        SV.detail.closePane();
        SV.detail.showEmpty();
      }
      const opts = {
        query: byId('search').value,
        typeFilter: byId('typeFilter').value,
        sortKey: byId('sortKey').value,
        sortDir: byId('sortDir').dataset.dir === 'desc' ? -1 : 1,
        searchValues: byId('searchValues').checked
      };
      SV.engine.send({ type: 'filter', reqId: ++S.reqSeq, opts });
      if (opts.searchValues && opts.query.trim()) setProgress(true, 0, 100, 'Searching values…');
      else setStatus('Filtering…');
    }, 160);
  }

  /** Opens or closes the extra filter controls on phones. */
  function togglePanel(force) {
    const bar = byId('toolbar');
    const open = force != null ? force : !bar.classList.contains('filters-open');
    bar.classList.toggle('filters-open', open);
    byId('filtersBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /** Opens or closes the Export menu. */
  function toggleExport(force) {
    const menu = byId('exportMenu');
    const open = force != null ? force : menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    byId('exportBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const first = menu.querySelector('button');
      if (first) first.focus();
    }
  }

  SV.filters = { apply, togglePanel, toggleExport };
})(window.SV);
