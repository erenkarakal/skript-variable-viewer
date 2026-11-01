/* tables.js — the Types view, the Issues view and the scan report.
   Defines SV.tables. */

(function (SV) {
  'use strict';

  const S = SV.state;
  const { byId, create, fmtNum, fmtBytes } = SV;

  /* Short, plain descriptions of the types the decoder understands. */
  const TYPE_NOTES = {
    string: 'UTF-8 text',
    integer: 'A whole number, read as a 32-bit signed integer',
    int: 'A whole number, read as a 32-bit signed integer',
    long: 'A whole number, read as a 64-bit signed integer',
    byte: 'A small whole number, 8-bit',
    short: 'A small whole number, 16-bit',
    double: 'A decimal number, read as a 64-bit float',
    float: 'A decimal number, read as a 32-bit float',
    number: 'A numeric value',
    boolean: 'true or false',
    bool: 'true or false',
    char: 'One character with its code point',
    world: 'A world name, resolved when Skript loads it',
    location: 'World name with x, y, z, yaw and pitch',
    vector: 'x, y and z, each a 64-bit float',
    block: 'World name with integer x, y and z',
    chunk: 'World name with chunk x and z',
    uuid: 'Two 64-bit halves, shown as one UUID',
    offlineplayer: 'A UUID; names cannot be resolved offline',
    player: 'A UUID; names cannot be resolved offline',
    itemstack: 'YAML from the configuration serializer, with display name, lore and enchantments',
    itemtype: 'YAML item written by the configuration serializer',
    material: 'An ordinal; the name follows the server version',
    blockdata: 'Block state text from the world',
    date: 'Milliseconds since 1970, printed in UTC and local time',
    timespan: 'Milliseconds, also written as days, hours and minutes'
  };

  /** A one-line description of a type, used by the Types table and the detail footer. */
  function noteFor(type) {
    return TYPE_NOTES[String(type).toLowerCase()] || 'Open one to see its structure and decoded fields';
  }

  /** Fills the type filter with the types found in the file. */
  function populateTypeFilter() {
    const select = byId('typeFilter');
    const keep = select.value;
    select.textContent = '';
    select.append(new Option('All types', ''));
    for (const type of S.currentTypes) select.append(new Option(type.type + ' (' + fmtNum(type.count) + ')', type.type));
    if (keep && S.currentTypes.some((type) => type.type === keep)) select.value = keep;
  }

  /** Draws the Types table. */
  function renderTypes() {
    const body = byId('typesTable').querySelector('tbody');
    body.textContent = '';
    byId('tabTypeCount').textContent = fmtNum(S.currentTypes.length);
    if (!S.currentTypes.length) {
      const empty = create('td', 'empty', 'No types found.');
      empty.colSpan = 4;
      const row = create('tr');
      row.append(empty);
      body.append(row);
      return;
    }
    for (const type of S.currentTypes) {
      const row = create('tr', 'clickable');
      row.title = 'Show only ' + type.type + ' variables';
      const cell = create('td', 'mono');
      const choose = create('button', 'type-filter', type.type);
      choose.type = 'button';
      cell.append(choose);
      row.append(
        cell,
        create('td', 'type-note', noteFor(type.type)),
        create('td', 'num', fmtNum(type.count)),
        create('td', 'num', fmtBytes(type.bytes))
      );
      row.addEventListener('click', () => {
        byId('typeFilter').value = type.type;
        SV.views.showView('variables');
        SV.filters.apply(true);
        byId('listScroller').focus();
      });
      body.append(row);
    }
    SV.views.renderSummary();
  }

  /** Shows the numbers from the last scan, or dashes before the first one. */
  function renderScanReport() {
    const info = S.scanInfo;
    byId('scanCount').textContent = info ? fmtNum(info.scanned) : '–';
    byId('scanOk').textContent = info ? fmtNum(info.ok) : '–';
    byId('scanWarn').textContent = info ? fmtNum(info.warn) : '–';
    byId('scanNote').textContent = 'A scan decodes every payload, not just the rows on screen.';
  }

  /** Draws the Issues table from parse problems and scan warnings. */
  function renderIssues() {
    const body = byId('issuesTable').querySelector('tbody');
    body.textContent = '';
    const all = [];
    for (const issue of S.issueRows) all.push({ line: issue.line, kind: issue.kind, name: issue.name || '', message: issue.message });
    for (const issue of S.scanErrors) all.push({ line: issue.line, kind: 'decode', name: issue.name || '', message: issue.message });
    if (!all.length) {
      const row = create('tr');
      const cell = create('td', 'empty', S.scanned
        ? 'No parse or decode issues found.'
        : 'No parse issues found. Scan all values to decode every payload and look for warnings.');
      cell.colSpan = 4;
      row.append(cell);
      body.append(row);
    } else {
      const KIND = { malformed: 'Malformed line', hex: 'Invalid hex', decode: 'Decode error' };
      for (const issue of all) {
        const row = create('tr');
        row.append(
          create('td', 'col-line', issue.line == null ? '' : String(issue.line)),
          create('td', '', KIND[issue.kind] || issue.kind),
          create('td', 'mono', issue.name),
          create('td', '', issue.message)
        );
        body.append(row);
      }
    }
    byId('tabIssueCount').textContent = fmtNum(all.length);
    SV.views.renderSummary();
  }

  SV.tables = { noteFor, populateTypeFilter, renderTypes, renderScanReport, renderIssues };
})(window.SV);
