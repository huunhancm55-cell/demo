'use strict';
/* Hồ sơ xuất ra: Excel (.xlsx), bản in báo giá / khái toán, soạn hợp đồng (in, Word) */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const cityOf = addr => (String(addr || '').split(',').pop() || '').replace(/^\s*(tỉnh|tp\.?|thành phố)\s+/i, '').trim();
const dateLong = iso => {
  const [y, m, d] = String(iso || '').split('-');
  return y ? `ngày ${d} tháng ${m} năm ${y}` : 'ngày …… tháng …… năm ……';
};
const safeName = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
const docFileName = (q, ext) => `${safeName(q.no || 'Bao gia')} - ${safeName(pname(q.projectId))}.${ext}`;
// Chia tiền theo đợt; đợt cuối nhận phần còn lại để tổng khớp tuyệt đối khi đủ 100%
function payAmounts(total, pays) {
  const a = pays.map(p => Math.round(total * (+p.pct || 0) / 100));
  if (a.length && Math.abs(pays.reduce((t, p) => t + (+p.pct || 0), 0) - 100) < 1e-9) a[a.length - 1] = total - a.slice(0, -1).reduce((t, x) => t + x, 0);
  return a;
}
function totalDays(pays) {
  let lo = 0, hi = 0;
  for (const p of pays) {
    const m = /(\d+)\D+(\d+)/.exec(p.days || '') || /(\d+)/.exec(p.days || '');
    if (!m) return '';
    lo += +m[1]; hi += +(m[2] || m[1]);
  }
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}
const groupSum = (q, idx, t) => { let g = 0; for (let j = idx + 1; j < q.items.length && !q.items[j].head; j++) g += t.line(q.items[j]); return g; };
const designPays = q => (q.ct && q.ct.form === 'design' && q.ct.pay && q.ct.pay.length ? q.ct.pay : FORMS.design.pay);

