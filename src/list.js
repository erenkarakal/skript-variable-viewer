/* list.js — the virtual list: pages, rows, selection and the jump-to-top button.
   Defines SV.list. */

(function (SV) {
  'use strict';

  const S = SV.state;
  const { byId, create } = SV;
  const PAGE_SIZE = SV.PAGE_SIZE;

  /** Sets the scroll area's height so the scrollbar matches the filtered total. */
  function updateSpacer() {
    byId('listSpacer').style.height = (S.viewTotal * S.rowHeight) + 'px';
  }

  /** Shows the jump-to-top button only when the list is scrolled down. */
  function updateJumpTop() {
    byId('jumpTop').hidden = byId('listScroller').scrollTop < 240;
  }

  /** Asks the worker for one page of rows, if it is not cached or already on the way. */
  function requestPage(page) {
    if (page < 0) return;
    if (S.pageCache.has(page) || S.inflight.has(page)) return;
    S.inflight.add(page);
    const id = ++S.reqSeq;
    S.pendingPages.set(id, page);
    SV.engine.send({ type: 'view', reqId: id, start: page * PAGE_SIZE, count: PAGE_SIZE });
  }

  /** Builds one row, or a placeholder while its page is still loading. */
  function buildRow(k) {
    const items = S.pageCache.get(Math.floor(k / PAGE_SIZE));
    const row = create('div', 'row' + (k === S.selected ? ' selected' : ''));
    row.dataset.k = String(k);
    row.id = 'row-' + k;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', k === S.selected ? 'true' : 'false');
    if (!items) {
      row.classList.add('loading');
      const name = create('div', 'c-name');
      name.append(create('span', 'skeleton'));
      row.append(create('div', 'c-line'), name, create('div', 'c-type'), create('div', 'c-preview'), create('div', 'c-size'));
      return row;
    }
    const item = items[k % PAGE_SIZE];
    if (!item) {
      row.append(create('div', 'c-line'), create('div', 'c-name muted', '…'), create('div', 'c-type'), create('div', 'c-preview'), create('div', 'c-size'));
      return row;
    }
    const name = create('div', 'c-name');
    name.append(create('code', '', item.name));
    row.append(
      create('div', 'c-line', item.line == null ? '' : String(item.line)),
      name,
      create('div', 'c-type', item.type || ''),
      create('div', 'c-preview', item.preview),
      create('div', 'c-size', item.size ? String(item.size) : '')
    );
    return row;
  }

  /** Draws the rows around the current scroll position. */
  function renderList(force) {
    const scroller = byId('listScroller');
    const rowsBox = byId('listRows');
    if (!S.viewTotal) {
      rowsBox.textContent = '';
      rowsBox.style.transform = 'translateY(0px)';
      S.renderedFirst = S.renderedLast = -1;
      S.renderDirty = false;
      return;
    }
    const viewHeight = scroller.clientHeight || 400;
    const scrollTop = scroller.scrollTop;
    const first = Math.max(0, Math.floor(scrollTop / S.rowHeight) - 6);
    const last = Math.min(S.viewTotal, Math.ceil((scrollTop + viewHeight) / S.rowHeight) + 6);
    if (last <= first) {
      rowsBox.textContent = '';
      S.renderedFirst = S.renderedLast = -1;
      S.renderDirty = false;
      return;
    }
    if (!force && !S.renderDirty && first === S.renderedFirst && last === S.renderedLast) return;
    const firstPage = Math.floor(first / PAGE_SIZE);
    const lastPage = Math.floor((last - 1) / PAGE_SIZE);
    for (let p = firstPage; p <= lastPage; p++) requestPage(p);

    const canPatch = !force && !S.renderDirty && S.renderedFirst >= 0 && first < S.renderedLast && last > S.renderedFirst;
    if (!canPatch) {
      const frag = document.createDocumentFragment();
      for (let k = first; k < last; k++) frag.append(buildRow(k));
      rowsBox.textContent = '';
      rowsBox.append(frag);
    } else {
      if (first < S.renderedFirst) {
        const frag = document.createDocumentFragment();
        for (let k = first; k < S.renderedFirst; k++) frag.append(buildRow(k));
        rowsBox.insertBefore(frag, rowsBox.firstChild);
      }
      if (last > S.renderedLast) {
        const frag = document.createDocumentFragment();
        for (let k = S.renderedLast; k < last; k++) frag.append(buildRow(k));
        rowsBox.append(frag);
      }
      while (S.renderedFirst < first) {
        rowsBox.removeChild(rowsBox.firstChild);
        S.renderedFirst++;
      }
      while (S.renderedLast > last) {
        rowsBox.removeChild(rowsBox.lastChild);
        S.renderedLast--;
      }
    }
    S.renderedFirst = first;
    S.renderedLast = last;
    S.renderDirty = false;
    rowsBox.style.transform = 'translateY(' + (first * S.rowHeight) + 'px)';
    const active = rowsBox.querySelector('.row.selected');
    if (active) scroller.setAttribute('aria-activedescendant', active.id);
    else scroller.removeAttribute('aria-activedescendant');
  }

  /** Selects a row and asks the worker for its detail. */
  function selectRow(idx, k) {
    S.selected = k;
    S.renderDirty = true;
    renderList();
    byId('split').classList.add('show-detail');
    byId('tab-variables').classList.add('detail-open');
    const pane = byId('detail');
    pane.textContent = '';
    pane.append(create('div', 'detail-empty', 'Decoding…'));
    pane.scrollTop = 0;
    S.pendingDetail = ++S.reqSeq;
    SV.engine.send({ type: 'detail', reqId: S.pendingDetail, index: idx });
  }

  /** Scrolls the list just enough to show the row with this index. */
  function scrollRowIntoView(k) {
    const scroller = byId('listScroller');
    const top = k * S.rowHeight;
    const bottom = top + S.rowHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight;
  }

  /** Forgets the cached rows and the selection, and puts the list back at the top. */
  function resetView() {
    S.pageCache.clear();
    S.pendingPages.clear();
    S.inflight.clear();
    S.selected = -1;
    S.pendingSelect = -1;
    byId('listScroller').scrollTop = 0;
    byId('listRows').textContent = '';
    S.renderDirty = true;
    S.renderedFirst = S.renderedLast = -1;
    updateSpacer();
    updateJumpTop();
  }

  SV.list = { updateSpacer, updateJumpTop, requestPage, buildRow, renderList, selectRow, scrollRowIntoView, resetView };
})(window.SV);
