'use strict';
/* Quản lý Xây dựng — PWA offline, dữ liệu lưu trên thiết bị (IndexedDB) */

// ---------- Tiện ích ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fdate = iso => iso ? iso.split('-').reverse().join('/') : '';
const fmt = n => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n || 0);
const money = n => fmt(Math.round(n || 0)) + ' ₫';
const short = n => {
  const a = Math.abs(n || 0);
  if (a >= 1e9) return fmt(Math.round(n / 1e7) / 100) + ' tỷ';
  if (a >= 1e6) return fmt(Math.round(n / 1e5) / 10) + ' tr';
  return fmt(Math.round(n || 0)) + ' ₫';
};
const num = v => +String(v ?? '').replace(/[^\d]/g, '') || 0;            // tiền (số nguyên)
const dec = v => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0; // khối lượng
const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.id > a.id ? 1 : -1);

function docSo(n) {
  n = Math.round(Math.abs(n || 0));
  if (!n) return 'Không đồng';
  const d = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const u = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ', ' triệu tỷ'];
  const blk = (x, full) => {
    const t = Math.floor(x / 100), c = Math.floor(x % 100 / 10), v = x % 10;
    let s = (t || full) ? d[t] + ' trăm' : '';
    if (c > 1) s += ' ' + d[c] + ' mươi' + (v === 1 ? ' mốt' : v === 5 ? ' lăm' : v ? ' ' + d[v] : '');
    else if (c === 1) s += ' mười' + (v === 5 ? ' lăm' : v ? ' ' + d[v] : '');
    else if (v) s += ((t || full) ? ' lẻ ' : ' ') + d[v];
    return s.trim();
  };
  const g = [];
  while (n > 0) { g.push(n % 1000); n = Math.floor(n / 1000); }
  const parts = [];
  for (let i = g.length - 1; i >= 0; i--) if (g[i]) parts.push(blk(g[i], i < g.length - 1) + u[i]);
  const s = parts.join(' ') + ' đồng';
  return s[0].toUpperCase() + s.slice(1);
}

// ---------- Lưu trữ ----------
const DB = {
  db: null, mem: new Map(),
  open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open('qlxd', 2);
        r.onupgradeneeded = () => { for (const n of ['kv', 'photos', 'files']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  get(s, k) { return this.db ? this.tx(s, 'readonly', o => o.get(k)) : Promise.resolve(this.mem.get(s + k)); },
  set(s, k, v) { return this.db ? this.tx(s, 'readwrite', o => o.put(v, k)) : Promise.resolve(this.mem.set(s + k, v)); },
  del(s, k) { return this.db ? this.tx(s, 'readwrite', o => o.delete(k)) : Promise.resolve(this.mem.delete(s + k)); },
  clear(s) { return this.db ? this.tx(s, 'readwrite', o => o.clear()) : Promise.resolve([...this.mem.keys()].filter(k => k.startsWith(s)).forEach(k => this.mem.delete(k))); },
};

const blank = () => ({
  projects: [], quotes: [], logs: [], costs: [], docs: [],
  settings: { company: 'Công ty TNHH MTV Xây dựng Thương mại Hữu Nhân', phone: '0914 580 385', address: '364 Quang Trung, khóm 20, P. Tân Thành, Cà Mau', tax: '2001297621' },
  ui: { tab: 'projects', pid: '', ctype: '', dtype: '' },
});
let S = blank();
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; DB.set('kv', 'state', S).catch(() => toast('Không lưu được dữ liệu — bộ nhớ đầy?')); }, 150);
  if (window.Sync) Sync.changed();
}
// Đóng hoặc chuyển ứng dụng ngay sau khi bấm Lưu: ghi ngay, không chờ
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = 0;
  DB.set('kv', 'state', S).catch(() => {});
}
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

const photoCache = new Map(), photoWait = new Map();
// Ảnh chưa có trên máy này (chụp từ máy khác) được tải từ máy chủ đồng bộ khi cần
function getPhoto(id) {
  if (photoCache.has(id)) return Promise.resolve(photoCache.get(id));
  if (!photoWait.has(id)) photoWait.set(id, (async () => {
    let v = await DB.get('photos', id).catch(() => null);
    if (!v && window.Sync) v = await Sync.fetchPhoto(id);
    if (v) photoCache.set(id, v);
    photoWait.delete(id);
    return v;
  })());
  return photoWait.get(id);
}
function hydratePhotos(root = document) {
  return Promise.all($$('img[data-ph]', root).map(async img => {
    const src = await getPhoto(img.dataset.ph);
    if (src) img.src = src;
  }));
}
function compressImage(file, max = 1280) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Ảnh không đọc được')); };
    img.src = url;
  });
}

// Ảnh chụp giấy tờ: thu nhỏ vừa đủ đọc rõ để tiết kiệm bộ nhớ; tệp khác giữ nguyên
function shrinkImage(file, max = 2000) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.resolve(file);
  return new Promise(res => {
    const url = URL.createObjectURL(file), img = new Image();
    const done = b => { URL.revokeObjectURL(url); res(b && b.size < file.size ? b : file); };
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k === 1 && file.size < 1.5e6) return done(null);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(done, 'image/jpeg', 0.82);
    };
    img.onerror = () => done(null);
    img.src = url;
  });
}
const fsize = n => n >= 1e6 ? fmt(Math.round(n / 1e5) / 10) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const fileIcon = f => /^image\//.test(f.type) ? '🖼️' : /pdf/.test(f.type) ? '📕' : '📄';
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