// ======================= Excel (.xlsx) không cần thư viện =======================
const XL = (() => {
  const enc = new TextEncoder();
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  // Gói zip không nén (Excel đọc được bình thường)
  function zip(files, type) {
    const parts = [], cd = [];
    let off = 0;
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, text] of files) {
      const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, nm.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    const size = cd.reduce((t, a) => t + a.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true); e.setUint16(20, 0, true);
    return new Blob([...parts, ...cd, new Uint8Array(e.buffer)], { type });
  }
  const xe = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colL = c => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; };
  const FONT = 'Times New Roman';

  function book() {
    const fonts = [`<font><sz val="12"/><name val="${FONT}"/></font>`];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    const cache = new Map();
    const idx = (arr, x) => { let i = arr.indexOf(x); if (i < 0) { arr.push(x); i = arr.length - 1; } return i; };
    const side = n => `<${n} style="thin"><color rgb="FF8C8C8C"/></${n}>`;
    // o: { b, i, sz, color, fill, border, h, v, wrap, fmt }   fmt: 3 = #,##0 · 164 = #,##0.00 · 165 = 0"%"
    function style(o = {}) {
      const key = JSON.stringify(o);
      if (cache.has(key)) return cache.get(key);
      const font = `<font>${o.b ? '<b/>' : ''}${o.i ? '<i/>' : ''}<sz val="${o.sz || 12}"/>${o.color ? `<color rgb="FF${o.color}"/>` : ''}<name val="${FONT}"/></font>`;
      const fi = idx(fonts, font);
      const fl = o.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const bd = o.border ? idx(borders, `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`) : 0;
      const al = `<alignment${o.h ? ` horizontal="${o.h}"` : ''} vertical="${o.v || 'center'}"${o.wrap ? ' wrapText="1"' : ''}/>`;
      xfs.push(`<xf numFmtId="${o.fmt || 0}" fontId="${fi}" fillId="${fl}" borderId="${bd}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`);
      cache.set(key, xfs.length - 1);
      return xfs.length - 1;
    }
    const stylesXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0&quot;%&quot;"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

    const sheets = [];
    function sheet(name, widths, opt = {}) {
      const rows = new Map(), merges = [], heights = {};
      const cell = (r, c) => { if (!rows.has(r)) rows.set(r, new Map()); const m = rows.get(r); if (!m.has(c)) m.set(c, {}); return m.get(c); };
      const sh = {
        name, widths, opt,
        put(r, c, v, s) { Object.assign(cell(r, c), { v, s }); return `${colL(c)}${r}`; },
        fx(r, c, f, v, s) { Object.assign(cell(r, c), { f, v, s }); return `${colL(c)}${r}`; },
        // Gộp ô; tô kiểu cho mọi ô trong vùng để viền liền
        merge(r1, c1, r2, c2, s) {
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const x = cell(r, c); if (x.s == null) x.s = s; }
          if (r1 !== r2 || c1 !== c2) merges.push(`${colL(c1)}${r1}:${colL(c2)}${r2}`);
        },
        height(r, h) { heights[r] = h; },
        xml() {
          const rr = [...rows.keys()].sort((a, b) => a - b).map(r => {
            const cs = [...rows.get(r).entries()].sort((a, b) => a[0] - b[0]).map(([c, x]) => {
              const ref = colL(c) + r, s = x.s ? ` s="${x.s}"` : '';
              if (x.f != null) return `<c r="${ref}"${s}><f>${xe(x.f)}</f>${typeof x.v === 'number' ? `<v>${x.v}</v>` : ''}</c>`;
              if (x.v == null || x.v === '') return `<c r="${ref}"${s}/>`;
              if (typeof x.v === 'number') return `<c r="${ref}"${s}><v>${x.v}</v></c>`;
              return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xe(x.v)}</t></is></c>`;
            }).join('');
            return `<row r="${r}"${heights[r] ? ` ht="${heights[r]}" customHeight="1"` : ''}>${cs}</row>`;
          }).join('');
          return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rr}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${opt.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
        },
      };
      sheets.push(sh);
      return sh;
    }
    function blob() {
      const files = [
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
        ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
        ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
        ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml()]),
        ['xl/styles.xml', stylesXml()],
      ];
      return zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    return { style, sheet, blob };
  }
  return { book, colL };
})();

// Ước lượng chiều cao dòng cho chữ xuống dòng (Excel không tự giãn dòng khi mở file)
const rowHeight = (text, chars, line = 15.5) => Math.max(18, Math.ceil(String(text || '').length / Math.max(8, chars)) * line + 3);

function quoteXlsx(q) {
  const F = FORMS[q.form] || {}, p = proj(q.projectId) || {}, s = S.settings, t = qTotal(q), K = !!q.coef, L = XL.colL;
  const W = K ? [6, 36, 8, 11, 9, 12, 15, 18] : [6, 44, 9, 13, 16, 19];
  const N = W.length, last = N - 1, cQ = K ? 5 : 3, cP = K ? 6 : 4, cT = K ? 7 : 5;
  const wb = XL.book(), sh = wb.sheet('Báo giá', W);
  const BLUE = '2AA8E0', LIGHT = 'E6F4FB', NAVY = '1F5F99';
  const st = {
    co: wb.style({ b: 1, sz: 14, color: NAVY, h: 'center' }), lineB: wb.style({ b: 1, sz: 11, h: 'center' }), line: wb.style({ sz: 11, h: 'center' }),
    title: wb.style({ b: 1, sz: 18, h: 'center' }), sub: wb.style({ i: 1, sz: 11, h: 'center' }),
    kv: wb.style({ sz: 12, wrap: 1 }), bold: wb.style({ b: 1 }),
    th: wb.style({ b: 1, sz: 11, color: 'FFFFFF', fill: BLUE, border: 1, h: 'center', wrap: 1 }),
    gC: wb.style({ b: 1, fill: LIGHT, border: 1, h: 'center' }), gT: wb.style({ b: 1, fill: LIGHT, border: 1, wrap: 1 }), gN: wb.style({ b: 1, fill: LIGHT, border: 1, fmt: 3 }), gE: wb.style({ fill: LIGHT, border: 1 }),
    c: wb.style({ border: 1, h: 'center' }), txt: wb.style({ border: 1, wrap: 1 }), q2: wb.style({ border: 1, fmt: 164 }), pc: wb.style({ border: 1, fmt: 165, h: 'center' }), m: wb.style({ border: 1, fmt: 3 }),
    sumL: wb.style({ b: 1, border: 1, h: 'right' }), sumN: wb.style({ b: 1, border: 1, fmt: 3 }),
    totL: wb.style({ b: 1, sz: 13, color: 'FFFFFF', fill: BLUE, border: 1, h: 'center' }), totN: wb.style({ b: 1, sz: 13, color: 'FFFFFF', fill: BLUE, border: 1, fmt: 3 }),
    words: wb.style({ i: 1, wrap: 1 }), note: wb.style({ wrap: 1, v: 'top' }), payL: wb.style({ wrap: 1 }), payN: wb.style({ fmt: 3 }), payB: wb.style({ b: 1, fmt: 3 }),
    sign: wb.style({ i: 1, h: 'center' }), signB: wb.style({ b: 1, h: 'center', wrap: 1 }),
  };
  const widthAll = W.reduce((a, b) => a + b, 0);
  let r = 1;
  const full = (text, style, ht) => { sh.merge(r, 0, r, last, style); sh.put(r, 0, text, style); if (ht) sh.height(r, ht); r++; };
  full((s.company || '').toUpperCase(), st.co, 22);
  if (s.address) full(`Địa chỉ: ${s.address}`, st.lineB);
  full([s.phone && `Hotline/Zalo: ${s.phone}`, s.tax && `MST: ${s.tax}`].filter(Boolean).join('    ·    '), st.line);
  r++;
  full(F.title || 'BẢNG BÁO GIÁ', st.title, 28);
  full(`Số: ${q.no || ''}    ·    Ngày ${fdate(q.date)}`, st.sub);
  r++;
  const kv = (k, v) => { if (!v) return; const tx = `${k}: ${v}`; full(tx, st.kv, rowHeight(tx, widthAll * 1.05)); };
  kv('Kính gửi', q.customer || p.client); kv('Công trình', p.name); kv('Địa điểm', p.address); kv('Nội dung', q.title);
  for (const i of q.info || []) if (i.k && i.v) kv(i.k, i.v);
  if (t.dz) kv('Đơn giá thiết kế', `${dzFormula(t.dz)} = ${fmt(t.dz.unit)} đ/m²`);
  r++;
  const hdr = K ? ['STT', 'NỘI DUNG CÔNG VIỆC', 'ĐVT', 'DIỆN TÍCH (m²)', 'HỆ SỐ', 'KHỐI LƯỢNG QUY ĐỔI', 'ĐƠN GIÁ (VNĐ)', 'THÀNH TIỀN (VNĐ)']
    : ['STT', 'NỘI DUNG CÔNG VIỆC', 'ĐVT', 'KHỐI LƯỢNG (tạm tính)', 'ĐƠN GIÁ (VNĐ)', 'THÀNH TIỀN (VNĐ)'];
  hdr.forEach((h, c) => sh.put(r, c, h, st.th)); sh.height(r, K ? 50 : 36); r++;

  const top = [];
  let grp = null, n = 0, gi = 0;
  const close = () => { if (grp) sh.fx(grp.row, cT, grp.to >= grp.from ? `SUM(${L(cT)}${grp.from}:${L(cT)}${grp.to})` : '0', grp.val, st.gN); };
  for (const it of q.items) {
    if (it.head) {
      close();
      grp = { row: r, from: r + 1, to: r, val: 0 }; n = 0;
      sh.put(r, 0, ROMAN[gi++] || '', st.gC); sh.put(r, 1, it.name, st.gT);
      for (let c = 2; c < cT; c++) sh.put(r, c, '', st.gE);
      top.push(`${L(cT)}${r}`); sh.height(r, rowHeight(it.name, W[1] * 0.95)); r++;
      continue;
    }
    n++;
    const line = t.line(it), auto = K && +it.area > 0 && +it.coef > 0, price = t.dz ? t.dz.unit : (+it.price || 0);
    sh.put(r, 0, n, st.c); sh.put(r, 1, it.name, st.txt); sh.put(r, 2, it.unit || '', st.c);
    if (K) {
      sh.put(r, 3, auto ? +it.area : '', st.q2); sh.put(r, 4, auto ? +it.coef : '', st.pc);
      if (auto) sh.fx(r, cQ, `ROUND(D${r}*E${r}/100,2)`, iq(it), st.q2); else sh.put(r, cQ, iq(it) || '', st.q2);
    } else sh.put(r, cQ, iq(it) || '', st.q2);
    sh.put(r, cP, price || '', st.m);
    sh.fx(r, cT, `ROUND(${L(cQ)}${r}*${L(cP)}${r},0)`, line, st.m);
    sh.height(r, rowHeight(it.name, W[1] * 1.05));
    if (grp) { grp.to = r; grp.val += line; } else top.push(`${L(cT)}${r}`);
    r++;
  }
  close();
  const sumF = top.length ? `SUM(${top.join(',')})` : '0';
  const label = (text, style = st.sumL) => { sh.merge(r, 0, r, cT - 1, style); sh.put(r, 0, text, style); };
  let totF = sumF;
  if (t.minApplied || q.discount || q.vat) {
    label('Tạm tính'); const rawRef = sh.fx(r, cT, sumF, t.raw, st.sumN); r++;
    let subRef = rawRef, discRef = '', vatRef = '';
    if (t.minApplied) { label('Áp phí tối thiểu'); subRef = sh.fx(r, cT, `MAX(${rawRef},${t.dz.min})`, t.sub, st.sumN); r++; }
    if (q.discount) { label(`Giảm giá ${fmt(q.discount)}%`); discRef = sh.fx(r, cT, `-ROUND(${subRef}*${+q.discount}/100,0)`, -t.disc, st.sumN); r++; }
    if (q.vat) { label(`Thuế VAT ${fmt(q.vat)}%`); vatRef = sh.fx(r, cT, `ROUND((${subRef}${discRef ? '+' + discRef : ''})*${+q.vat}/100,0)`, t.vat, st.sumN); r++; }
    totF = [subRef, discRef, vatRef].filter(Boolean).join('+');
  }
  label('TỔNG CỘNG', st.totL); const totRef = sh.fx(r, cT, totF, t.total, st.totN); sh.height(r, 24); r++;
  const words = `Bằng chữ: ${docSo(t.total)}.${q.vat ? '' : ' Giá chưa gồm thuế VAT.'}`;
  full(words, st.words, rowHeight(words, widthAll * 1.05));

  if (q.form === 'design') {
    const pays = designPays(q), am = payAmounts(t.total, pays);
    r++; full('THANH TOÁN THEO TIẾN ĐỘ', st.bold);
    const payRefs = [];
    pays.forEach((x, i) => {
      const tx = `Đợt ${i + 1} (${fmt(x.pct)}%) – ${x.label}${x.days ? ` · ${x.days}` : ''}`;
      sh.merge(r, 0, r, cT - 1, st.payL); sh.put(r, 0, tx, st.payL);
      const f = i === pays.length - 1 && payRefs.length ? `${totRef}-${payRefs.join('-')}` : `ROUND(${totRef}*${+x.pct}/100,0)`;
      payRefs.push(sh.fx(r, cT, f, am[i], st.payN)); r++;
    });
    const P = t.dz.P;
    if (P.offer) {
      r++; full('ƯU ĐÃI KHI KÝ THI CÔNG TRONG 6 THÁNG', st.bold);
      for (const [lb, k] of P.offer) { sh.merge(r, 0, r, cT - 1, st.payL); sh.put(r, 0, lb, st.payL); sh.fx(r, cT, `ROUND((${totRef}-${t.vat})*${k},0)`, Math.round((t.total - t.vat) * k), st.payB); r++; }
    }
  }
  const notes = (q.note || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (notes.length) { r++; full('Ghi chú:', st.bold); notes.forEach(x => full(`• ${x}`, st.note, rowHeight(x, widthAll * 1.05))); }
  r++;
  const half = 2, rightW = W.slice(half).reduce((a, b) => a + b, 0);
  sh.merge(r, 0, r, half - 1, st.kv); sh.put(r, 0, 'Mọi chi tiết xin vui lòng liên hệ:', st.kv);
  sh.merge(r, half, r, last, st.sign); sh.put(r, half, `${cityOf(s.address) || '……'}, ${dateLong(q.date)}`, st.sign); r++;
  sh.merge(r, 0, r, half - 1, st.bold); sh.put(r, 0, s.phone ? `Hotline/Zalo: ${s.phone}` : '', st.bold);
  sh.merge(r, half, r, last, st.signB); sh.put(r, half, (s.company || '').toUpperCase(), st.signB); sh.height(r, rowHeight(s.company, rightW * 0.75));
  return wb.blob();
}

function costsXlsx(list) {
  const wb = XL.book(), W = [12, 26, 7, 14, 36, 22, 16], sh = wb.sheet('Thu chi', W);
  const st = {
    title: wb.style({ b: 1, sz: 15, h: 'center' }), sub: wb.style({ i: 1, sz: 11, h: 'center' }),
    th: wb.style({ b: 1, sz: 11, color: 'FFFFFF', fill: '2AA8E0', border: 1, h: 'center', wrap: 1 }),
    c: wb.style({ border: 1, h: 'center' }), txt: wb.style({ border: 1, wrap: 1 }), m: wb.style({ border: 1, fmt: 3 }),
    sumL: wb.style({ b: 1, border: 1, h: 'right' }), sumN: wb.style({ b: 1, border: 1, fmt: 3 }),
  };
  let r = 1;
  sh.merge(r, 0, r, 6, st.title); sh.put(r, 0, 'BẢNG THEO DÕI THU CHI', st.title); sh.height(r, 24); r++;
  sh.merge(r, 0, r, 6, st.sub); sh.put(r, 0, `${S.ui.pid ? pname(S.ui.pid) : 'Tất cả dự án'} · Xuất ngày ${fdate(today())}`, st.sub); r += 2;
  ['Ngày', 'Dự án', 'Loại', 'Nhóm', 'Nội dung', 'Nhà cung cấp / người nhận', 'Số tiền (₫)'].forEach((h, c) => sh.put(r, c, h, st.th)); sh.height(r, 30); r++;
  const from = r;
  for (const c of list) {
    sh.put(r, 0, fdate(c.date), st.c); sh.put(r, 1, pname(c.projectId), st.txt); sh.put(r, 2, c.type === 'thu' ? 'Thu' : 'Chi', st.c);
    sh.put(r, 3, c.type === 'thu' ? '' : (c.cat || ''), st.c); sh.put(r, 4, c.desc || '', st.txt); sh.put(r, 5, c.vendor || '', st.txt);
    sh.put(r, 6, c.type === 'thu' ? +c.amount || 0 : -(+c.amount || 0), st.m); r++;
  }
  const to = r - 1, thu = list.filter(c => c.type === 'thu').reduce((t, c) => t + (+c.amount || 0), 0), chi = list.filter(c => c.type !== 'thu').reduce((t, c) => t + (+c.amount || 0), 0);
  const rows = [['Tổng thu', `SUMIF(C${from}:C${to},"Thu",G${from}:G${to})`, thu], ['Tổng chi', `-SUMIF(C${from}:C${to},"Chi",G${from}:G${to})`, chi], ['Thu − Chi', `SUM(G${from}:G${to})`, thu - chi]];
  for (const [lb, f, v] of rows) { sh.merge(r, 0, r, 5, st.sumL); sh.put(r, 0, lb, st.sumL); sh.fx(r, 6, list.length ? f : '0', v, st.sumN); r++; }
  return wb.blob();
}

// ======================= Bản in báo giá / khái toán =======================
const HN_LOGO = `<div class="logo"><svg viewBox="0 0 120 60" aria-hidden="true"><g fill="none" stroke="#2f3237" stroke-width="3" stroke-linejoin="round"><path d="M8 56h104"/><path d="M18 56V30h46v26"/><path d="M12 30h58"/><path d="M58 30V12h46v44"/><path d="M52 12h58"/><path d="M66 21h30M66 29h30M66 37h30"/><path d="M28 56V40h12v16M48 40h10v9H48z"/></g></svg><div class="nm">HỮU NHÂN</div><div class="tg">THIẾT KẾ &amp; XÂY DỰNG</div></div>`;

function itemsTableHTML(q, t, K) {
  const head = K ? '<th class="c">STT</th><th>Nội dung công việc</th><th class="r">Diện tích (m²)</th><th class="r">Hệ số</th><th class="r">KL quy đổi</th><th class="r">Đơn giá (VNĐ)</th><th class="r">Thành tiền (VNĐ)</th>'
    : '<th class="c">STT</th><th>Nội dung công việc</th><th class="c">ĐVT</th><th class="r">Khối lượng</th><th class="r">Đơn giá (VNĐ)</th><th class="r">Thành tiền (VNĐ)</th>';
  const cols = K ? 7 : 6, dash = v => v ? fmt(v) : '–';
  let rows = '', gi = 0, n = 0;
  q.items.forEach((it, idx) => {
    if (it.head) { n = 0; rows += `<tr class="g"><td class="c">${ROMAN[gi++] || ''}</td><td colspan="${cols - 2}">${esc(it.name)}</td><td class="r">${dash(groupSum(q, idx, t))}</td></tr>`; return; }
    n++;
    const auto = +it.area > 0 && +it.coef > 0, kl = iq(it), price = t.dz ? t.dz.unit : +it.price;
    rows += K
      ? `<tr><td class="c">${n}</td><td>${esc(it.name)}</td><td class="r">${auto ? fmt(it.area) : '–'}</td><td class="r">${auto ? fmt(it.coef) + '%' : '–'}</td><td class="r">${auto ? fmt(kl) : kl ? `${fmt(kl)} ${esc(it.unit)}` : '–'}</td><td class="r">${dash(price)}</td><td class="r">${dash(t.line(it))}</td></tr>`
      : `<tr><td class="c">${n}</td><td>${esc(it.name)}</td><td class="c">${esc(it.unit)}</td><td class="r">${dash(kl)}</td><td class="r">${dash(price)}</td><td class="r">${dash(t.line(it))}</td></tr>`;
  });
  return `<table class="t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
function totalsHTML(q, t, label) {
  const lines = [];
  if (t.minApplied || q.discount || q.vat) {
    lines.push(['Tạm tính', money(t.raw)]);
    if (t.minApplied) lines.push(['Áp phí tối thiểu', money(t.sub)]);
    if (q.discount) lines.push([`Giảm giá ${fmt(q.discount)}%`, '−' + money(t.disc)]);
    if (q.vat) lines.push([`Thuế VAT ${fmt(q.vat)}%`, '+' + money(t.vat)]);
  }
  return (lines.length ? `<table class="sum">${lines.map(([a, b]) => `<tr><td>${a}</td><td class="r">${b}</td></tr>`).join('')}</table>` : '')
    + `<div class="band"><div class="l">${label}</div><div class="v">${fmt(t.total)} đ</div></div>`
    + `<div class="words">Bằng chữ: ${docSo(t.total)}.${q.vat ? '' : ' Giá chưa gồm thuế VAT.'}</div>`;
}
function quoteDocHTML(q) {
  const F = FORMS[q.form] || {}, p = proj(q.projectId) || {}, s = S.settings, t = qTotal(q), K = !!q.coef;
  let n = 0;
  const H = x => `<h2><i>${++n}</i>${x}</h2>`;
  const sub = [p.name || q.customer, p.address, `Ngày ${fdate(q.date)}`].filter(Boolean).map(esc).join(' · ');
  const info = [];
  if (q.customer) info.push(['Kính gửi', q.customer]);
  for (const r of q.info || []) if (r.k && r.v) info.push([r.k, r.v]);
  let h = `<div class="hn">${HN_LOGO}<h1>${esc(F.title || 'BẢNG BÁO GIÁ')}</h1><div class="sub">${sub}</div>${q.no ? `<div class="sub no">Số: ${esc(q.no)}</div>` : ''}`;
  if (info.length) h += H('THÔNG TIN CÔNG TRÌNH') + `<div class="box"><table class="kv">${info.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`;
  if (t.dz) {
    const d = t.dz;
    h += H('PHÍ THIẾT KẾ') + `<table class="t"><thead><tr><th>Tầng / hạng mục</th><th class="r">Diện tích xây</th><th class="r">Tỷ lệ</th><th class="r">Tính phí</th></tr></thead><tbody>`
      + q.items.filter(i => !i.head).map(i => `<tr><td>${esc(i.name)}</td><td class="r">${+i.area > 0 ? fmt(i.area) + ' m²' : '–'}</td><td class="r">${+i.coef > 0 ? fmt(i.coef) + '%' : '–'}</td><td class="r">${fmt(iq(i))} m²</td></tr>`).join('')
      + `<tr class="g"><td colspan="3">Tổng diện tích tính phí</td><td class="r">${fmt(d.area)} m²</td></tr></tbody></table>`
      + `<div class="band"><div class="l small">${fmt(d.area)} m² × ${dzFormula(d)}${t.minApplied ? `<br>Thấp hơn phí tối thiểu → áp ${fmt(d.min)} đ` : ''}</div><div class="v">${fmt(t.sub)} đ</div></div>`;
    h += (q.discount || q.vat) ? totalsHTML(q, t, 'TỔNG CỘNG') : `<div class="words">Bằng chữ: ${docSo(t.total)}. Giá chưa gồm thuế VAT.</div>`;
    const pays = designPays(q), am = payAmounts(t.total, pays), days = totalDays(pays);
    h += H('THANH TOÁN THEO TIẾN ĐỘ') + `<div class="pay">${pays.map((x, i) => `<div><div class="pct">${fmt(x.pct)}%</div><div class="lb">${esc(x.label)}</div><div class="am">${fmt(am[i])} đ</div>${x.note ? `<div class="nt">${esc(x.note)}</div>` : ''}${x.days ? `<span class="dy">${esc(x.days)}</span>` : ''}</div>`).join('')}</div>`;
    if (days) h += `<p class="cap">Tổng thời gian <b>${days} ngày làm việc</b> (không tính thời gian chủ nhà xem và góp ý)</p>`;
    const base = t.total - t.vat;
    h += `<div class="two"><div class="box"><b>Hồ sơ bàn giao</b><ul>${d.P.deliver.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`
      + (d.P.offer ? `<div class="box offer"><b>Ưu đãi khi ký thi công trong 6 tháng</b>${d.P.offer.map(([lb, k]) => `<div class="r2"><span>${lb}</span><b>${fmt(Math.round(base * k))} đ</b></div>`).join('')}</div>` : '') + '</div>';
  } else {
    h += H(q.form === 'full' ? 'KHÁI TOÁN CHI PHÍ' : 'BẢNG GIÁ CHI TIẾT') + itemsTableHTML(q, t, K) + totalsHTML(q, t, q.form === 'full' ? 'TỔNG CỘNG KHÁI TOÁN' : 'TỔNG CỘNG');
  }
  const notes = (q.note || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (notes.length) h += H('GHI CHÚ') + `<div class="box"><ul>${notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  h += `<div class="foot"><div><small>Hotline/Zalo</small><div class="ph">${esc(s.phone || '')}</div></div><div class="ad">${esc(s.company || '')}<br><span>${esc(s.address || '')}</span></div></div></div>`;
  return h;
}

// ======================= Hợp đồng =======================
const CT_LAW = ['Bộ luật Dân sự năm 2015;', 'Luật Xây dựng số 135/2025/QH15;', 'Nghị định 210/2026/NĐ-CP về hợp đồng xây dựng;', 'Nghị định 207/2026/NĐ-CP về quản lý chất lượng, thi công xây dựng và bảo trì công trình xây dựng;'];

function contractValue(q, ct) {
  const t = qTotal(q), deduct = q.form === 'rough' ? Math.max(0, +ct.deduct || 0) : 0;
  return { t, deduct, value: t.total - deduct };
}

function contractHTML(q, ct) {
  const F = FORMS[q.form], s = S.settings, { t, deduct, value } = contractValue(q, ct);
  const f = (v, w = '……………………') => (v != null && String(v).trim() !== '' ? esc(v) : w);
  const ul = a => `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const ol = a => `<ol>${a.map(x => `<li>${x}</li>`).join('')}</ol>`;
  const tb = (head, rows) => `<table><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => (typeof c === 'string' ? `<td>${c}</td>` : `<td class="${c[1]}">${c[0]}</td>`)).join('')}</tr>`).join('')}</table>`;
  let art = 0;
  const A = x => `<h2>Điều ${++art}. ${x}</h2>`;
  const vatText = q.vat ? `đã bao gồm thuế VAT ${fmt(q.vat)}%` : 'chưa bao gồm thuế VAT';
  const pays = ct.pay || [], am = payAmounts(value, pays), pctSum = pays.reduce((a, x) => a + (+x.pct || 0), 0);
  const payTable = tb(['Đợt', 'Thời điểm', 'Tỷ lệ', 'Số tiền tạm tính (đ)'],
    [...pays.map((x, i) => [[i + 1, 'c'], esc(x.label), [fmt(x.pct) + '%', 'c'], [fmt(am[i]), 'r']]),
      ['', '<b>Tổng cộng</b>', [`<b>${fmt(pctSum)}%</b>`, 'c'], [`<b>${fmt(am.reduce((a, b) => a + b, 0))}</b>`, 'r']]]);
  const design = q.form === 'design';

  let h = `<p class="c"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><b>Độc lập – Tự do – Hạnh phúc</b><br>———————</p>
<h1>${F.ct}</h1><p class="c">Số: ${f(ct.no)}</p>
<p><b>Căn cứ:</b></p>${ul([...CT_LAW, ...(design ? [] : [`Hồ sơ thiết kế và bảng báo giá số ${f(q.no)} ngày ${fdate(q.date)} đã được hai bên thống nhất;`]), design ? 'Nhu cầu và thỏa thuận của hai bên.' : 'Nhu cầu và khả năng của hai bên.'])}
<p>Hôm nay, ${dateLong(ct.date)}, tại ${f(ct.place)}, chúng tôi gồm:</p>
<p><b>BÊN A (CHỦ ĐẦU TƯ)</b></p>${ul([`Ông/Bà: <b>${f(ct.aName)}</b>&nbsp;&nbsp;&nbsp; Năm sinh: ${f(ct.aYob, '…………')}`, `CCCD số: ${f(ct.aId)}&nbsp;&nbsp;&nbsp; Cấp ngày: ${f(ct.aIdDate, '…………')}&nbsp;&nbsp;&nbsp; Nơi cấp: ${f(ct.aIdPlace)}`, `Địa chỉ thường trú: ${f(ct.aAddr)}`, `Điện thoại: ${f(ct.aPhone)}`])}
<p><b>BÊN B (${F.sideB})</b></p>${ul([`Tên đơn vị: <b>${f((s.company || '').toUpperCase())}</b>`, `Mã số doanh nghiệp: ${f(s.tax)}`, `Địa chỉ: ${f(s.address)}`, `Điện thoại: ${f(s.phone)}`, `Đại diện: ${f(s.rep)}&nbsp;&nbsp;&nbsp; Chức vụ: ${f(s.repTitle)}`, `Tài khoản: ${f(s.bank)}`])}`;

  if (design) {
    const d = t.dz, P = d.P, pk = (q.dz || {}).pkg || 'G2';
    const scope = {
      G1: ['Bộ bản vẽ xin phép xây dựng: mặt bằng tổng thể, mặt bằng các tầng, mặt đứng, mặt cắt, mặt bằng móng.'],
      G2: ['Khảo sát, đo đạc hiện trạng khu đất.', 'Thiết kế mặt bằng bố trí công năng.', 'Phối cảnh 3D mặt tiền.', 'Hồ sơ kỹ thuật: kiến trúc, kết cấu, điện, cấp thoát nước.', 'Hồ sơ xin phép xây dựng; Bên B nộp hồ sơ xin phép thay Bên A. Lệ phí cấp phép của cơ quan nhà nước do Bên A chi trả.'],
      G3: ['Mặt bằng bố trí nội thất có kích thước đồ đạc.', 'Phối cảnh 3D từng không gian nội thất.', 'Khai triển tường, vách trang trí; chi tiết lát sàn.', 'Chi tiết cấu tạo tủ, kệ, giường để sản xuất.', 'Bảng vật liệu: hãng, mã, màu.'],
    };
    scope.G4 = [...scope.G2, ...scope.G3];
    const step2 = pk === 'G3' ? 'Phối cảnh 3D nội thất' : pk === 'G4' ? 'Phối cảnh 3D mặt tiền và nội thất' : 'Phối cảnh 3D mặt tiền';
    const days = i => f((pays[i] || {}).days || FORMS.design.pay[i].days);
    const items = q.items.filter(i => !i.head);
    h += `<p>Hai bên thống nhất ký hợp đồng tư vấn thiết kế với các điều khoản sau:</p>
${A('Nội dung công việc')}<p>Bên A giao, Bên B nhận tư vấn thiết kế công trình sau:</p>
${tb(['Hạng mục', 'Nội dung'], [['Công trình', f(ct.work)], ['Địa điểm xây dựng', f(ct.site)], ['Diện tích khu đất', f(ct.land)], ['Diện tích xây dựng', 'Tạm tính theo bảng tại Điều 3; chính thức theo mặt bằng được Bên A duyệt'], ['Công năng', 'Theo yêu cầu của Bên A, thống nhất khi chốt mặt bằng']])}
<p>Phạm vi thiết kế (${esc(P.name)}):</p>${ol(scope[pk].map(esc))}
<p>Không bao gồm: khảo sát địa chất, thẩm tra thiết kế, hồ sơ PCCC${pk === 'G3' || pk === 'G4' ? '' : ', thiết kế nội thất'}, sân vườn, cổng, tường rào và các công trình phụ. Các hạng mục này nếu Bên A có nhu cầu sẽ thỏa thuận bằng phụ lục riêng.</p>
${A('Hồ sơ bàn giao, tiến độ và chỉnh sửa')}<p><b>Hồ sơ bàn giao:</b> 2 bộ bản vẽ khổ A3 có ký tên + file PDF${pk === 'G1' || pk === 'G3' ? '' : '; 1 bộ hồ sơ xin phép xây dựng'}.</p>
<p><b>Tiến độ</b> (tính theo ngày làm việc, không tính thời gian Bên A xem và góp ý):</p>
${tb(['Bước', 'Công việc', 'Thời gian'], [[['1', 'c'], 'Khảo sát, lên mặt bằng bố trí', `${days(0)} kể từ khi ký hợp đồng và nhận tạm ứng`], [['2', 'c'], step2, `${days(1)} kể từ khi Bên A chốt mặt bằng`], [['3', 'c'], 'Hồ sơ kỹ thuật và hồ sơ xin phép', `${days(2)} kể từ khi Bên A duyệt 3D`]])}
<p><b>Chỉnh sửa:</b> mặt bằng được chỉnh sửa đến khi Bên A chốt. Phối cảnh 3D được chỉnh sửa 3 lần; từ lần thứ 4, Bên A trả thêm 25% đơn giá cho phần sửa. Thay đổi lớn về công năng sau khi đã duyệt 3D được tính là phát sinh và hai bên thỏa thuận bằng phụ lục.</p>
${A('Giá trị hợp đồng')}<p>Giá trị hợp đồng tạm tính là <b>${fmt(value)} đồng</b> (${docSo(value)}), tính theo công thức: Diện tích tính phí × ${dzFormula(d)}${q.discount ? `, đã giảm ${fmt(q.discount)}%` : ''}.</p>
${tb(['Tầng / hạng mục', 'Diện tích xây dựng (m²)', 'Tỷ lệ tính phí', 'Diện tích tính phí (m²)'], [...items.map(i => [esc(i.name), [+i.area > 0 ? fmt(i.area) : '–', 'r'], [+i.coef > 0 ? fmt(i.coef) + '%' : '–', 'c'], [fmt(iq(i)), 'r']]), ['<b>Tổng</b>', '', '', [`<b>${fmt(d.area)}</b>`, 'r']]])}
${P.k ? `<p>Hệ số quy mô K2: dưới 100 m² là 1,0 (áp phí tối thiểu); từ 100 đến dưới 200 m² là 1,1; từ 200 đến dưới 400 m² là 1,0; từ 400 đến dưới 800 m² là 0,9; từ 800 m² là 0,8. Diện tích tạm tính ${fmt(d.area)} m² nên K2 = ${fmt(d.k2)}.</p>` : ''}
${t.minApplied ? `<p>Phí tính theo công thức thấp hơn phí tối thiểu của gói nên áp phí tối thiểu ${fmt(d.min)} đồng.</p>` : ''}
<p>Diện tích trên là tạm tính. Giá trị quyết toán tính lại theo diện tích trên mặt bằng Bên A đã duyệt, cùng công thức và đơn giá nêu trên; phần chênh lệch được cộng hoặc trừ vào đợt thanh toán 2 và 3. Giá trị hợp đồng ${pk === 'G1' || pk === 'G3' ? '' : 'đã bao gồm dịch vụ nộp hồ sơ xin phép xây dựng, '}${vatText}.</p>
${A('Thanh toán')}${payTable}
<p>Bên A thanh toán trong 3 ngày kể từ khi đạt điều kiện từng đợt, bằng tiền mặt hoặc chuyển khoản vào tài khoản của Bên B nêu trên. Bên B bắt đầu thực hiện sau khi nhận đợt 1.</p>`;
    if (P.offer) {
      const base = value - t.vat;
      h += `${A('Ưu đãi khi Bên A ký thi công với Bên B')}<p>Nếu trong vòng 6 tháng kể từ ngày bàn giao hồ sơ, Bên A ký hợp đồng thi công công trình này với Bên B, phí thiết kế đã trả được trừ vào giá trị hợp đồng thi công như sau:</p>
${tb(['Hình thức thi công', 'Tỷ lệ trừ', 'Số tiền trừ tạm tính (đ)'], P.offer.map(([lb, k]) => [esc(lb.replace(/ – trừ \d+%/, '').replace('Trọn gói', 'Trọn gói chìa khóa trao tay').replace('Thô + NC hoàn thiện', 'Phần thô + nhân công hoàn thiện')), [`${k * 100}% phí thiết kế`, 'c'], [fmt(Math.round(base * k)), 'r']]))}
<p>Khi Bên B thi công, kỹ thuật của Bên B theo sát công trình suốt quá trình thi công. Nếu Bên A thuê đơn vị khác thi công, Bên B giám sát tác giả 3 buổi miễn phí trong tỉnh; từ buổi thứ 4 tính 1.000.000 đ/buổi.</p>`;
    }
    h += `${A('Quyền và nghĩa vụ của hai bên')}<p><b>Bên A:</b></p>${ul(['Cung cấp giấy tờ đất, thông tin hiện trạng và yêu cầu sử dụng; tạo điều kiện cho Bên B khảo sát, đo đạc.', 'Xem và góp ý hồ sơ trong 5 ngày kể từ khi nhận; duyệt bằng tin nhắn Zalo hoặc ký xác nhận trên bản vẽ.', `Thanh toán đúng đợt theo Điều ${art - (P.offer ? 2 : 1)}.`, 'Được sử dụng hồ sơ thiết kế để xây dựng công trình này; không sử dụng cho công trình khác khi chưa có đồng ý của Bên B.'])}
<p><b>Bên B:</b></p>${ul(['Thiết kế đúng yêu cầu đã thống nhất, đúng quy chuẩn, tiêu chuẩn xây dựng hiện hành.', 'Bàn giao hồ sơ đúng tiến độ tại Điều 2; chịu trách nhiệm về sai sót trong hồ sơ và sửa miễn phí các sai sót do mình gây ra.', ...(pk === 'G1' || pk === 'G3' ? [] : ['Thực hiện thủ tục nộp hồ sơ xin phép xây dựng thay Bên A.']), 'Giữ quyền tác giả đối với hồ sơ thiết kế.'])}
${A('Tạm dừng và chấm dứt hợp đồng')}${ul(['Bên A chấm dứt hợp đồng giữa chừng: không được hoàn lại các đợt đã thanh toán, và thanh toán cho phần việc Bên B đã làm nhưng chưa được thanh toán.', 'Bên B chấm dứt hợp đồng không có lý do chính đáng: hoàn lại toàn bộ số tiền Bên A đã trả.', 'Bên A chậm thanh toán quá 15 ngày: Bên B được tạm dừng công việc; tiến độ lùi tương ứng.'])}
${A('Giải quyết tranh chấp và hiệu lực')}<p>Tranh chấp trước hết được hai bên thương lượng. Nếu không thương lượng được, một trong hai bên có quyền đưa ra Tòa án nhân dân có thẩm quyền giải quyết.</p>
<p>Hợp đồng có hiệu lực từ ngày ký và tự thanh lý khi Bên B bàn giao đủ hồ sơ và Bên A thanh toán đủ. Hợp đồng lập thành 2 bản có giá trị như nhau, mỗi bên giữ 1 bản.</p>`;
  } else {
    const labor = q.form === 'labor', K = !!q.coef;
    let gi = 0, n = 0;
    const rows = q.items.map((it, idx) => {
      if (it.head) { n = 0; return [[`<b>${ROMAN[gi++] || ''}</b>`, 'c'], `<b>${esc(it.name)}</b>`, '', '', '', [`<b>${fmt(groupSum(q, idx, t))}</b>`, 'r']]; }
      n++;
      const kl = iq(it), auto = K && +it.area > 0 && +it.coef > 0;
      return [[n, 'c'], esc(it.name) + (auto ? ` <i>(${fmt(it.area)} m² × ${fmt(it.coef)}%)</i>` : ''), [esc(auto ? 'm²' : it.unit), 'c'], [fmt(kl), 'r'], [fmt(+it.price || 0), 'r'], [fmt(t.line(it)), 'r']];
    });
    const totalRows = [];
    if (t.disc) totalRows.push(['', `Giảm giá ${fmt(q.discount)}%`, '', '', '', [`−${fmt(t.disc)}`, 'r']]);
    if (t.vat) totalRows.push(['', `Thuế VAT ${fmt(q.vat)}%`, '', '', '', [fmt(t.vat), 'r']]);
    totalRows.push(['', '<b>Tổng cộng</b>', '', '', '', [`<b>${fmt(t.total)}</b>`, 'r']]);
    const end = ct.start && +ct.days ? (() => { const x = new Date(ct.start + 'T00:00:00'); x.setDate(x.getDate() + (+ct.days)); return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`; })() : '';
    h += `<p>Hai bên thống nhất ký hợp đồng thi công xây dựng với các điều khoản sau:</p>
${A('Nội dung công việc')}<p>Bên A giao, Bên B nhận thi công công trình: <b>${f(ct.work)}</b> tại ${f(ct.site)}, theo hồ sơ thiết kế được hai bên thống nhất.</p>
<p><b>Hình thức:</b> ${labor ? 'Bên B nhận khoán nhân công thi công phần thô và hoàn thiện; Bên A cung cấp toàn bộ vật tư, thiết bị, điện nước thi công.' : 'Bên B cung cấp vật tư phần thô và toàn bộ nhân công thi công phần thô và hoàn thiện; Bên A cung cấp vật tư hoàn thiện (gạch ốp lát, sơn, thiết bị điện nước, cửa, đá…).'}</p>
<p>Khối lượng và đơn giá (khối lượng tạm tính):</p>
${tb(['STT', 'Nội dung công việc', 'ĐVT', 'Khối lượng', 'Đơn giá (đ)', 'Thành tiền (đ)'], [...rows, ...totalRows])}
${A('Vật tư')}${ul(labor ? [
      'Bên A cung cấp đầy đủ vật tư, thiết bị, điện nước thi công đúng chủng loại, đúng thời gian theo yêu cầu Bên B báo trước 3 ngày.',
      'Bên B kiểm tra vật tư khi nhận; vật tư không đạt chất lượng thì báo Bên A để thay, không đưa vào sử dụng.',
      'Bên B bảo quản vật tư tại công trường và sử dụng đúng mục đích, tránh hao hụt.',
      'Dụng cụ thi công cầm tay do Bên B tự trang bị; máy móc, giàn giáo, cốp pha theo thỏa thuận của hai bên.',
    ] : [
      'Bên B cung cấp vật tư phần thô (xi măng, cát, đá, thép, gạch xây, bê tông, ống và dây điện nước âm…) đúng chủng loại theo phụ lục chủng loại vật tư đã thống nhất.',
      'Bên A cung cấp vật tư hoàn thiện đúng chủng loại, đúng thời gian theo yêu cầu Bên B báo trước 3 ngày; Bên A chậm cấp vật tư thì tiến độ được lùi tương ứng.',
      'Bên A tự mua vật tư khác với vật tư Bên B đã báo giá, hoặc thuê đơn vị khác làm hạng mục đã báo giá: Bên A trả Bên B 10% giá trị vật tư đã báo giá của phần đó.',
    ])}
${A('Giá trị hợp đồng')}<p>Giá trị hợp đồng tạm tính là <b>${fmt(t.total)} đồng</b> (${docSo(t.total)}), ${vatText}.</p>
${deduct ? `<p>Khấu trừ phí thiết kế Bên A đã thanh toán: <b>${fmt(deduct)} đồng</b>. Giá trị hợp đồng sau khấu trừ: <b>${fmt(value)} đồng</b> (${docSo(value)}).</p>` : ''}
<p>Giá trị quyết toán tính theo khối lượng thực tế được hai bên nghiệm thu, áp dụng đơn giá tại Điều 1. Khối lượng phát sinh thực hiện theo Điều 7.</p>
${A('Thanh toán')}${payTable}
<p>Bên A thanh toán trong 3 ngày kể từ khi đạt điều kiện từng đợt, bằng tiền mặt hoặc chuyển khoản vào tài khoản của Bên B nêu trên. Phát sinh (nếu có) được cộng vào đợt thanh toán kế tiếp hoặc khi quyết toán.</p>
${A('Tiến độ thi công')}<p>Ngày khởi công: ${ct.start ? fdate(ct.start) : '……/……/……'}. Thời gian thi công: ${f(ct.days, '……')} ngày${end ? ` (dự kiến hoàn thành ngày ${end})` : ''}.</p>
<p>Thời gian thi công không tính ngày mưa bão, ngày Bên A chậm cấp vật tư hoặc chậm thanh toán, thời gian tạm dừng theo yêu cầu của Bên A và các trường hợp bất khả kháng.</p>
${A('Chất lượng và nghiệm thu')}${ul([
      'Bên B thi công đúng hồ sơ thiết kế và tiêu chuẩn kỹ thuật hiện hành.',
      'Công việc khuất được nghiệm thu trước khi làm tiếp: cốt thép, cốp pha trước khi đổ bê tông; điện nước âm trước khi tô (thử áp, kiểm tra thông mạch); chống thấm ngâm nước 48 giờ trước khi ốp lát.',
      'Nghiệm thu từng giai đoạn làm căn cứ thanh toán. Khi hoàn thành, hai bên nghiệm thu bàn giao; lỗi được ghi biên bản và sửa xong trước khi bàn giao.',
      'Bên B ghi nhật ký thi công và gửi ảnh tiến độ cho Bên A qua nhóm Zalo công trình.',
    ])}
${A('Thay đổi và phát sinh')}${ul([
      'Mọi thay đổi so với hồ sơ thiết kế hoặc bảng khối lượng do Bên A yêu cầu phải lập phiếu phát sinh ghi rõ khối lượng, đơn giá, được Bên A ký (hoặc xác nhận qua Zalo) trước khi thi công.',
      'Đơn giá phát sinh áp dụng đơn giá trong hợp đồng; hạng mục chưa có đơn giá thì hai bên thỏa thuận.',
    ])}
${A('An toàn lao động và vệ sinh môi trường')}${ul([
      'Bên B chịu trách nhiệm về an toàn lao động cho người lao động của mình, trang bị bảo hộ và che chắn công trình.',
      'Trước khi khởi công, hai bên lập biên bản hiện trạng nhà lân cận; Bên B chịu trách nhiệm về hư hại cho công trình lân cận do lỗi thi công của mình.',
      'Giữ vệ sinh công trường, thu dọn phế thải trước khi bàn giao.',
    ])}
${A('Bảo hành')}<p>Bên B bảo hành công trình ${f(ct.warranty, '12')} tháng kể từ ngày nghiệm thu bàn giao. Khi nhận báo lỗi, Bên B có mặt trong 3 ngày để kiểm tra và sửa chữa miễn phí các lỗi do thi công. Hư hỏng do vật tư ${labor ? '' : 'hoàn thiện '}Bên A cung cấp không thuộc phạm vi bảo hành của Bên B.</p>
${A('Quyền và nghĩa vụ của hai bên')}<p><b>Bên A:</b></p>${ul(['Bàn giao mặt bằng, mốc ranh và giấy phép xây dựng (nếu thuộc diện phải có).', 'Cung cấp vật tư theo Điều 2 và thanh toán đúng hạn theo Điều 4.', 'Cử người theo dõi, nghiệm thu; được kiểm tra chất lượng và yêu cầu Bên B sửa sai.'])}
<p><b>Bên B:</b></p>${ul(['Thi công đúng thiết kế, đúng tiến độ và chất lượng đã cam kết.', 'Quản lý đội thợ, chịu trách nhiệm về người lao động của mình.', 'Báo nhu cầu vật tư trước 3 ngày; bảo hành theo Điều 9.'])}
${A('Phạt vi phạm hợp đồng')}${ul(['Bên B chậm tiến độ do lỗi của mình: phạt 0,2% giá trị hợp đồng cho mỗi ngày chậm, tổng mức phạt không quá 12% giá trị hợp đồng.', 'Bên A chậm thanh toán quá 15 ngày: Bên B được tạm dừng thi công, tiến độ lùi tương ứng.'])}
${A('Tạm dừng, chấm dứt hợp đồng')}${ul(['Mỗi bên được tạm dừng hoặc chấm dứt hợp đồng khi bên kia vi phạm nghiêm trọng nghĩa vụ, đã được thông báo bằng văn bản mà không khắc phục trong 7 ngày.', 'Khi chấm dứt, hai bên nghiệm thu khối lượng đã thực hiện; Bên A thanh toán phần việc đã làm, Bên B hoàn trả phần tạm ứng chưa sử dụng (nếu có).'])}
${A('Bất khả kháng')}<p>Thiên tai, dịch bệnh, thay đổi chính sách của Nhà nước và các sự kiện ngoài khả năng kiểm soát của hai bên không bị coi là vi phạm hợp đồng. Bên gặp sự kiện phải thông báo cho bên kia trong 3 ngày; tiến độ được điều chỉnh tương ứng.</p>
${A('Giải quyết tranh chấp và hiệu lực')}<p>Tranh chấp trước hết được hai bên thương lượng. Nếu không thương lượng được, một trong hai bên có quyền đưa ra Tòa án nhân dân có thẩm quyền giải quyết.</p>
<p>Hợp đồng có hiệu lực từ ngày ký và được thanh lý trong 15 ngày sau khi hai bên hoàn thành nghĩa vụ. Hợp đồng lập thành 2 bản có giá trị như nhau, mỗi bên giữ 1 bản.</p>`;
  }
  h += `<table class="nb signs"><tr><td class="c"><b>ĐẠI DIỆN BÊN A</b><br><i>(Ký, ghi rõ họ tên)</i><br><br><br><br><br><b>${esc(ct.aName || '')}</b></td><td class="c"><b>ĐẠI DIỆN BÊN B</b><br><i>(Ký, ghi rõ họ tên, đóng dấu)</i><br><br><br><br><br><b>${esc(s.rep || '')}</b></td></tr></table>`;
  return h;
}

const wordDoc = (title, body) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page WordSection1{size:21cm 29.7cm;margin:2cm 2cm 2cm 2.5cm}div.WordSection1{page:WordSection1}
body{font-family:"Times New Roman",serif;font-size:13pt;line-height:1.35}h1{font-size:15pt;text-align:center;margin:8pt 0 2pt}h2{font-size:13pt;margin:10pt 0 3pt}p{margin:3pt 0}
table{border-collapse:collapse;width:100%;margin:4pt 0}td,th{border:1px solid #000;padding:3pt 5pt;vertical-align:top}th{background:#eee}.c{text-align:center}.r{text-align:right}
table.nb td{border:none}ul,ol{margin:2pt 0 2pt 18pt}</style></head><body><div class="WordSection1">${body}</div></body></html>`;

function openContract(qid) {
  const q = S.quotes.find(x => x.id === qid);
  if (!q) return;
  const F = FORMS[q.form];
  if (!F || !F.ct) return toast('Hình thức này không soạn hợp đồng');
  const p = proj(q.projectId) || {}, s = S.settings, year = (q.date || today()).slice(0, 4);
  const scale = (q.info || []).find(i => /quy mô/i.test(i.k || ''))?.v;
  if (!q.ct || q.ct.form !== q.form) q.ct = { form: q.form };
  const ct = q.ct;
  const defs = {
    no: `……/${year}/${F.ctCode}`, date: today(), place: cityOf(s.address), aName: p.client || q.customer || '', aYob: '', aId: '', aIdDate: '', aIdPlace: '', aAddr: '', aPhone: p.phone || '',
    work: scale ? `Nhà ở riêng lẻ – ${scale}` : (p.name || ''), site: p.address || '', land: '', start: p.start || '', days: '', warranty: 12, deduct: 0,
  };
  for (const k in defs) if (ct[k] === undefined) ct[k] = defs[k];
  if (!Array.isArray(ct.pay) || !ct.pay.length) ct.pay = F.pay.map(x => ({ ...x }));
  const design = q.form === 'design';
  const fields = [
    ['Hợp đồng', [['no', 'Số hợp đồng'], ['date', 'Ngày ký', 'date'], ['place', 'Nơi ký', '', 1]]],
    ['Bên A (chủ đầu tư)', [['aName', 'Họ tên', '', 1], ['aYob', 'Năm sinh'], ['aPhone', 'Điện thoại', 'tel'], ['aId', 'CCCD số'], ['aIdDate', 'Cấp ngày'], ['aIdPlace', 'Nơi cấp', '', 1], ['aAddr', 'Địa chỉ thường trú', '', 1]]],
    ['Công trình', [['work', 'Công trình', '', 1], ['site', 'Địa điểm xây dựng', '', 1],
      ...(design ? [['land', 'Diện tích khu đất', '', 1]] : [['start', 'Ngày khởi công', 'date'], ['days', 'Thời gian thi công (ngày)', 'num'], ['warranty', 'Bảo hành (tháng)', 'num'],
        ...(q.form === 'rough' ? [['deduct', 'Khấu trừ phí thiết kế đã trả (₫)', 'money']] : [])])]],
  ];
  const input = ([k, label, type, full]) => `<div class="${full ? 'full' : ''}"><label>${label}</label><input data-ct="${k}"${type === 'date' ? ' type="date"' : ''}${type === 'num' ? ' inputmode="decimal"' : ''}${type === 'tel' ? ' inputmode="tel"' : ''}${type === 'money' ? ' inputmode="numeric" data-money' : ''} value="${esc(type === 'money' ? (+ct[k] ? fmt(ct[k]) : '') : ct[k] ?? '')}"></div>`;
  const el = openSheet(`<header><h2>${esc(F.ctName)} · ${esc(q.no)}</h2><button class="btn sm" data-act="closeSheet" type="button">Đóng</button></header>
  <div class="body"><div class="ctgrid">
    <div class="ctform">
      ${fields.map(([title, list]) => `<div class="bold small mt mb">${title}</div><div class="fields">${list.map(input).join('')}</div>`).join('')}
      <div class="bold small mt mb">Đợt thanh toán</div><div id="ctPay"></div>
      <button class="linkbtn" type="button" id="ctPayAdd">+ Thêm đợt</button>
      <div class="bold small mt mb">Bên B</div>
      <p class="small">${esc(s.company || '')}<br>Đại diện: ${s.rep ? esc(s.rep) : '<span class="neg">chưa nhập</span>'}${s.repTitle ? ' – ' + esc(s.repTitle) : ''}<br>Tài khoản: ${s.bank ? esc(s.bank) : '<span class="neg">chưa nhập</span>'}</p>
      <p class="small muted">Sửa thông tin Bên B trong Cài đặt → Thông tin công ty.</p>
    </div>
    <div class="ctprev">
      <div class="row between wrap mb" style="gap:8px"><b>Bản hợp đồng</b><div class="btns"><button class="btn sm" type="button" id="ctRegen" hidden>↻ Tạo lại theo thông tin</button><button class="btn sm" type="button" id="ctPrint">🖨 In / lưu PDF</button><button class="btn sm" type="button" id="ctWord">⬇ Tải Word</button></div></div>
      <p class="small muted mb" id="ctHint">Bấm vào bản hợp đồng để sửa trực tiếp trước khi in hoặc tải về.</p>
      <div class="paper ct" id="ctDoc" contenteditable="true" spellcheck="false"></div>
    </div>
  </div></div>
  <footer><button class="btn" type="button" id="ctBack">← Báo giá</button><button class="btn primary" type="button" id="ctSave">Lưu hợp đồng vào Hồ sơ</button></footer>`, true);
  const $c = sel => $(sel, el);
  let edited = false;
  const regen = () => { $c('#ctDoc').innerHTML = contractHTML(q, ct); edited = false; $c('#ctRegen').hidden = true; };
  const drawPay = () => {
    const tot = ct.pay.reduce((a, x) => a + (+x.pct || 0), 0);
    $c('#ctPay').innerHTML = ct.pay.map((x, i) => `<div class="payrow" data-n="${i}"><input data-pk="pct" inputmode="decimal" value="${x.pct}" aria-label="Tỷ lệ phần trăm"><span>%</span><input data-pk="label" value="${esc(x.label)}" aria-label="Thời điểm thanh toán"><button type="button" class="del" data-pdel="${i}" aria-label="Xóa đợt">×</button></div>`).join('')
      + `<p class="small ${Math.abs(tot - 100) < 1e-9 ? 'muted' : 'neg'}" id="ctPaySum">Tổng: ${fmt(tot)}%${Math.abs(tot - 100) < 1e-9 ? '' : ' — chưa đủ 100%'}</p>`;
  };
  const changed = () => { save(); if (!edited) regen(); };
  drawPay(); regen();

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.closest('#ctDoc')) { edited = true; $c('#ctRegen').hidden = false; return; }
    if (t.dataset.ct) { const k = t.dataset.ct; ct[k] = k === 'deduct' ? num(t.value) : t.value; changed(); }
    else if (t.dataset.pk) {
      const x = ct.pay[+t.closest('.payrow').dataset.n];
      x[t.dataset.pk] = t.dataset.pk === 'pct' ? dec(t.value) : t.value;
      const tot = ct.pay.reduce((a, y) => a + (+y.pct || 0), 0), ok = Math.abs(tot - 100) < 1e-9, ps = $c('#ctPaySum');
      ps.className = 'small ' + (ok ? 'muted' : 'neg'); ps.textContent = `Tổng: ${fmt(tot)}%${ok ? '' : ' — chưa đủ 100%'}`;
      changed();
    }
  });
  el.addEventListener('click', e => {
    const i = e.target.dataset.pdel;
    if (i !== undefined) { ct.pay.splice(+i, 1); drawPay(); changed(); }
  });
  $c('#ctPayAdd').onclick = () => { ct.pay.push({ pct: 0, label: '' }); drawPay(); changed(); };
  $c('#ctRegen').onclick = () => { if (confirm('Tạo lại bản hợp đồng theo thông tin bên trái? Các chỉnh sửa tay trong bản sẽ mất.')) regen(); };
  $c('#ctPrint').onclick = () => printHTML(`<div class="ct">${$c('#ctDoc').innerHTML}</div>`);
  const fileBase = () => safeName(`Hop dong ${F.ctCode} ${q.no} - ${pname(q.projectId)}`);
  const wordBlob = () => new Blob(['﻿' + wordDoc(F.ct, $c('#ctDoc').innerHTML)], { type: 'application/msword' });
  $c('#ctWord').onclick = () => download(fileBase() + '.doc', wordBlob());
  $c('#ctBack').onclick = () => { closeSheet(); formQuote(q.id); };
  $c('#ctSave').onclick = async () => {
    const blob = wordBlob(), fid = uid();
    try { await DB.set('files', fid, blob); } catch (err) { return toast('Không lưu được tệp — bộ nhớ đầy?'); }
    S.docs.push({
      id: uid(), projectId: q.projectId, type: 'Hợp đồng', title: `${F.ctName} – ${pname(q.projectId)}`, no: ct.no, date: ct.date, party: ct.aName,
      amount: contractValue(q, ct).value, note: `Soạn từ báo giá ${q.no}.`, files: [{ id: fid, name: fileBase() + '.doc', type: 'application/msword', size: blob.size }],
    });
    save(); toast('Đã lưu hợp đồng vào Hồ sơ dự án');
  };
}
