/* decoder.js — reads Skript's Yggdrasil payloads.
   The page turns this function into the worker source, so the worker runs from a blob and
   also works when index.html is opened from disk. Returns the decoder API.
   Public functions: decodeRoot, describe, trimNode, hexToBytes, bytesToHex,
   prettyHex, splitCsvLine, oneLine, formatDuration. */

/* Skript variables decoder: Yggdrasil v1 subset, CSV rules, friendly renderers. */
window.SV_decoderFactory = function () {
  'use strict';

  const PRIM_NAME = { 0x01: 'byte', 0x02: 'short', 0x03: 'int', 0x04: 'long', 0x08: 'float', 0x09: 'double', 0x0E: 'char', 0x0F: 'boolean' };
  const ROOT_PRIM = { byte: 0x01, short: 0x02, integer: 0x03, int: 0x03, long: 0x04, float: 0x08, double: 0x09, char: 0x0E, boolean: 0x0F, bool: 0x0F };
  const HEX = [];
  for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

  const utf8 = new TextEncoder();
  const utf8d = new TextDecoder('utf-8');

  class DecodeError extends Error {
    constructor(message) { super(message); this.name = 'DecodeError'; }

  }

  function hex2(n) { return (n & 0xFF).toString(16).padStart(2, '0'); }

  function isPrimitiveTag(t) { return Object.prototype.hasOwnProperty.call(PRIM_NAME, t); }

  function numText(v) {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    if (Object.is(v, -0)) return '-0.0';
    return String(v);
  }

  class Reader {
    constructor(bytes, seedType) {
      this.b = bytes;
      this.p = 0;
      this.strs = [];
      this.objCount = 1; // the root object consumed reference id 0
      if (seedType) {
        const n = utf8.encode(seedType).length;
        if (n > 4 && n < 255) this.strs.push(seedType);
      }
    }

    get length() { return this.b.length; }

    eof() { return this.p >= this.b.length; }

    need(n) { if (this.p + n > this.b.length) throw new DecodeError('Unexpected end of data at byte ' + this.p); }

    u8() { this.need(1); return this.b[this.p++]; }

    take(n) { this.need(n); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }

    i8() { const v = this.u8(); return v > 127 ? v - 256 : v; }

    u16() { return (this.u8() << 8) | this.u8(); }

    i16() { const v = this.u16(); return v > 0x7FFF ? v - 0x10000 : v; }

    i32() { return (this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8(); }

    u32() { return this.i32() >>> 0; }

    i64() {
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.u8());
      return BigInt.asIntN(64, v);
    }

    f32() { const b = this.take(4); return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, false); }

    f64() { const b = this.take(8); return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, false); }

    ushort() { const b = this.u8(); if (b & 0x80) return b & 0x7F; return (b << 8) | this.u8(); }

    uint() {
      const b = this.u8();
      if (b & 0x80) return ((b & 0x7F) << 8) | this.u8();
      return ((b << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
    }

    str() {
      const n = this.uint();
      if (n > this.b.length - this.p) throw new DecodeError('String length ' + n + ' exceeds remaining data');
      const s = utf8d.decode(this.b.subarray(this.p, this.p + n));
      this.p += n;
      return s;
    }

    shortString() {
      const len = this.u8();
      if (len === 0xFF) {
        const idx = this.i32(); // Yggdrasil version 1 uses a plain 4-byte int here
        if (idx < 0 || idx >= this.strs.length) return '«string ref ' + idx + '»';
        return this.strs[idx];
      }
      if (len > this.b.length - this.p) throw new DecodeError('Short string length ' + len + ' exceeds remaining data');
      const s = utf8d.decode(this.b.subarray(this.p, this.p + len));
      this.p += len;
      if (len > 4) this.strs.push(s);
      return s;
    }

    readPrimitiveRaw(tag) {
      switch (tag) {
        case 0x01: return { k: 'prim', t: 'byte', text: String(this.i8()) };
        case 0x02: return { k: 'prim', t: 'short', text: String(this.i16()) };
        case 0x03: return { k: 'prim', t: 'int', text: String(this.i32()) };
        case 0x04: return { k: 'prim', t: 'long', text: this.i64().toString() };
        case 0x08: { const v = this.f32(); return { k: 'prim', t: 'float', text: numText(v) }; }
        case 0x09: { const v = this.f64(); return { k: 'prim', t: 'double', text: numText(v) }; }
        case 0x0E: { const c = this.u16(); return { k: 'prim', t: 'char', text: String.fromCharCode(c), code: c }; }
        case 0x0F: { const b = this.u8(); return { k: 'prim', t: 'boolean', text: b ? 'true' : 'false' }; }
        default: throw new DecodeError('Not a primitive tag: 0x' + hex2(tag));
      }
    }

    readClassRefInfo() {
      let dims = 0, tag;
      for (; ;) {
        tag = this.u8();
        if (tag === 0x30) { dims++; continue; }
        break;
      }
      let name;
      if (tag === 0x80 || tag === 0x40) name = this.shortString();
      else if (tag === 0x41) name = 'class';
      else if (tag === 0x20) name = 'string';
      else if (isPrimitiveTag(tag)) name = PRIM_NAME[tag];
      else if (tag >= 0x10 && tag <= 0x1F) name = PRIM_NAME[tag - 0x10] + ' (boxed)';
      else throw new DecodeError('Invalid class reference tag 0x' + hex2(tag));
      return { dims, tag, name };
    }

    readArrayBody() {
      const comp = this.readClassRefInfo();
      const n = this.uint();
      const items = [];
      if (comp.dims === 0 && isPrimitiveTag(comp.tag)) {
        for (let i = 0; i < n; i++) items.push(this.readPrimitiveRaw(comp.tag));
      } else {
        for (let i = 0; i < n; i++) items.push(this.readValue());
      }
      return { k: 'array', component: comp.name + '[]'.repeat(comp.dims), count: n, items };
    }

    readObjectBody(type) {
      const n = this.ushort();
      const fields = [];
      for (let i = 0; i < n; i++) {
        const name = this.shortString();
        const value = this.readValue();
        fields.push({ name, value });
      }
      return { k: 'object', type, fields };
    }

    readValue() {
      const tag = this.u8();
      if (tag === 0x00) return { k: 'null' };
      if (tag >= 0x01 && tag <= 0x0F) return this.readPrimitiveRaw(tag);
      if (tag >= 0x10 && tag <= 0x1F) { this.objCount++; return this.readPrimitiveRaw(tag - 0x10); }
      switch (tag) {
        case 0x20: { this.objCount++; return { k: 'string', v: this.str() }; }
        case 0x30: { this.objCount++; return this.readArrayBody(); }
        case 0x40: { this.objCount++; return { k: 'enum', type: this.shortString(), id: this.shortString() }; }
        case 0x41: { this.objCount++; const info = this.readClassRefInfo(); return { k: 'class', type: info.name + '[]'.repeat(info.dims) }; }
        case 0x80: { this.objCount++; const type = this.shortString(); return this.readObjectBody(type); }
        case 0xFF: { const id = this.uint(); return { k: 'ref', id }; }
        default: throw new DecodeError('Unknown tag 0x' + hex2(tag) + ' at byte ' + (this.p - 1));
      }
    }

  }
  /* Decodes one payload. `type` is the type name from the CSV, `bytes` is the payload.
     Returns a summary, key/value fields, notes, the parsed tree, and any decode error. */
  function decodeRoot(type, bytes) {
    const t = String(type || '').toLowerCase();
    let r = new Reader(bytes, type);
    let node = null, exact = true, error = null;

    if (t === 'null') {
      node = { k: 'null' };
    } else if (ROOT_PRIM[t]) {
      try {
        node = r.readPrimitiveRaw(ROOT_PRIM[t]);
        if (!r.eof()) exact = false;
      } catch (e) { error = e; }
    } else if (t === 'string' || t === 'text') {
      try {
        node = { k: 'string', v: r.str() };
        if (!r.eof()) exact = false;
      } catch (e) { error = e; }
    } else {
      let obj = null, objErr = null;
      try {
        r = new Reader(bytes, type);
        obj = r.readObjectBody(type);
        if (!r.eof()) { objErr = new DecodeError('Trailing bytes after object'); obj = null; }
      } catch (e) { objErr = e; obj = null; }
      if (obj) {
        node = obj;
      } else {
        let en = null, enErr = null;
        try {
          const r2 = new Reader(bytes, type);
          const id = r2.shortString();
          if (!r2.eof()) enErr = new DecodeError('Trailing bytes after enum');
          else en = { k: 'enum', type, id };
        } catch (e) { enErr = e; }
        if (en) {
          node = en;
        } else {
          error = objErr || enErr || new DecodeError('Could not decode payload');
          try {
            const r3 = new Reader(bytes, type);
            node = r3.readObjectBody(type);
            exact = false;
          } catch (e) {
            node = { k: 'raw', hex: bytesToHex(bytes) };
          }
        }
      }
    }
    if (!node) node = { k: 'raw', hex: bytesToHex(bytes) };
    const notes = [];
    if (error && node.k !== 'raw') notes.push('Decoder error: ' + error.message);
    if (!exact && node.k !== 'raw' && !notes.length) notes.push('Payload has trailing bytes; showing the part that decoded.');
    if (node.k === 'raw') notes.push('Could not decode this payload as an object or enum.');
    const desc = describe(type, node);
    return {
      ok: !error,
      node,
      summary: desc.summary,
      fields: desc.fields,
      notes: notes.concat(desc.notes || []),
      code: desc.code || null,
      exact,
      size: bytes.length,
      trailing: exact ? 0 : Math.max(0, bytes.length - r.p),
      error: error ? error.message : null
    };
  }

  function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function fieldMap(node) {
    const out = Object.create(null);
    if (node && node.k === 'object') for (const f of node.fields) out[f.name] = f.value;
    return out;
  }

  function strValue(node) {
    if (!node) return null;
    if (node.k === 'string') return node.v;
    if (node.k === 'prim') return node.text;
    return null;
  }

  function primTextOf(node) {
    if (!node) return '-';
    if (node.k === 'prim') return node.t === 'char' ? node.text : node.text;
    if (node.k === 'string') return node.v;
    if (node.k === 'null') return 'null';
    if (node.k === 'ref') return '↩ #' + node.id;
    return '-';
  }

  function primText(node) {
    if (!node || node.k !== 'prim') return '-';
    if (node.t === 'char') {
      const c = node.code || 0;
      return JSON.stringify(node.text) + ' (U+' + c.toString(16).toUpperCase().padStart(4, '0') + ')';
    }
    return node.text;
  }

  function worldName(node) {
    if (!node) return '-';
    if (node.k === 'ref') return '↩ #' + node.id;
    if (node.k === 'string') return node.v;
    if (node.k === 'object') {
      const n = strValue(fieldMap(node)['name']);
      return n != null ? n : '(world)';
    }
    return '-';
  }

  function uuidText(a, b) {
    try {
      const hi = BigInt(a), lo = BigInt(b);
      const M64 = (1n << 64n) - 1n, M128 = (1n << 128n) - 1n;
      const u = ((hi << 64n) | (lo & M64)) & M128;
      const h = u.toString(16).padStart(32, '0');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    } catch (e) { return null; }
  }

  function uuidFromNode(node) {
    if (!node) return null;
    if (node.k === 'ref') return '↩ #' + node.id;
    if (node.k !== 'object') return null;
    const f = fieldMap(node);
    return uuidText(primTextOf(f['mostsignificantbits']), primTextOf(f['leastsignificantbits']));
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '-';
    const neg = ms < 0;
    ms = Math.abs(ms);
    const units = [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
    const parts = [];
    let rem = ms;
    for (const [u, size] of units) {
      const v = Math.floor(rem / size);
      if (v > 0) { parts.push(v + u); rem -= v * size; }
    }
    if (rem > 0 || parts.length === 0) parts.push(rem + 'ms');
    return (neg ? '-' : '') + parts.join(' ');
  }

  function briefNode(node) {
    if (!node) return 'null';
    switch (node.k) {
      case 'prim': return primText(node);
      case 'string': { const s = node.v; return JSON.stringify(s.length > 80 ? s.slice(0, 80) + '…' : s); }
      case 'enum': return node.type + '.' + node.id;
      case 'class': return 'class ' + node.type;
      case 'object': return node.type + ' (' + node.fields.length + ' field' + (node.fields.length === 1 ? '' : 's') + ')';
      case 'array': return node.component + '[' + node.count + ']';
      case 'ref': return '↩ #' + node.id;
      case 'null': return 'null';
      default: return node.k;
    }
  }

  /* Turns a decoded node into the summary and key/value rows the detail pane shows. */
  function describe(type, node) {
    const notes = [];
    let fields = [];
    let summary = '';
    let code = null;
    if (!node) return { summary: '(missing)', fields, notes, code };
    if (node.k === 'null') return { summary: 'null', fields: [['Value', 'null']], notes, code };
    if (node.k === 'raw') return { summary: 'raw bytes (' + (node.hex.length / 2) + ' bytes)', fields: [['Raw hex', node.hex]], notes: ['Payload could not be decoded.'], code };
    if (node.k === 'prim') return { summary: primText(node), fields: [['Type', node.t], ['Value', primText(node)]], notes, code };
    if (node.k === 'string') {
      const v = node.v;
      summary = JSON.stringify(v.length > 200 ? v.slice(0, 200) + '…' : v);
      fields = [['Length', String(v.length)], ['Value', v.length > 4000 ? v.slice(0, 4000) + '…' : v]];
      return { summary, fields, notes, code };
    }
    if (node.k === 'enum') {
      return { summary: node.id, fields: [['Enum type', node.type], ['Constant ID', node.id], ['Likely constant', node.id.toUpperCase()]], notes, code };
    }
    if (node.k === 'class') return { summary: node.type, fields: [['Class', node.type]], notes, code };
    if (node.k === 'ref') {
      notes.push('A back-reference to an object serialized earlier in this value.');
      return { summary: 'reference #' + node.id, fields: [['Reference', '#' + node.id]], notes, code };
    }
    if (node.k === 'array') {
      summary = node.component + '[' + node.count + ']';
      return { summary, fields: [['Component', node.component], ['Length', String(node.count)]], notes, code };
    }
    if (node.k === 'truncated') return { summary: '… (' + node.reason + ')', fields, notes, code };
    if (node.k !== 'object') return { summary: String(node.k), fields, notes, code };
    const t = String(type || node.type || '').toLowerCase();
    const f = fieldMap(node);
    const fv = (name) => f[name];

    if (t === 'world') {
      const name = strValue(fv('name'));
      summary = name != null ? JSON.stringify(name) : 'world (name missing)';
      fields = [['World name', name != null ? name : '-']];
      notes.push('Stored by name; Skript resolves it with Bukkit.getWorld(name) when loading.');
    } else if (t === 'location') {
      const w = worldName(fv('world'));
      const x = primTextOf(fv('x')), y = primTextOf(fv('y')), z = primTextOf(fv('z'));
      const yaw = primTextOf(fv('yaw')), pitch = primTextOf(fv('pitch'));
      summary = w + ' @ ' + x + ', ' + y + ', ' + z + '  (yaw ' + yaw + ', pitch ' + pitch + ')';
      fields = [['World', w], ['X', x], ['Y', y], ['Z', z], ['Yaw', yaw], ['Pitch', pitch]];
    } else if (t === 'vector') {
      const x = primTextOf(fv('x')), y = primTextOf(fv('y')), z = primTextOf(fv('z'));
      summary = x + ', ' + y + ', ' + z;
      fields = [['X', x], ['Y', y], ['Z', z]];
    } else if (t === 'uuid') {
      const msb = primTextOf(fv('mostsignificantbits')), lsb = primTextOf(fv('leastsignificantbits'));
      const u = uuidText(msb, lsb);
      summary = u || 'uuid (unreadable)';
      fields = [['UUID', u || '—']];
    } else if (t === 'date') {
      const ts = primTextOf(fv('timestamp'));
      const n = Number(ts);
      if (Number.isFinite(n)) {
        const d = new Date(n);
        summary = d.toISOString() + '  (' + ts + ' ms)';
        fields = [['Timestamp (ms)', ts], ['UTC', d.toISOString()], ['Local', d.toString()]];
      } else {
        summary = 'date (unreadable timestamp)';
        fields = [['Timestamp (ms)', ts]];
      }
    } else if (t === 'itemstack' || t === 'itemtype') {
      const yaml = strValue(fv('value'));
      const info = yaml ? itemInfo(yaml) : null;
      if (info && info.type) {
        summary = info.type + (info.amount && info.amount !== '1' ? ' x' + info.amount : '') + (info.name ? ' - ' + info.name : '');
        fields = [['Item type', info.type], ['Amount', info.amount || '1']];
        if (info.name) fields.push(['Display name', info.name]);
        if (info.lore && info.lore.length) fields.push(['Lore', info.lore.join(' | ')]);
        if (info.enchants && info.enchants.length) fields.push(['Enchantments', info.enchants.join(', ')]);
      } else {
        summary = 'itemstack (YAML)';
        fields = [['YAML length', yaml ? String(yaml.length) : '-']];
      }
      if (yaml) {
        code = { label: 'Embedded YAML', text: yaml };
        notes.push('Skript stores items as a YAML string (ConfigurationSerializer).');
      }
    } else if (t === 'blockdata') {
      const v = strValue(fv('value')) || strValue(fv('data'));
      summary = v ? oneLine(v).slice(0, 200) : 'blockdata';
      fields = v ? [['Value', v]] : [];
      if (v) code = { label: 'Block data', text: v };
    } else if (t === 'material') {
      const i = primTextOf(fv('i'));
      summary = 'material #' + i;
      fields = [['Ordinal', i]];
      notes.push('Material is stored as its ordinal; the name depends on the server Minecraft version.');
    } else if (t === 'block') {
      const w = worldName(fv('world'));
      const x = primTextOf(fv('x')), y = primTextOf(fv('y')), z = primTextOf(fv('z'));
      summary = w + ' @ ' + x + ', ' + y + ', ' + z;
      fields = [['World', w], ['X', x], ['Y', y], ['Z', z]];
    } else if (t === 'chunk') {
      const w = worldName(fv('world'));
      const x = primTextOf(fv('x')), z = primTextOf(fv('z'));
      summary = w + ' @ chunk ' + x + ', ' + z;
      fields = [['World', w], ['Chunk X', x], ['Chunk Z', z]];
    } else if (t === 'offlineplayer' || t === 'player') {
      const u = uuidFromNode(fv('uuid'));
      summary = u || 'offline player';
      fields = [['UUID', u || '-']];
      notes.push('Players are stored by UUID; names cannot be resolved offline.');
    } else if (t === 'timespan') {
      const ms = primTextOf(fv('millis'));
      const n = Number(ms);
      summary = formatDuration(n);
      fields = [['Milliseconds', ms], ['Ticks', Number.isFinite(n) ? String(Math.round(n / 50)) : '-'], ['Human', formatDuration(n)]];
    } else {
      summary = (node.type || 'object') + ' · ' + node.fields.length + ' field' + (node.fields.length === 1 ? '' : 's');
      fields = node.fields.map((x) => [x.name, briefNode(x.value)]);
    }
    return { summary, fields, notes, code };
  }

  function unquote(s) {
    s = String(s == null ? '' : s);
    if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
      try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); }
    }
    return s;
  }

  function extractBlock(text, key) {
    const lines = String(text).split(/\r?\n/);
    const re = new RegExp('^\\s*' + key + ':\\s*$');
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (re.test(lines[i])) { idx = i; break; } }
    if (idx < 0) return [];
    const base = (lines[idx].match(/^\s*/) || [''])[0].length;
    const out = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) continue;
      const ind = (l.match(/^\s*/) || [''])[0].length;
      const t = l.trim();
      if (ind < base) break;
      if (ind === base && !t.startsWith('-')) break;
      out.push(t);
    }
    return out;
  }

  function itemInfo(text) {
    const first = (re) => { const m = String(text).match(re); return m ? unquote(m[1].trim()) : null; };

    const type = first(/^\s*type:\s*(.+)$/m);
    const amount = first(/^\s*amount:\s*(.+)$/m);
    const name = first(/^\s*display-name:\s*(.+)$/m);
    const lore = extractBlock(text, 'lore').map((l) => unquote(l.replace(/^-\s*/, '').trim())).filter(Boolean);
    const enchants = [];
    for (const l of extractBlock(text, 'enchants')) {
      const m = l.match(/^(.+?):\s*(.+)$/);
      if (m) enchants.push(unquote(m[1].trim()) + ' ' + unquote(m[2].trim()));
    }
    return { type, amount, name, lore, enchants };
  }

  function hexVal(c) {
    if (c >= 48 && c <= 57) return c - 48;
    if (c >= 97 && c <= 102) return c - 87;
    if (c >= 65 && c <= 70) return c - 55;
    return -1;
  }

  /* Turns a hex string into bytes, or null when it is not valid hex. */
  function hexToBytes(s) {
    if (typeof s !== 'string' || (s.length & 1) !== 0) return null;
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) {
      const hi = hexVal(s.charCodeAt(2 * i)), lo = hexVal(s.charCodeAt(2 * i + 1));
      if (hi < 0 || lo < 0) return null;
      out[i] = (hi << 4) | lo;
    }
    return out;
  }

  /* Bytes to a plain lowercase hex string. */
  function bytesToHex(bytes) {
    if (!bytes) return '';
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]];
    return s;
  }

  /* The classic offset / hex / ASCII dump of a payload, 16 bytes per line. */
  function prettyHex(bytes) {
    if (!bytes || !bytes.length) return '(empty payload)';
    const lines = [];
    for (let off = 0; off < bytes.length; off += 16) {
      const chunk = bytes.subarray(off, off + 16);
      let hex = '', asc = '';
      for (let i = 0; i < 16; i++) {
        if (i < chunk.length) {
          const b = chunk[i];
          hex += HEX[b] + ' ';
          asc += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
        } else { hex += '   '; asc += ' '; }
      }
      lines.push(off.toString(16).padStart(4, '0') + '  ' + hex + ' ' + asc);
    }
    return lines.join('\n');
  }

  /* Caps a decoded tree so huge payloads cannot freeze the page. */
  function trimNode(node, depth, state) {
    state = state || { nodes: 0 };
    if (!node) return node;
    if (++state.nodes > 6000) return { k: 'truncated', reason: 'node budget' };
    if (depth > 12) return { k: 'truncated', reason: 'depth limit' };
    if (node.k === 'object') {
      const kept = node.fields.slice(0, 300);
      return { k: 'object', type: node.type, fields: kept.map((f) => ({ name: f.name, value: trimNode(f.value, depth + 1, state) })), omitted: node.fields.length - kept.length };
    }
    if (node.k === 'array') {
      const kept = node.items.slice(0, 800);
      return { k: 'array', component: node.component, count: node.count, items: kept.map((x) => trimNode(x, depth + 1, state)), omitted: node.items.length - kept.length };
    }
    if (node.k === 'string' && node.v.length > 4000) {
      return { k: 'string', v: node.v.slice(0, 4000), omitted: node.v.length - 4000 };
    }
    return node;
  }

  /* Splits one CSV line into fields, honouring quotes. Returns null on a syntax error. */
  function splitCsvLine(line) {
    const out = [];
    let i = 0;
    const n = line.length;
    const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;
    for (;;) {
      while (i < n && isWs(line.charCodeAt(i))) i++;
      let val;
      if (i < n && line.charCodeAt(i) === 34) {
        i++;
        let s = '', closed = false;
        while (i < n) {
          const c = line.charCodeAt(i);
          if (c === 34) {
            if (i + 1 < n && line.charCodeAt(i + 1) === 34) { s += '"'; i += 2; continue; }
            i++; closed = true; break;
          }
          s += line[i]; i++;
        }
        if (!closed) return null;
        while (i < n && isWs(line.charCodeAt(i))) i++;
        val = s;
      } else {
        const start = i;
        while (i < n) {
          const c = line.charCodeAt(i);
          if (c === 34 || c === 44) break;
          i++;
        }
        if (i < n && line.charCodeAt(i) === 34) return null;
        val = line.slice(start, i).trim();
      }
      out.push(val);
      if (i >= n) return out;
      if (line.charCodeAt(i) === 44) { i++; continue; }
      return null;
    }
  }

  return { decodeRoot, describe, trimNode, hexToBytes, bytesToHex, prettyHex, splitCsvLine, oneLine, formatDuration };
};
