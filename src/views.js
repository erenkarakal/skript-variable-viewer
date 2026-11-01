/* views.js — the page title, the view switcher and the file name in the top bar.
   Defines SV.views. */

(function (SV) {
  'use strict';

  const S = SV.state;
  const { byId, fmtNum, fmtBytes } = SV;

  const appTitle = byId('appTitle');
  const titleSlot = byId('titleSlot');
  const welcomeHead = appTitle.parentElement;
  const TITLES = { variables: 'Variables', types: 'Types', issues: 'Issues' };

  /** Moves the one h1 into the welcome screen or the workspace and names that screen. */
  function moveTitle(view) {
    if (view === 'workspace') {
      if (appTitle.parentElement !== titleSlot) titleSlot.append(appTitle);
    } else {
      if (appTitle.parentElement !== welcomeHead) welcomeHead.prepend(appTitle);
      appTitle.textContent = 'Drop variables.csv';
    }
  }

  /** Writes the one-line summary under the title. */
  function renderSummary() {
    const sub = byId('screenSub');
    if (!S.currentStats) {
      sub.textContent = 'No file loaded.';
      return;
    }
    const stats = S.currentStats;
    const bits = [];
    if (S.activeView === 'variables') {
      if (stats.shown != null && stats.shown !== stats.live) {
        bits.push('Showing ' + fmtNum(stats.shown) + ' of ' + fmtNum(stats.live) + ' variables');
      } else {
        bits.push(fmtNum(stats.live) + (stats.live === 1 ? ' variable' : ' variables'));
      }
      const issues = (stats.issues || 0) + S.scanErrors.length;
      if (issues) bits.push(fmtNum(issues) + (issues === 1 ? ' issue' : ' issues'));
    } else if (S.activeView === 'types') {
      const bytes = S.currentTypes.reduce((sum, t) => sum + (t.bytes || 0), 0);
      bits.push(fmtNum(S.currentTypes.length) + (S.currentTypes.length === 1 ? ' type' : ' types'));
      bits.push('across ' + fmtNum(stats.live) + ' variables');
      bits.push(fmtBytes(bytes) + ' of payload');
    } else {
      const issues = S.issueRows.length + S.scanErrors.length;
      bits.push(issues ? fmtNum(issues) + (issues === 1 ? ' issue' : ' issues') : 'No issues found');
      bits.push(S.scanned ? 'every payload scanned' : 'parse problems only until you scan');
    }
    sub.textContent = bits.join(' · ');
  }

  /** Switches between Variables, Types and Issues. */
  function showView(name, focusTitle) {
    S.activeView = name;
    for (const button of document.querySelectorAll('.view')) {
      button.setAttribute('aria-current', button.dataset.tab === name ? 'true' : 'false');
    }
    for (const id of ['variables', 'types', 'issues']) byId('tab-' + id).classList.toggle('hidden', id !== name);
    appTitle.textContent = TITLES[name] || name;
    SV.detail.closePane();
    renderSummary();
    if (focusTitle) {
      appTitle.tabIndex = -1;
      appTitle.focus();
    }
    if (name === 'variables') SV.list.renderList(true);
  }

  /** Puts the open file's name, size and Skript version in the top bar. */
  function showFileInBar() {
    if (!S.currentMeta) return;
    const parts = [fmtBytes(S.currentMeta.fileSize)];
    parts.push(S.currentMeta.skriptVersion ? 'Skript ' + S.currentMeta.skriptVersion : 'Skript version unknown');
    byId('fileName').textContent = S.currentMeta.fileName;
    byId('fileMeta').textContent = parts.join(' · ');
    byId('scope').classList.remove('hidden');
    document.body.classList.add('has-file');
    document.title = S.currentMeta.fileName + ' · Skript Variable Viewer';
  }

  /** Clears the file name from the top bar. */
  function clearFileBar() {
    byId('scope').classList.add('hidden');
    document.body.classList.remove('has-file');
    document.title = 'Skript Variable Viewer';
  }

  SV.views = { moveTitle, renderSummary, showView, showFileInBar, clearFileBar };
})(window.SV);
