/* detail.js — the right-hand pane: one variable's decoded value, its fields,
   its tree and its raw hex. Defines SV.detail. */

(function (SV) {
  'use strict';

  const S = SV.state;
  const { byId, create, fmtNum, showToast } = SV;

  /* A canvas only used to measure the width of the monospace font. */
  const measureCanvas = document.createElement('canvas').getContext('2d');

  /** Shows the "select a variable" message. */
  function showEmpty() {
    const pane = byId('detail');
    S.currentHex = null;
    pane.textContent = '';
    pane.append(create('div', 'detail-empty', 'Select a variable to see its decoded value.'));
    pane.lastChild.append(create('p', '', 'Arrow keys move through the list.'));
  }

  /** Hides the detail and returns to the list on phones. */
  function closePane() {
    byId('split').classList.remove('show-detail');
    byId('tab-variables').classList.remove('detail-open');
  }

  /** A titled block inside the pane, with optional buttons beside the title. */
  function section(title, content, actions) {
    const box = create('section', 'section');
    const head = create('div', 'section-head');
    head.append(create('h3', '', title));
    if (actions) head.append(actions);
    box.append(head, content);
    return box;
  }

  /** A scrollable, focusable block of code or text. */
  function codeBlock(text) {
    const block = create('pre', 'code');
    block.tabIndex = 0;
    block.textContent = String(text == null ? '' : text);
    return block;
  }

  /** Width of one monospace character, in CSS pixels. */
  function charWidth(pre) {
    const style = getComputedStyle(pre);
    measureCanvas.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    return measureCanvas.measureText('0000000000').width / 10 || 7.8;
  }

  /** How many payload bytes fit on one hex line at this width. */
  function bytesPerLine(pre) {
    const style = getComputedStyle(pre);
    const room = pre.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!(room > 40)) return 0;
    const chars = Math.floor(room / charWidth(pre)) - 1;
    return Math.max(4, Math.min(24, Math.floor((chars - 7) / 4)));
  }

  /** Formats hex as offset / bytes / ASCII lines, sized for the pane. */
  function hexDump(hex, perLine) {
    if (!perLine || !/^[0-9a-f]*$/i.test(hex) || hex.length % 2) return null;
    const bytes = hex.match(/../g) || [];
    if (!bytes.length) return null;
    const lines = [];
    for (let off = 0; off < bytes.length; off += perLine) {
      const chunk = bytes.slice(off, off + perLine);
      let hexPart = '';
      let asciiPart = '';
      for (let i = 0; i < perLine; i++) {
        if (i < chunk.length) {
          const value = parseInt(chunk[i], 16);
          hexPart += chunk[i] + ' ';
          asciiPart += (value >= 32 && value < 127) ? String.fromCharCode(value) : '.';
        } else {
          hexPart += '   ';
          asciiPart += ' ';
        }
      }
      lines.push(off.toString(16).padStart(4, '0') + '  ' + hexPart + ' ' + asciiPart);
    }
    return lines.join('\n');
  }

  /** Re-renders the hex dump for the pane's current width. */
  function updateHexDump() {
    if (!S.currentHex) return;
    const { pre, hex, fallback } = S.currentHex;
    if (!pre.isConnected || !pre.clientWidth) return;
    const text = hexDump(hex, bytesPerLine(pre)) || fallback;
    if (pre.textContent !== text) pre.textContent = text;
  }

  /** Remembers the payload of a block so it can be re-wrapped on resize. */
  function setHexDump(pre, hex, fallback) {
    S.currentHex = { pre, hex: hex || '', fallback: fallback || '(empty payload)' };
    updateHexDump();
  }

  /** Copies text, with a fallback for browsers without the clipboard API. */
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('copy command failed');
  }

  /** A small button that copies a value and shows a toast. */
  function copyButton(label, text) {
    const button = create('button', 'btn btn-sm', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      const value = typeof text === 'function' ? text() : String(text);
      copyText(value)
        .then(() => showToast('Copied to clipboard', 'ok'))
        .catch((e) => showToast('Clipboard blocked: ' + e.message, 'error'));
    });
    return button;
  }

  /** Draws one variable in the pane. */
  function render(d) {
    const pane = byId('detail');
    pane.textContent = '';
    if (!d) {
      showEmpty();
      return;
    }
    pane.append(backButton());

    const head = create('div', 'detail-head');
    head.append(create('div', 'detail-name', d.name));
    const badges = create('div', 'badges');
    badges.append(create('span', 'chip type', d.type));
    head.append(badges);
    pane.append(head);

    const meta = create('div', 'detail-meta');
    meta.append(create('span', '', 'Line ' + d.line), create('span', '', fmtNum(d.size) + ' bytes'));
    pane.append(meta);

    if (d.decoded) {
      pane.append(create('div', 'summary', d.decoded.summary || '(empty)'));
      if (d.decoded.error) pane.append(create('div', 'note bad', 'Decode error: ' + d.decoded.error));
      if (!d.decoded.exact && !d.decoded.error) {
        pane.append(create('div', 'note warn', 'This payload did not decode exactly; ' + fmtNum(d.decoded.trailing || 0) + ' byte(s) may be unaccounted for.'));
      }
      for (const note of d.decoded.notes || []) pane.append(create('div', 'note', note));
      if (d.decoded.fields && d.decoded.fields.length) {
        const table = create('table', 'kv');
        const body = create('tbody');
        for (const pair of d.decoded.fields) {
          const row = create('tr');
          row.append(create('th', '', pair[0]), create('td', '', String(pair[1])));
          body.append(row);
        }
        table.append(body);
        pane.append(section('Details', table));
      }
      if (d.decoded.code && d.decoded.code.text) {
        pane.append(section(d.decoded.code.label || 'Text', codeBlock(d.decoded.code.text)));
      }
      pane.append(section('Structure', renderValueTree(d.decoded.node)));
    } else if (d.error) {
      pane.append(create('div', 'note bad', 'Could not decode: ' + d.error));
    }

    const actions = create('div', 'detail-actions');
    actions.append(
      copyButton('Copy hex', d.hex || ''),
      copyButton('Copy JSON', () => JSON.stringify({
        name: d.name,
        type: d.type,
        line: d.line,
        summary: d.decoded ? d.decoded.summary : null,
        hex: d.hex || null
      }, null, 2))
    );
    const hexPre = codeBlock('');
    pane.append(section('Raw payload', hexPre, actions));
    setHexDump(hexPre, d.hex || '', d.hexPretty || '(empty payload)');

    const note = SV.tables.noteFor(d.type);
    if (note) pane.append(create('p', 'type-foot', 'Stored as ' + note.charAt(0).toLowerCase() + note.slice(1) + '.'));
  }

  /** A small "back to list" button, only shown on phones. */
  function backButton() {
    const button = create('button', 'btn btn-sm detail-back', 'Back to list');
    button.type = 'button';
    button.addEventListener('click', () => {
      closePane();
      byId('listScroller').focus();
    });
    return button;
  }

  /** Draws a decoded value tree as nested <details> blocks. */
  function renderValueTree(node, depth) {
    depth = depth || 0;
    if (!node) return create('span', 'null', 'null');
    switch (node.k) {
      case 'null':
        return create('span', 'null', 'null');
      case 'prim': {
        const wrap = create('span');
        const value = node.t === 'char'
          ? JSON.stringify(node.text) + ' (U+' + ((node.code || 0).toString(16).toUpperCase().padStart(4, '0')) + ')'
          : node.text;
        wrap.append(create('span', 'tag', node.t), create('span', 'val', value));
        return wrap;
      }
      case 'string': {
        const wrap = create('span');
        const text = node.v;
        const shown = text.length > 600 ? text.slice(0, 600) + '…' : text;
        wrap.append(create('span', 'tag', 'string'), create('span', 'str', JSON.stringify(shown)));
        if (node.omitted) wrap.append(create('span', 'muted', ' (' + fmtNum(node.v.length + node.omitted) + ' chars)'));
        return wrap;
      }
      case 'enum': {
        const wrap = create('span');
        wrap.append(create('span', 'tag', 'enum'), create('span', 'val', node.type + '.' + node.id));
        return wrap;
      }
      case 'class': {
        const wrap = create('span');
        wrap.append(create('span', 'tag', 'class'), create('span', 'val', node.type));
        return wrap;
      }
      case 'ref':
        return create('span', 'ref', 'reference #' + node.id);
      case 'truncated':
        return create('span', 'muted', '… ' + (node.reason || 'truncated'));
      case 'raw':
        return create('span', 'muted', String(node.hex || '').slice(0, 200));
      case 'object': {
        const box = create('details', 'tree');
        if (depth < 2) box.open = true;
        const summary = create('summary');
        summary.append(
          create('span', 'tag', 'object'),
          create('span', 'val', node.type),
          create('span', 'muted', ' · ' + fmtNum(node.fields.length) + ' field' + (node.fields.length === 1 ? '' : 's'))
        );
        box.append(summary);
        const children = create('div', 'tree-children');
        for (const field of node.fields) {
          const line = create('div', 'tree-field');
          line.append(create('span', 'field-name', field.name), create('span', 'muted', ': '), renderValueTree(field.value, depth + 1));
          children.append(line);
        }
        if (node.omitted) children.append(create('div', 'muted', '… ' + fmtNum(node.omitted) + ' more fields'));
        box.append(children);
        return box;
      }
      case 'array': {
        const box = create('details', 'tree');
        if (depth < 2) box.open = true;
        const summary = create('summary');
        summary.append(create('span', 'tag', 'array'), create('span', 'val', node.component + '[' + fmtNum(node.count) + ']'));
        box.append(summary);
        const children = create('div', 'tree-children');
        node.items.forEach((item, i) => {
          const line = create('div', 'tree-field');
          line.append(create('span', 'field-name', '[' + i + ']'), create('span', 'muted', ': '), renderValueTree(item, depth + 1));
          children.append(line);
        });
        if (node.omitted) children.append(create('div', 'muted', '… ' + fmtNum(node.omitted) + ' more items'));
        box.append(children);
        return box;
      }
      default:
        return create('span', 'muted', String(node.k));
    }
  }

  /** Re-wraps the hex dump when the pane changes width. */
  function init() {
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => updateHexDump()).observe(byId('detail'));
    }
  }

  SV.detail = { showEmpty, closePane, render, updateHexDump, init };
})(window.SV);