// ---------- Danh mục ----------
const TABS = [
  ['projects', 'Dự án', '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>'],
  ['quotes', 'Báo giá', '<path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"/>'],
  ['logs', 'Nhật ký', '<path d="M5 4h14v17H5zM9 2v4M15 2v4M8 11h8M8 15h5"/>'],
  ['costs', 'Chi phí', '<path d="M3 7h18v12H3zM3 11h18M7 15h4"/>'],
  ['docs', 'Hồ sơ', '<path d="M3 6h6l2 3h10v10H3z"/>'],
  ['settings', 'Cài đặt', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'],
];
const P_STATUS = { prep: ['Chuẩn bị', 'blue'], active: ['Đang thi công', 'orange'], paused: ['Tạm dừng', ''], done: ['Hoàn thành', 'green'] };
const Q_STATUS = { draft: ['Nháp', ''], sent: ['Đã gửi', 'blue'], approved: ['Đã duyệt', 'green'], rejected: ['Từ chối', 'red'] };
const CATS = ['Vật tư', 'Nhân công', 'Máy thi công', 'Thầu phụ', 'Vận chuyển', 'Khác'];
const DOC_TYPES = ['Hợp đồng', 'Phiếu đề nghị cấp vật tư', 'Biên bản nghiệm thu', 'Giấy tạm ứng', 'Giấy ủy quyền', 'Khác'];
const WEATHER = ['☀️ Nắng', '⛅ Mát', '🌧️ Mưa', '⛈️ Mưa to'];
const TPL = {
  'Phần thô nhà phố': [['Đào móng, vận chuyển đất', 'm³'], ['Bê tông móng, đà kiềng', 'm³'], ['Cốt thép móng, cột, dầm, sàn', 'tấn'], ['Bê tông cột, dầm, sàn', 'm³'], ['Xây tường gạch', 'm²'], ['Tô trát tường', 'm²'], ['Chống thấm sàn mái, WC', 'm²'], ['Hệ thống điện nước âm', 'm² sàn']],
  'Hoàn thiện': [['Ốp lát gạch nền', 'm²'], ['Ốp gạch tường WC', 'm²'], ['Sơn nước nội thất', 'm²'], ['Sơn nước ngoại thất', 'm²'], ['Trần thạch cao', 'm²'], ['Cửa đi, cửa sổ', 'm²'], ['Lan can, cầu thang', 'md'], ['Thiết bị vệ sinh', 'bộ'], ['Thiết bị điện, đèn', 'gói']],
  'Nội thất': [['Tủ bếp trên + dưới', 'md'], ['Tủ quần áo', 'm²'], ['Giường ngủ', 'cái'], ['Kệ tivi', 'md'], ['Bàn làm việc', 'cái'], ['Vận chuyển, lắp đặt', 'gói']],
  'Sửa chữa cải tạo': [['Tháo dỡ, đục phá', 'm²'], ['Vận chuyển xà bần', 'chuyến'], ['Xây tô lại', 'm²'], ['Chống thấm', 'm²'], ['Sơn lại toàn bộ', 'm²'], ['Thay mới điện nước', 'gói']],
};

// ---------- Tính toán ----------
const proj = id => S.projects.find(p => p.id === id);
const pname = id => proj(id)?.name || '(Chưa chọn dự án)';
const inScope = x => !S.ui.pid || x.projectId === S.ui.pid;
function qTotal(q) {
  const sub = sum(q.items || [], i => i.qty * i.price);
  const disc = sub * (q.discount || 0) / 100;
  const vat = (sub - disc) * (q.vat || 0) / 100;
  return { sub, disc, vat, total: sub - disc + vat };
}
function pMoney(pid) {
  const c = S.costs.filter(x => x.projectId === pid);
  return { thu: sum(c.filter(x => x.type === 'thu'), x => x.amount), chi: sum(c.filter(x => x.type === 'chi'), x => x.amount) };
}
const badge = ([t, c]) => `<span class="badge ${c}">${t}</span>`;

// ---------- Khung giao diện ----------
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
function render() {
  const tab = S.ui.tab;
  $('#nav').innerHTML = `<div class="brand"><img src="icon.svg" alt=""><span><b>HỮU NHÂN</b><small>Quản lý công trình</small></span></div>` + TABS.map(([k, t, ic]) =>
    `<button data-act="tab" data-id="${k}" class="${k === tab ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>${t}</button>`).join('');
  $('#title').textContent = TABS.find(t => t[0] === tab)[1];
  const pf = $('#pfilter');
  pf.hidden = tab === 'projects' || tab === 'settings' || !S.projects.length;
  pf.innerHTML = `<option value="">Tất cả dự án</option>` + S.projects.map(p => `<option value="${p.id}" ${p.id === S.ui.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#fab').hidden = tab === 'settings';
  const main = $('#main');
  main.innerHTML = VIEWS[tab]();
  hydratePhotos(main);
}
const empty = (icon, title, text, btns = '') => `<div class="empty"><div class="big">${icon}</div><h3>${title}</h3><p>${text}</p><div class="btns">${btns}</div></div>`;

const VIEWS = {
  projects() {
    if (!S.projects.length) return empty('🏗️', 'Chào mừng bạn!', 'Tạo dự án đầu tiên để bắt đầu lập báo giá, ghi nhật ký và theo dõi chi phí.',
      `<button class="btn primary" data-act="add">+ Tạo dự án</button><button class="btn" data-act="sample">Xem thử dữ liệu mẫu</button>`);
    const active = S.projects.filter(p => p.status === 'active').length;
    const thu = sum(S.costs.filter(c => c.type === 'thu'), c => c.amount), chi = sum(S.costs.filter(c => c.type === 'chi'), c => c.amount);
    return `<div class="stats">
      <div class="stat"><div class="k">Đang thi công</div><div class="v">${active} / ${S.projects.length} dự án</div></div>
      <div class="stat"><div class="k">Giá trị hợp đồng</div><div class="v num">${short(sum(S.projects, p => p.contract))}</div></div>
      <div class="stat"><div class="k">Đã thu</div><div class="v num pos">${short(thu)}</div></div>
      <div class="stat"><div class="k">Đã chi</div><div class="v num neg">${short(chi)}</div></div>
    </div><div class="list cols">${S.projects.map(p => {
      const m = pMoney(p.id), base = p.budget || p.contract, pct = base ? Math.round(m.chi / base * 100) : 0;
      const nq = S.quotes.filter(q => q.projectId === p.id).length, nl = S.logs.filter(l => l.projectId === p.id).length;
      return `<div class="card">
        <div class="row between tap" data-act="editProject" data-id="${p.id}">
          <div class="grow"><div class="bold clip">${esc(p.name)}</div><div class="small muted clip">${esc([p.client, p.address].filter(Boolean).join(' · ') || 'Chưa có thông tin khách hàng')}</div></div>
          ${badge(P_STATUS[p.status] || P_STATUS.prep)}
        </div>
        <div class="row between wrap small mt"><span class="muted">Chi phí / ${p.budget ? 'ngân sách' : 'hợp đồng'}</span><span class="num"><b>${short(m.chi)}</b> / ${short(base)}${base ? ` (${pct}%)` : ''}</span></div>
        <div class="bar mt"><i class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></i></div>
        <div class="row between wrap small mt"><span class="muted">Đã thu <b class="pos num">${short(m.thu)}</b></span><span class="muted">Lãi tạm tính <b class="num ${p.contract - m.chi < 0 ? 'neg' : 'pos'}">${short(p.contract - m.chi)}</b></span></div>
        <div class="row wrap mt" style="column-gap:16px">
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="quotes">Báo giá (${nq})</button>
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="logs">Nhật ký (${nl})</button>
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="costs">Chi phí</button>
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="docs">Hồ sơ (${S.docs.filter(d => d.projectId === p.id).length})</button>
        </div></div>`;
    }).join('')}</div>`;
  },

  quotes() {
    const list = S.quotes.filter(inScope).sort(byDateDesc);
    if (!list.length) return empty('📄', 'Chưa có báo giá', 'Lập báo giá trong vài phút: chọn mẫu hạng mục, nhập khối lượng và đơn giá, rồi in hoặc lưu PDF gửi khách.',
      `<button class="btn primary" data-act="add">+ Lập báo giá</button>`);
    return `<div class="list cols">${list.map(q => `<div class="card tap" data-act="editQuote" data-id="${q.id}">
      <div class="row between"><div class="grow"><div class="bold clip">${esc(q.title || 'Báo giá')}</div>
      <div class="small muted clip">${esc(q.no)} · ${fdate(q.date)} · ${esc(pname(q.projectId))}</div></div>${badge(Q_STATUS[q.status] || Q_STATUS.draft)}</div>
      <div class="row between mt"><span class="small muted">${(q.items || []).length} hạng mục</span><span class="bold num">${money(qTotal(q).total)}</span></div></div>`).join('')}</div>`;
  },

  logs() {
    const list = S.logs.filter(inScope).sort(byDateDesc);
    if (!list.length) return empty('📝', 'Chưa có nhật ký', 'Ghi lại công việc mỗi ngày: thời tiết, nhân công, nội dung thi công, vướng mắc và hình ảnh hiện trường.',
      `<button class="btn primary" data-act="add">+ Ghi nhật ký</button>`);
    return `<div class="row between mb"><span class="muted small">${list.length} ngày ghi nhận · ${fmt(sum(list, l => l.workers))} công</span>
      <button class="btn sm" data-act="printLogs">🖨 In nhật ký</button></div>
      <div class="list">${list.map(l => `<div class="card">
      <div class="row between tap" data-act="editLog" data-id="${l.id}">
        <div class="grow"><div class="bold">${fdate(l.date)} <span class="small muted" style="font-weight:400">${esc(l.weather || '')}</span></div>
        <div class="small muted clip">${esc(pname(l.projectId))}${l.workers ? ` · ${fmt(l.workers)} nhân công` : ''}</div></div><span class="linkbtn">Sửa</span></div>
      <p class="pre mt">${esc(l.content)}</p>
      ${l.issue ? `<p class="pre small mt"><span class="badge red">Vướng mắc</span> ${esc(l.issue)}</p>` : ''}
      ${l.photos?.length ? `<div class="thumbs">${l.photos.map(id => `<div class="ph"><img data-ph="${id}" data-act="viewPhoto" alt="Ảnh hiện trường" loading="lazy"></div>`).join('')}</div>` : ''}
    </div>`).join('')}</div>`;
  },

  costs() {
    const all = S.costs.filter(inScope);
    if (!all.length) return empty('💰', 'Chưa có khoản thu chi', 'Ghi nhanh từng khoản chi (vật tư, nhân công, thầu phụ…) và khoản thu từ chủ đầu tư để biết ngay lãi lỗ.',
      `<button class="btn primary" data-act="add">+ Thêm khoản</button>`);
    const thu = sum(all.filter(c => c.type === 'thu'), c => c.amount), chiL = all.filter(c => c.type === 'chi'), chi = sum(chiL, c => c.amount);
    const p = proj(S.ui.pid), base = p ? (p.budget || p.contract) : 0;
    const cats = CATS.map(c => [c, sum(chiL.filter(x => x.cat === c), x => x.amount)]).filter(c => c[1]).sort((a, b) => b[1] - a[1]);
    const maxc = Math.max(1, ...cats.map(c => c[1]));
    const t = S.ui.ctype, list = all.filter(c => !t || c.type === t).sort(byDateDesc);
    return `<div class="stats three">
      <div class="stat"><div class="k">Tổng thu</div><div class="v num pos">${short(thu)}</div></div>
      <div class="stat"><div class="k">Tổng chi</div><div class="v num neg">${short(chi)}</div></div>
      <div class="stat"><div class="k">${base ? 'Ngân sách còn lại' : 'Thu − Chi'}</div><div class="v num ${(base ? base - chi : thu - chi) < 0 ? 'neg' : ''}">${short(base ? base - chi : thu - chi)}</div></div>
    </div>
    ${cats.length ? `<div class="card mb"><div class="bold small mb">Cơ cấu chi phí</div>${cats.map(([c, v]) =>
      `<div class="catrow"><span>${c}</span><div class="bar"><i style="width:${v / maxc * 100}%"></i></div><span class="num">${short(v)} · ${Math.round(v / chi * 100)}%</span></div>`).join('')}</div>` : ''}
    <div class="row between"><div class="chips" style="margin:0">
      ${[['', 'Tất cả'], ['chi', 'Chi'], ['thu', 'Thu']].map(([k, n]) => `<button class="chip ${t === k ? 'on' : ''}" data-act="ctype" data-id="${k}">${n}</button>`).join('')}
    </div><button class="btn sm" data-act="csvCosts">⬇ Excel</button></div>
    <div class="list mt">${list.map(c => `<div class="card tap row" data-act="editCost" data-id="${c.id}">
      <div class="grow"><div class="bold clip">${esc(c.desc || c.cat || 'Khoản thu')}</div>
      <div class="small muted clip">${fdate(c.date)} · ${esc(c.type === 'thu' ? 'Thu' : c.cat)}${S.ui.pid ? '' : ' · ' + esc(pname(c.projectId))}${c.vendor ? ' · ' + esc(c.vendor) : ''}</div></div>
      <div class="bold num ${c.type === 'thu' ? 'pos' : 'neg'}">${c.type === 'thu' ? '+' : '−'}${fmt(c.amount)}</div></div>`).join('')}</div>`;
  },

  docs() {
    const all = S.docs.filter(inScope);
    if (!all.length) return empty('🗂️', 'Chưa có hồ sơ', 'Lưu bản chụp hoặc file hợp đồng, phiếu đề nghị cấp vật tư, biên bản nghiệm thu, giấy tạm ứng, giấy ủy quyền… theo từng dự án để tra lại khi cần.',
      `<button class="btn primary" data-act="add">+ Lưu hồ sơ</button>`);
    const t = S.ui.dtype, list = all.filter(d => !t || d.type === t).sort(byDateDesc);
    const types = DOC_TYPES.filter(x => all.some(d => d.type === x));
    return `<div class="chips"><button class="chip ${t ? '' : 'on'}" data-act="dtype" data-id="">Tất cả (${all.length})</button>
      ${types.map(x => `<button class="chip ${t === x ? 'on' : ''}" data-act="dtype" data-id="${esc(x)}">${esc(x)} (${all.filter(d => d.type === x).length})</button>`).join('')}</div>
    <div class="list cols">${list.map(d => `<div class="card">
      <div class="row between tap" data-act="editDoc" data-id="${d.id}">
        <div class="grow"><div class="bold clip">${esc(d.title || d.type)}</div>
        <div class="small muted clip">${esc([d.no && 'Số ' + d.no, fdate(d.date), S.ui.pid ? '' : pname(d.projectId)].filter(Boolean).join(' · '))}</div></div><span class="linkbtn">Sửa</span></div>
      <div class="row between wrap small mt">${d.title ? `<span class="badge blue">${esc(d.type)}</span>` : '<span></span>'}${d.amount ? `<b class="num">${money(d.amount)}</b>` : ''}</div>
      ${d.party ? `<div class="small muted mt clip">${esc(d.party)}</div>` : ''}
      ${d.note ? `<p class="pre small mt">${esc(d.note)}</p>` : ''}
      ${(d.files || []).length ? `<div class="mt">${d.files.map(f => `<div class="frow tap" data-act="openFile" data-id="${f.id}"><span class="grow clip">${fileIcon(f)} ${esc(f.name)}</span><span class="small muted">${fsize(f.size)}</span></div>`).join('')}</div>` : `<div class="small muted mt">Chưa đính kèm tệp</div>`}
    </div>`).join('')}</div>`;
  },

  settings() {
    const s = S.settings;
    return `<div class="list">
    ${window.Sync ? Sync.card() : ''}
    <div class="card"><div class="bold mb">Thông tin công ty <span class="small muted" style="font-weight:400">(in trên báo giá)</span></div>
      <div class="fields">
        <div class="full"><label>Tên công ty / nhà thầu</label><input data-set="company" value="${esc(s.company)}" placeholder="Công ty TNHH Xây dựng ABC"></div>
        <div><label>Điện thoại</label><input data-set="phone" inputmode="tel" value="${esc(s.phone)}"></div>
        <div><label>Mã số thuế</label><input data-set="tax" value="${esc(s.tax)}"></div>
        <div class="full"><label>Địa chỉ</label><input data-set="address" value="${esc(s.address)}"></div>
      </div></div>
    <div class="card"><div class="bold mb">Dữ liệu</div>
      <p class="small muted mb">Dữ liệu được lưu ngay trên thiết bị này, không cần mạng. Hãy xuất file sao lưu định kỳ, hoặc dùng file sao lưu để chuyển dữ liệu giữa điện thoại và máy tính.</p>
      <div class="btns"><button class="btn" data-act="backup">⬇ Xuất sao lưu</button><button class="btn" data-act="restore">⬆ Nhập sao lưu</button>
      ${window.Sync?.signedIn() ? '' : '<button class="btn" data-act="sample">Thêm dữ liệu mẫu</button>'}<button class="btn danger" data-act="wipe">${window.Sync?.signedIn() ? 'Xóa dữ liệu trên máy này' : 'Xóa toàn bộ'}</button></div>
      <input type="file" id="restoreFile" accept=".json,application/json" hidden></div>
    <div class="card"><div class="bold mb">Cài đặt ứng dụng</div>
      <p class="small pre"><b>iPhone / iPad:</b> mở trang này bằng Safari → nút Chia sẻ → "Thêm vào Màn hình chính".
<b>Windows:</b> mở bằng Edge hoặc Chrome → biểu tượng cài đặt trên thanh địa chỉ → "Cài đặt ứng dụng".
<b>Android:</b> Chrome → menu ⋮ → "Cài đặt ứng dụng".</p></div>
    </div>`;
  },
};

// ---------- Sheet / biểu mẫu ----------
let sheetCleanup = null;
let formFiles = () => [];
function openSheet(html, wide) {
  const o = $('#overlay');
  o.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  o.hidden = false;
  return o.firstElementChild;
}
function closeSheet(keep) {
  if (!keep && sheetCleanup) sheetCleanup();
  sheetCleanup = null;
  $('#overlay').hidden = true; $('#overlay').innerHTML = '';
}
const projOptions = () => S.projects.map(p => [p.id, p.name]);

function fieldHTML(f, v) {
  const a = `name="${f.k}" id="f_${f.k}" ${f.required ? 'required' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}`;
  let inp;
  if (f.type === 'select') inp = `<select ${a}>${f.options.map(([k, t]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') inp = `<textarea ${a} rows="${f.rows || 3}">${esc(v)}</textarea>`;
  else if (f.type === 'money') inp = `<input ${a} data-money inputmode="numeric" class="right" value="${v ? fmt(v) : ''}">`;
  else if (f.type === 'number') inp = `<input ${a} inputmode="decimal" value="${v || ''}">`;
  else if (f.type === 'photos') inp = `<div class="thumbs" id="phThumbs"></div><div class="mt"><button type="button" class="btn sm" data-act="pickPhoto">📷 Thêm ảnh</button><input type="file" id="phFile" accept="image/*" multiple hidden></div>`;
  else if (f.type === 'files') inp = `<div id="flList"></div><div class="mt"><button type="button" class="btn sm" data-act="pickFile">📎 Thêm tệp / chụp ảnh</button><input type="file" id="flFile" multiple hidden></div>`;
  else inp = `<input ${a} type="${f.type || 'text'}" value="${esc(v)}">`;
  return `<div class="${f.half ? '' : 'full'}"><label for="f_${f.k}">${f.label}${f.required ? ' *' : ''}</label>${inp}</div>`;
}

function openForm({ title, fields, data, onSave, onDelete }) {
  const el = openSheet(`<header><h2>${title}</h2><button class="btn sm" data-act="closeSheet" type="button">Đóng</button></header>
    <form class="body" id="form" novalidate><div class="fields">${fields.map(f => fieldHTML(f, data[f.k] ?? '')).join('')}</div></form>
    <footer>${onDelete ? `<button class="btn danger" type="button" id="fDel">Xóa</button>` : ''}<button class="btn primary" type="submit" form="form">Lưu</button></footer>`);
  const form = $('#form', el);
  // Ảnh
  const pf = fields.find(f => f.type === 'photos');
  let photos = pf ? [...(data[pf.k] || [])] : null;
  const added = [];
  const drawPhotos = () => {
    $('#phThumbs', el).innerHTML = photos.map(id => `<div class="ph"><img data-ph="${id}" data-act="viewPhoto" alt="Ảnh"><button type="button" data-rm="${id}" aria-label="Bỏ ảnh">×</button></div>`).join('');
    hydratePhotos(el);
  };
  if (pf) {
    drawPhotos();
    $('#phFile', el).onchange = async e => {
      for (const file of e.target.files) {
        try { const id = uid(), src = await compressImage(file); await DB.set('photos', id, src); photoCache.set(id, src); photos.push(id); added.push(id); }
        catch (err) { toast('Không thêm được ảnh'); }
      }
      e.target.value = ''; drawPhotos();
    };
    $('#phThumbs', el).onclick = e => { const id = e.target.dataset.rm; if (id) { photos = photos.filter(x => x !== id); drawPhotos(); } };
  }
  // Tệp đính kèm
  const ff = fields.find(f => f.type === 'files');
  let files = ff ? [...(data[ff.k] || [])] : null;
  const addedF = [];
  const drawFiles = () => {
    $('#flList', el).innerHTML = files.map(f => `<div class="frow"><span class="grow clip tap" data-act="openFile" data-id="${f.id}">${fileIcon(f)} ${esc(f.name)}</span><span class="small muted">${fsize(f.size)}</span><button type="button" data-rmf="${f.id}" aria-label="Bỏ tệp">×</button></div>`).join('');
  };
  if (ff) {
    drawFiles();
    $('#flFile', el).onchange = async e => {
      for (const file of e.target.files) {
        if (file.size > 30e6) { toast('Tệp quá lớn (tối đa 30 MB)'); continue; }
        try {
          const blob = await shrinkImage(file), id = uid();
          await DB.set('files', id, blob);
          files.push({ id, name: file.name, type: blob.type || file.type, size: blob.size }); addedF.push(id);
        } catch (err) { toast('Không lưu được tệp — bộ nhớ đầy?'); }
      }
      e.target.value = ''; drawFiles();
    };
    $('#flList', el).addEventListener('click', e => { const id = e.target.dataset.rmf; if (id) { files = files.filter(x => x.id !== id); drawFiles(); } });
  }
  if (pf || ff) sheetCleanup = () => { added.forEach(id => DB.del('photos', id)); addedF.forEach(id => DB.del('files', id)); };
  formFiles = () => files || [];
  form.onsubmit = e => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      if (f.type === 'photos') { out[f.k] = photos; continue; }
      if (f.type === 'files') { out[f.k] = files; continue; }
      const v = form.elements[f.k].value.trim();
      if (f.required && !v) { toast(`Vui lòng nhập: ${f.label}`); form.elements[f.k].focus(); return; }
      out[f.k] = f.type === 'money' ? num(v) : f.type === 'number' ? dec(v) : v;
    }
    if (pf) (data[pf.k] || []).filter(id => !photos.includes(id)).forEach(id => DB.del('photos', id));
    if (ff) (data[ff.k] || []).filter(o => !files.some(x => x.id === o.id)).forEach(o => DB.del('files', o.id));
    onSave(out); closeSheet(true); save(); render(); toast('Đã lưu');
  };
  if (onDelete) $('#fDel', el).onclick = () => { if (confirm('Xóa mục này?')) { onDelete(); closeSheet(); save(); render(); toast('Đã xóa'); } };
}

function needProject() {
  if (S.projects.length) return true;
  toast('Hãy tạo dự án trước'); S.ui.tab = 'projects'; render(); formProject(); return false;
}

function formProject(id) {
  const p = proj(id);
  openForm({
    title: p ? 'Sửa dự án' : 'Dự án mới', data: p || { status: 'active', start: today() },
    fields: [
      { k: 'name', label: 'Tên dự án', required: true, ph: 'VD: Nhà phố anh Minh – Q.7' },
      { k: 'client', label: 'Chủ đầu tư', half: true }, { k: 'phone', label: 'Điện thoại', type: 'tel', half: true },
      { k: 'address', label: 'Địa chỉ công trình' },
      { k: 'start', label: 'Khởi công', type: 'date', half: true }, { k: 'end', label: 'Dự kiến xong', type: 'date', half: true },
      { k: 'contract', label: 'Giá trị hợp đồng (₫)', type: 'money', half: true }, { k: 'budget', label: 'Ngân sách chi phí (₫)', type: 'money', half: true },
      { k: 'status', label: 'Trạng thái', type: 'select', options: Object.entries(P_STATUS).map(([k, v]) => [k, v[0]]) },
      { k: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
    ],
    onSave: v => { if (p) Object.assign(p, v); else S.projects.unshift({ id: uid(), ...v }); },
    onDelete: p && (() => {
      S.logs.filter(l => l.projectId === id).forEach(l => (l.photos || []).forEach(ph => DB.del('photos', ph)));
      S.docs.filter(d => d.projectId === id).forEach(d => (d.files || []).forEach(f => DB.del('files', f.id)));
      for (const k of ['quotes', 'logs', 'costs', 'docs']) S[k] = S[k].filter(x => x.projectId !== id);
      S.projects = S.projects.filter(x => x.id !== id);
      if (S.ui.pid === id) S.ui.pid = '';
    }),
  });
}

function formLog(id) {
  if (!needProject()) return;
  const l = S.logs.find(x => x.id === id);
  openForm({
    title: l ? 'Sửa nhật ký' : 'Nhật ký thi công', data: l || { projectId: S.ui.pid || S.projects[0].id, date: today(), weather: WEATHER[0], photos: [] },
    fields: [
      { k: 'projectId', label: 'Dự án', type: 'select', options: projOptions() },
      { k: 'date', label: 'Ngày', type: 'date', half: true, required: true }, { k: 'weather', label: 'Thời tiết', type: 'select', half: true, options: WEATHER.map(w => [w, w]) },
      { k: 'workers', label: 'Số nhân công', type: 'number', half: true }, { k: 'supervisor', label: 'Người ghi', half: true },
      { k: 'content', label: 'Công việc thực hiện', type: 'textarea', rows: 4, required: true, ph: 'VD: Đổ bê tông sàn tầng 2, lắp cốp pha cột tầng 3…' },
      { k: 'issue', label: 'Vướng mắc / sự cố', type: 'textarea', rows: 2 },
      { k: 'photos', label: 'Hình ảnh hiện trường', type: 'photos' },
    ],
    onSave: v => { if (l) Object.assign(l, v); else S.logs.push({ id: uid(), ...v }); },
    onDelete: l && (() => { (l.photos || []).forEach(ph => DB.del('photos', ph)); S.logs = S.logs.filter(x => x.id !== id); }),
  });
}

function formCost(id) {
  if (!needProject()) return;
  const c = S.costs.find(x => x.id === id);
  openForm({
    title: c ? 'Sửa khoản thu chi' : 'Khoản thu chi mới', data: c || { projectId: S.ui.pid || S.projects[0].id, date: today(), type: S.ui.ctype || 'chi', cat: CATS[0] },
    fields: [
      { k: 'type', label: 'Loại', type: 'select', half: true, options: [['chi', 'Chi phí'], ['thu', 'Thu từ chủ đầu tư']] },
      { k: 'amount', label: 'Số tiền (₫)', type: 'money', half: true, required: true },
      { k: 'projectId', label: 'Dự án', type: 'select', options: projOptions() },
      { k: 'date', label: 'Ngày', type: 'date', half: true, required: true },
      { k: 'cat', label: 'Nhóm chi phí', type: 'select', half: true, options: CATS.map(x => [x, x]) },
      { k: 'desc', label: 'Nội dung', ph: 'VD: Mua 10 tấn thép Hòa Phát / Thanh toán đợt 2' },
      { k: 'vendor', label: 'Nhà cung cấp / người nhận' },
    ],
    onSave: v => { if (c) Object.assign(c, v); else S.costs.push({ id: uid(), ...v }); },
    onDelete: c && (() => { S.costs = S.costs.filter(x => x.id !== id); }),
  });
}

function formDoc(id) {
  if (!needProject()) return;
  const d = S.docs.find(x => x.id === id);
  openForm({
    title: d ? 'Sửa hồ sơ' : 'Lưu hồ sơ mới', data: d || { projectId: S.ui.pid || S.projects[0].id, date: today(), type: S.ui.dtype || DOC_TYPES[0], files: [] },
    fields: [
      { k: 'type', label: 'Loại hồ sơ', type: 'select', options: DOC_TYPES.map(x => [x, x]) },
      { k: 'projectId', label: 'Dự án', type: 'select', options: projOptions() },
      { k: 'title', label: 'Tên / nội dung', ph: 'VD: Hợp đồng thi công phần thô' },
      { k: 'no', label: 'Số văn bản', half: true, ph: 'VD: 01/2026/HĐTC' }, { k: 'date', label: 'Ngày ký / lập', type: 'date', half: true },
      { k: 'party', label: 'Bên liên quan / người ký' },
      { k: 'amount', label: 'Giá trị (₫) – nếu có', type: 'money' },
      { k: 'note', label: 'Ghi chú', type: 'textarea', rows: 2 },
      { k: 'files', label: 'Tệp đính kèm (ảnh chụp, PDF, Word, Excel…)', type: 'files' },
    ],
    onSave: v => { if (d) Object.assign(d, v); else S.docs.push({ id: uid(), ...v }); },
    onDelete: d && (() => { (d.files || []).forEach(f => DB.del('files', f.id)); S.docs = S.docs.filter(x => x.id !== id); }),
  });
}
async function openFile(id) {
  const meta = [...S.docs.flatMap(d => d.files || []), ...formFiles()].find(f => f.id === id);
  if (!meta) return toast('Không tìm thấy tệp');
  let blob = await DB.get('files', id).catch(() => null);
  if (!blob && window.Sync?.signedIn()) { toast('Đang tải tệp…'); blob = await Sync.fetchFile(id); }
  if (!blob) return toast('Không tìm thấy tệp trên thiết bị này');
  const url = URL.createObjectURL(blob);
  if (/^image\//.test(meta.type)) { $('#viewer img').src = url; $('#viewer').hidden = false; return; }
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  if (!/pdf/.test(meta.type)) a.download = meta.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// ---------- Trình lập báo giá ----------
function nextQuoteNo() {
  const y = new Date().getFullYear(), n = S.quotes.filter(q => (q.no || '').includes(`BG-${y}-`)).length + 1;
  return `BG-${y}-${String(n).padStart(3, '0')}`;
}
function formQuote(id) {
  if (!needProject()) return;
  const orig = S.quotes.find(x => x.id === id);
  const pid = S.ui.pid || S.projects[0].id;
  const q = orig ? JSON.parse(JSON.stringify(orig)) : { id: uid(), projectId: pid, no: nextQuoteNo(), date: today(), title: '', customer: proj(pid)?.client || '', status: 'draft', vat: 8, discount: 0, note: '', items: [{ name: '', unit: 'm²', qty: 0, price: 0 }] };
  const opt = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const el = openSheet(`<header><h2>${orig ? 'Báo giá ' + esc(q.no) : 'Lập báo giá'}</h2><button class="btn sm" data-act="closeSheet" type="button">Đóng</button></header>
  <div class="body">
    <div class="fields">
      <div class="full"><label>Tiêu đề</label><input data-q="title" value="${esc(q.title)}" placeholder="VD: Báo giá thi công phần thô"></div>
      <div class="full"><label>Dự án</label><select data-q="projectId">${opt(projOptions(), q.projectId)}</select></div>
      <div><label>Số báo giá</label><input data-q="no" value="${esc(q.no)}"></div>
      <div><label>Ngày</label><input data-q="date" type="date" value="${q.date}"></div>
      <div><label>Khách hàng</label><input data-q="customer" value="${esc(q.customer)}"></div>
      <div><label>Trạng thái</label><select data-q="status">${opt(Object.entries(Q_STATUS).map(([k, v]) => [k, v[0]]), q.status)}</select></div>
    </div>
    <div class="row between" style="margin:18px 0 8px"><b>Hạng mục</b>
      <select id="qTpl" style="width:auto;min-height:36px;padding:4px 10px;font-size:14px"><option value="">+ Thêm từ mẫu…</option>${Object.keys(TPL).map(k => `<option>${k}</option>`).join('')}</select></div>
    <div id="qItems"></div>
    <button class="btn" type="button" id="qAdd" style="width:100%">+ Thêm hạng mục</button>
    <div class="card totals">
      <div class="row between"><span>Tạm tính</span><b class="num" id="tSub"></b></div>
      <div class="row between"><span>Giảm giá <input data-q="discount" inputmode="decimal" value="${q.discount || 0}" aria-label="Giảm giá phần trăm"> %</span><span class="num" id="tDisc"></span></div>
      <div class="row between"><span>VAT <input data-q="vat" inputmode="decimal" value="${q.vat || 0}" aria-label="VAT phần trăm"> %</span><span class="num" id="tVat"></span></div>
      <div class="row between grand"><span>Tổng cộng</span><span class="num" id="tTotal"></span></div>
      <div class="small muted right" id="tWords"></div>
    </div>
    <div class="mt"><label>Ghi chú / điều khoản</label><textarea data-q="note" rows="3" placeholder="VD: Báo giá có hiệu lực 30 ngày. Thanh toán theo 4 đợt…">${esc(q.note)}</textarea></div>
    <div class="btns mt">
      <button class="btn sm" type="button" id="qPrint">🖨 In / lưu PDF</button>
      <button class="btn sm" type="button" id="qCsv">⬇ Excel</button>
      ${orig ? `<button class="btn sm" type="button" id="qDup">Nhân bản</button><button class="btn sm" type="button" id="qApply">Lấy làm giá trị hợp đồng</button><button class="btn sm danger" type="button" id="qDel">Xóa</button>` : ''}
    </div>
  </div>
  <footer><button class="btn primary" type="button" id="qSave">Lưu báo giá</button></footer>`, true);

  const totals = () => {
    const t = qTotal(q);
    $('#tSub', el).textContent = money(t.sub); $('#tDisc', el).textContent = '−' + money(t.disc);
    $('#tVat', el).textContent = '+' + money(t.vat); $('#tTotal', el).textContent = money(t.total);
    $('#tWords', el).textContent = docSo(t.total);
  };
  const drawItems = () => {
    $('#qItems', el).innerHTML = q.items.map((it, i) => `<div class="qi" data-i="${i}">
      <input class="nm" data-f="name" value="${esc(it.name)}" placeholder="Tên hạng mục / vật tư" aria-label="Tên hạng mục">
      <input data-f="unit" value="${esc(it.unit)}" placeholder="ĐVT" aria-label="Đơn vị tính">
      <input data-f="qty" inputmode="decimal" class="right" value="${it.qty || ''}" placeholder="KL" aria-label="Khối lượng">
      <input data-f="price" data-money inputmode="numeric" class="right" value="${it.price ? fmt(it.price) : ''}" placeholder="Đơn giá" aria-label="Đơn giá">
      <button class="del" type="button" data-del="${i}" aria-label="Xóa hạng mục">×</button>
      <div class="tt num">= ${money(it.qty * it.price)}</div></div>`).join('');
    totals();
  };
  drawItems();

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.q) q[t.dataset.q] = ['vat', 'discount'].includes(t.dataset.q) ? Math.max(0, dec(t.value)) : t.value;
    else if (t.dataset.f) {
      const row = t.closest('.qi'), it = q.items[+row.dataset.i], f = t.dataset.f;
      it[f] = f === 'qty' ? dec(t.value) : f === 'price' ? num(t.value) : t.value;
      $('.tt', row).textContent = '= ' + money(it.qty * it.price);
    }
    totals();
  });
  $('#qItems', el).addEventListener('click', e => { const i = e.target.dataset.del; if (i !== undefined) { q.items.splice(+i, 1); drawItems(); } });
  $('#qAdd', el).onclick = () => { q.items.push({ name: '', unit: 'm²', qty: 0, price: 0 }); drawItems(); $$('.qi .nm', el).pop().focus(); };
  $('#qTpl', el).onchange = e => {
    if (!e.target.value) return;
    q.items = q.items.filter(i => i.name || i.price || i.qty);
    q.items.push(...TPL[e.target.value].map(([name, unit]) => ({ name, unit, qty: 0, price: 0 })));
    if (!q.title) { q.title = 'Báo giá ' + e.target.value.toLowerCase(); $('[data-q=title]', el).value = q.title; }
    e.target.value = ''; drawItems();
  };
  const commit = () => {
    q.items = q.items.filter(i => i.name.trim() || i.price || i.qty);
    if (orig) Object.assign(orig, q); else S.quotes.push(q);
    save();
  };
  $('#qSave', el).onclick = () => { commit(); closeSheet(); render(); toast('Đã lưu báo giá'); };
  $('#qPrint', el).onclick = () => printHTML(quotePrintHTML(q));
  $('#qCsv', el).onclick = () => {
    const t = qTotal(q);
    downloadCSV(`${q.no}.csv`, [['STT', 'Hạng mục', 'ĐVT', 'Khối lượng', 'Đơn giá', 'Thành tiền'],
      ...q.items.map((i, n) => [n + 1, i.name, i.unit, i.qty, i.price, Math.round(i.qty * i.price)]),
      [], ['', 'Tạm tính', '', '', '', Math.round(t.sub)], ['', `Giảm giá ${q.discount || 0}%`, '', '', '', -Math.round(t.disc)], ['', `VAT ${q.vat || 0}%`, '', '', '', Math.round(t.vat)], ['', 'Tổng cộng', '', '', '', Math.round(t.total)]]);
  };
  if (orig) {
    $('#qDel', el).onclick = () => { if (confirm('Xóa báo giá này?')) { S.quotes = S.quotes.filter(x => x.id !== id); save(); closeSheet(); render(); toast('Đã xóa'); } };
    $('#qDup', el).onclick = () => { commit(); S.quotes.push({ ...JSON.parse(JSON.stringify(q)), id: uid(), no: nextQuoteNo(), date: today(), status: 'draft' }); save(); closeSheet(); render(); toast('Đã nhân bản báo giá'); };
    $('#qApply', el).onclick = () => {
      const p = proj(q.projectId), t = Math.round(qTotal(q).total);
      if (p && confirm(`Đặt giá trị hợp đồng của "${p.name}" thành ${money(t)}?`)) { p.contract = t; q.status = 'approved'; commit(); closeSheet(); render(); toast('Đã cập nhật giá trị hợp đồng'); }
    };
  }
}

// ---------- In & xuất file ----------
function printHTML(html) {
  $('#print').innerHTML = html;
  setTimeout(() => window.print(), 50);
}
function companyHead() {
  const s = S.settings;
  return `<div><b style="font-size:15px">${esc(s.company || 'TÊN CÔNG TY / NHÀ THẦU')}</b><br>${esc(s.address)}${s.phone ? `<br>ĐT: ${esc(s.phone)}` : ''}${s.tax ? ` · MST: ${esc(s.tax)}` : ''}</div>`;
}
function quotePrintHTML(q) {
  const t = qTotal(q), p = proj(q.projectId) || {};
  return `${companyHead()}<h1>BẢNG BÁO GIÁ</h1>
  <div class="c">Số: ${esc(q.no)} — Ngày ${fdate(q.date)}</div>
  <p style="margin-top:10px"><b>Kính gửi:</b> ${esc(q.customer || p.client)}<br><b>Công trình:</b> ${esc(p.name)}${p.address ? `<br><b>Địa điểm:</b> ${esc(p.address)}` : ''}${q.title ? `<br><b>Nội dung:</b> ${esc(q.title)}` : ''}</p>
  <table><thead><tr><th>STT</th><th>Hạng mục</th><th>ĐVT</th><th>Khối lượng</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>
  ${q.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.name)}</td><td class="c">${esc(i.unit)}</td><td class="r">${fmt(i.qty)}</td><td class="r">${fmt(i.price)}</td><td class="r">${fmt(Math.round(i.qty * i.price))}</td></tr>`).join('')}
  <tr><td colspan="5" class="r">Tạm tính</td><td class="r">${fmt(Math.round(t.sub))}</td></tr>
  ${q.discount ? `<tr><td colspan="5" class="r">Giảm giá ${fmt(q.discount)}%</td><td class="r">−${fmt(Math.round(t.disc))}</td></tr>` : ''}
  ${q.vat ? `<tr><td colspan="5" class="r">Thuế VAT ${fmt(q.vat)}%</td><td class="r">${fmt(Math.round(t.vat))}</td></tr>` : ''}
  <tr><td colspan="5" class="r"><b>TỔNG CỘNG (₫)</b></td><td class="r"><b>${fmt(Math.round(t.total))}</b></td></tr></tbody></table>
  <p style="margin-top:8px"><i>Bằng chữ: ${docSo(t.total)}.</i></p>
  ${q.note ? `<p class="pre" style="margin-top:8px"><b>Ghi chú:</b>\n${esc(q.note)}</p>` : ''}
  <div class="sign"><div><b>KHÁCH HÀNG</b><br><i>(Ký, ghi rõ họ tên)</i></div><div><b>ĐƠN VỊ BÁO GIÁ</b><br><i>(Ký, đóng dấu)</i></div></div>`;
}
async function printLogs() {
  const list = S.logs.filter(inScope).sort((a, b) => -byDateDesc(a, b));
  for (const l of list) for (const id of l.photos || []) await getPhoto(id);
  printHTML(`${companyHead()}<h1>NHẬT KÝ THI CÔNG</h1><div class="c">${esc(S.ui.pid ? pname(S.ui.pid) : 'Tất cả dự án')}</div>
  ${list.map(l => `<div class="entry"><b>Ngày ${fdate(l.date)}</b> — ${esc(l.weather || '')}${l.workers ? ` — Nhân công: ${fmt(l.workers)}` : ''}${S.ui.pid ? '' : ` — ${esc(pname(l.projectId))}`}${l.supervisor ? ` — Người ghi: ${esc(l.supervisor)}` : ''}
    <div class="pre">${esc(l.content)}</div>${l.issue ? `<div class="pre"><b>Vướng mắc:</b> ${esc(l.issue)}</div>` : ''}
    ${l.photos?.length ? `<div class="pimgs">${l.photos.map(id => photoCache.get(id) ? `<img src="${photoCache.get(id)}">` : '').join('')}</div>` : ''}</div>`).join('')}`);
}
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function downloadCSV(name, rows) {
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s) && isNaN(+s)) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  download(name, new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
}
async function backup() {
  const photos = {};
  for (const l of S.logs) for (const id of l.photos || []) photos[id] = await getPhoto(id);
  const files = {};
  for (const d of S.docs) for (const f of d.files || []) { const b = await DB.get('files', f.id); if (b) files[f.id] = await blobToDataURL(b); }
  download(`sao-luu-xay-dung-${today()}.json`, new Blob([JSON.stringify({ app: 'qlxd', v: 2, state: S, photos, files })], { type: 'application/json' }));
}
async function restore(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'qlxd' || !d.state || !Array.isArray(d.state.projects)) throw 0;
    if (!confirm(window.Sync?.signedIn()
      ? 'Nhập file này sẽ thay dữ liệu trên máy này, rồi gộp với dữ liệu chung trên máy chủ (bản trên máy chủ được ưu tiên, không mục nào trên máy chủ bị xóa). Tiếp tục?'
      : 'Nhập file này sẽ thay thế toàn bộ dữ liệu hiện tại. Tiếp tục?')) return;
    await DB.clear('photos'); await DB.clear('files'); photoCache.clear();
    for (const [id, src] of Object.entries(d.photos || {})) if (typeof src === 'string' && src.startsWith('data:image/')) await DB.set('photos', id, src);
    for (const [id, src] of Object.entries(d.files || {})) if (typeof src === 'string' && src.startsWith('data:')) await DB.set('files', id, await (await fetch(src)).blob());
    S = { ...blank(), ...d.state, settings: { ...blank().settings, ...d.state.settings }, ui: blank().ui };
    if (window.Sync) await Sync.reset(false);
    save(); render(); toast('Đã khôi phục dữ liệu');
  } catch (e) { toast('File sao lưu không hợp lệ'); }
}

function sampleData() {
  const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const p1 = uid(), p2 = uid() + 'b';
  S.projects.unshift(
    { id: p1, name: 'Nhà phố 4 tầng – anh Minh', client: 'Nguyễn Văn Minh', phone: '0901 234 567', address: '25 Đường số 7, Q.7, TP.HCM', start: d(45), end: '', status: 'active', contract: 2450000000, budget: 2050000000, note: '' },
    { id: p2, name: 'Cải tạo căn hộ – chị Lan', client: 'Trần Thị Lan', phone: '', address: 'Chung cư Sunrise, Q.7', start: d(10), end: '', status: 'prep', contract: 380000000, budget: 310000000, note: '' });
  S.quotes.push(
    { id: uid(), projectId: p1, no: nextQuoteNo(), date: d(50), title: 'Báo giá thi công phần thô', customer: 'Nguyễn Văn Minh', status: 'approved', vat: 8, discount: 2, note: 'Báo giá có hiệu lực 30 ngày.\nThanh toán theo 5 đợt theo tiến độ.',
      items: [{ name: 'Thi công phần thô (vật tư + nhân công)', unit: 'm²', qty: 320, price: 3900000 }, { name: 'Ép cọc bê tông 250x250', unit: 'md', qty: 480, price: 290000 }, { name: 'Chống thấm sàn mái, WC', unit: 'm²', qty: 95, price: 180000 }] });
  S.quotes.push({ id: uid(), projectId: p2, no: nextQuoteNo(), date: d(8), title: 'Báo giá cải tạo nội thất', customer: 'Trần Thị Lan', status: 'sent', vat: 8, discount: 0, note: '',
    items: [{ name: 'Tháo dỡ, đục phá', unit: 'm²', qty: 70, price: 150000 }, { name: 'Tủ bếp trên + dưới', unit: 'md', qty: 6.5, price: 7500000 }, { name: 'Sơn lại toàn bộ', unit: 'm²', qty: 260, price: 75000 }] });
  S.logs.push(
    { id: uid(), projectId: p1, date: d(2), weather: WEATHER[0], workers: 14, supervisor: '', content: 'Đổ bê tông sàn tầng 3 (38 m³), hoàn thành lúc 16h.\nBảo dưỡng bê tông sàn tầng 2.', issue: '', photos: [] },
    { id: uid(), projectId: p1, date: d(1), weather: WEATHER[2], workers: 9, supervisor: '', content: 'Xây tường bao tầng 2. Gia công cốt thép cột tầng 4.', issue: 'Mưa buổi chiều, nghỉ từ 15h. Xe cát về trễ 1 ngày.', photos: [] },
    { id: uid(), projectId: p1, date: d(0), weather: WEATHER[1], workers: 12, supervisor: '', content: 'Lắp cốp pha cột tầng 4. Xây tường ngăn tầng 2. Đi ống điện âm tường tầng 1.', issue: '', photos: [] });
  const c = (projectId, n, type, cat, amount, desc, vendor = '') => S.costs.push({ id: uid(), projectId, date: d(n), type, cat, amount, desc, vendor });
  c(p1, 44, 'thu', '', 490000000, 'Tạm ứng đợt 1 (20%)'); c(p1, 20, 'thu', '', 612500000, 'Thanh toán đợt 2');
  c(p1, 40, 'chi', 'Thầu phụ', 139200000, 'Ép cọc bê tông', 'Cty Nền Móng Việt'); c(p1, 30, 'chi', 'Vật tư', 186000000, 'Thép Hòa Phát 12 tấn', 'VLXD Phú Mỹ');
  c(p1, 22, 'chi', 'Vật tư', 94500000, 'Bê tông tươi M250 – 75 m³', 'Bê tông Lê Phan'); c(p1, 14, 'chi', 'Nhân công', 126000000, 'Lương đội thi công tháng 1');
  c(p1, 6, 'chi', 'Máy thi công', 18500000, 'Thuê bơm bê tông, giàn giáo'); c(p1, 2, 'chi', 'Vận chuyển', 6200000, 'Vận chuyển cát đá');
  c(p2, 5, 'thu', '', 114000000, 'Tạm ứng 30%'); c(p2, 3, 'chi', 'Nhân công', 10500000, 'Tháo dỡ hiện trạng');
  save(); render(); toast('Đã thêm dữ liệu mẫu');
}

// ---------- Sự kiện ----------
const ACT = {
  tab: d => { S.ui.tab = d.id; save(); render(); window.scrollTo(0, 0); },
  go: d => { S.ui.pid = d.id; S.ui.tab = d.tab; save(); render(); window.scrollTo(0, 0); },
  add: () => ({ projects: formProject, quotes: formQuote, logs: formLog, costs: formCost, docs: formDoc }[S.ui.tab] || formProject)(),
  editProject: d => formProject(d.id), editQuote: d => formQuote(d.id), editLog: d => formLog(d.id), editCost: d => formCost(d.id), editDoc: d => formDoc(d.id),
  dtype: d => { S.ui.dtype = d.id; save(); render(); },
  openFile: d => openFile(d.id),
  pickFile: () => $('#flFile').click(),
  ctype: d => { S.ui.ctype = d.id; save(); render(); },
  closeSheet: () => closeSheet(),
  pickPhoto: () => $('#phFile').click(),
  viewPhoto: (d, el) => { if (el.src) { $('#viewer img').src = el.src; $('#viewer').hidden = false; } },
  closeViewer: () => { $('#viewer').hidden = true; const i = $('#viewer img'); if (i.src.startsWith('blob:')) URL.revokeObjectURL(i.src); i.removeAttribute('src'); },
  printLogs, backup, sample: sampleData,
  restore: () => $('#restoreFile').click(),
  csvCosts: () => downloadCSV(`thu-chi-${today()}.csv`, [['Ngày', 'Dự án', 'Loại', 'Nhóm', 'Nội dung', 'Nhà cung cấp', 'Số tiền'],
    ...S.costs.filter(inScope).sort(byDateDesc).map(c => [fdate(c.date), pname(c.projectId), c.type === 'thu' ? 'Thu' : 'Chi', c.type === 'thu' ? '' : c.cat, c.desc, c.vendor, c.type === 'thu' ? c.amount : -c.amount])]),
  wipe: async () => {
    const online = window.Sync?.signedIn();
    if (!confirm(online
      ? 'Xóa toàn bộ dữ liệu trên MÁY NÀY và đăng xuất? Dữ liệu chung trên máy chủ và các máy khác vẫn giữ nguyên.'
      : 'Xóa TOÀN BỘ dự án, báo giá, nhật ký, chi phí và hồ sơ trên thiết bị này?')) return;
    const settings = S.settings; S = blank(); S.settings = settings; S.ui.tab = 'settings';
    await DB.clear('photos'); await DB.clear('files'); photoCache.clear();
    if (window.Sync) await Sync.reset(true);
    save(); render(); toast('Đã xóa dữ liệu trên máy này');
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) { e.stopPropagation(); ACT[el.dataset.act]?.(el.dataset, el); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-money]')) { const n = num(t.value); t.value = n ? fmt(n) : ''; }
  if (t.dataset.set) { S.settings[t.dataset.set] = t.value; save(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'pfilter') { S.ui.pid = e.target.value; save(); render(); }
  if (e.target.id === 'restoreFile' && e.target.files[0]) { restore(e.target.files[0]); e.target.value = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#viewer').hidden) ACT.closeViewer(); else if (!$('#overlay').hidden) closeSheet(); } });
window.addEventListener('afterprint', () => { $('#print').innerHTML = ''; });

(async function init() {
  await DB.open();
  try {
    const st = await DB.get('kv', 'state');
    if (st) S = { ...blank(), ...st, settings: { ...blank().settings, ...st.settings }, ui: { ...blank().ui, ...st.ui } };
  } catch (e) { /* bắt đầu với dữ liệu trống */ }
  if (S.ui.pid && !proj(S.ui.pid)) S.ui.pid = '';
  render();
  if (window.Sync) Sync.init();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
