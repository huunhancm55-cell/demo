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
    else if (v) s += ((t || full) ? ' linh ' : ' ') + d[v];
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
  projects: [], quotes: [], logs: [], costs: [], docs: [], tasks: [], changes: [],
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
const DOC_TYPES = ['Hợp đồng', 'Phiếu đề nghị cấp vật tư', 'Biên bản nghiệm thu', 'Giấy tạm ứng', 'Giấy ủy quyền', 'Phiếu phát sinh', 'Khác'];
const WEATHER = ['☀️ Nắng', '⛅ Mát', '🌧️ Mưa', '⛈️ Mưa to'];
// Mẫu hạng mục: T(tên, ĐVT, hệ số %, khối lượng) — có hệ số thì khối lượng = diện tích × hệ số; G(tên) là dòng nhóm
const T = (name, unit = 'm²', coef = 0, qty = 0) => ({ name, unit, qty, price: 0, ...(coef ? { area: 0, coef } : {}) });
const G = name => ({ head: true, name });
const TPL = {
  'Thiết kế kiến trúc': [T('Tầng trệt', 'm²', 100), T('Tầng lầu', 'm²', 100), T('Sân thượng, ban công không mái', 'm²', 50), T('Mái bê tông', 'm²', 50), T('Mái tôn, mái ngói', 'm²', 30)],
  'Nhân công thô + hoàn thiện': [G('NHÂN CÔNG THÔ + HOÀN THIỆN'), T('Diện tích sân (trước + sau)'), T('Tường rào, cổng', 'md'), T('Diện tích trệt'), T('Diện tích sàn lầu (gồm ban công)'), T('Diện tích tum (phòng SHC + thang)'), T('Diện tích sàn mái (sân thượng + mái tum)')],
  'Phần thô + NC hoàn thiện': [G('PHẦN THÔ + NHÂN CÔNG HOÀN THIỆN'), T('Phần móng', 'm²', 20), T('Diện tích trệt', 'm²', 100), T('Diện tích sàn lầu', 'm²', 100), T('Sân thượng', 'm²', 50), T('Mái', 'm²', 30), G('SÂN + HẠNG MỤC PHỤ'), T('Diện tích sân'), T('Tường rào, cổng', 'md')],
  'Khái toán trọn gói': [G('NHÀ CHÍNH'), T('Phần móng', 'm²', 20), T('Diện tích trệt', 'm²', 100), T('Diện tích sàn lầu', 'm²', 100), T('Mái', 'm²', 30), T('Móng cọc (dự kiến)', 'gói', 0, 1), G('SÂN + HẠNG MỤC PHỤ'), T('Diện tích sân'), T('Hàng rào + cổng', 'md')],
  'Phần thô nhà phố': [T('Đào móng, vận chuyển đất', 'm³'), T('Bê tông móng, đà kiềng', 'm³'), T('Cốt thép móng, cột, dầm, sàn', 'tấn'), T('Bê tông cột, dầm, sàn', 'm³'), T('Xây tường gạch'), T('Tô trát tường'), T('Chống thấm sàn mái, WC'), T('Hệ thống điện nước âm', 'm² sàn')],
  'Hoàn thiện': [T('Ốp lát gạch nền'), T('Ốp gạch tường WC'), T('Sơn nước nội thất'), T('Sơn nước ngoại thất'), T('Trần thạch cao'), T('Cửa đi, cửa sổ'), T('Lan can, cầu thang', 'md'), T('Thiết bị vệ sinh', 'bộ'), T('Thiết bị điện, đèn', 'gói')],
  'Nội thất': [T('Tủ bếp trên + dưới', 'md'), T('Tủ quần áo'), T('Giường ngủ', 'cái'), T('Kệ tivi', 'md'), T('Bàn làm việc', 'cái'), T('Vận chuyển, lắp đặt', 'gói')],
  'Sửa chữa cải tạo': [T('Tháo dỡ, đục phá'), T('Vận chuyển xà bần', 'chuyến'), T('Xây tô lại'), T('Chống thấm'), T('Sơn lại toàn bộ'), T('Thay mới điện nước', 'gói')],
};

// Hình thức báo giá. Thiết kế, Nhân công, Trọn gói thô: xuất Excel + soạn hợp đồng. Trọn gói hoàn thiện: xuất khái toán.
// Đợt thanh toán lấy theo "Quy trình làm việc Hữu Nhân" (mục 4 và 6).
const FORMS = {
  design: {
    name: 'Thiết kế', deftitle: 'Báo giá thiết kế kiến trúc', title: 'BÁO GIÁ THIẾT KẾ KIẾN TRÚC', coef: true, tpl: 'Thiết kế kiến trúc',
    ct: 'HỢP ĐỒNG TƯ VẤN THIẾT KẾ XÂY DỰNG', ctName: 'Hợp đồng tư vấn thiết kế', ctCode: 'HĐTK', sideB: 'BÊN TƯ VẤN THIẾT KẾ',
    info: ['Quy mô', 'Đất', 'Tầng trệt', 'Tầng lầu', 'Gói thiết kế'],
    pay: [
      { pct: 30, label: 'Khi ký hợp đồng', note: 'Khảo sát, đo đạc, lên mặt bằng – sửa đến khi chốt', days: '7–10 ngày' },
      { pct: 40, label: 'Khi Bên A duyệt phối cảnh 3D', note: 'Phối cảnh 3D mặt tiền – sửa 3 lần', days: '10–15 ngày' },
      { pct: 30, label: 'Khi Bên B bàn giao hồ sơ thiết kế', note: 'Kiến trúc, kết cấu, điện nước; nộp hồ sơ xin phép', days: '15–20 ngày' }],
  },
  labor: {
    name: 'Nhân công', deftitle: 'Báo giá nhân công thô + hoàn thiện', title: 'BẢNG BÁO GIÁ NHÂN CÔNG', coef: false, tpl: 'Nhân công thô + hoàn thiện',
    ct: 'HỢP ĐỒNG THI CÔNG XÂY DỰNG (NHÂN CÔNG)', ctName: 'Hợp đồng nhân công', ctCode: 'HĐNC', sideB: 'BÊN NHẬN THẦU',
    info: ['Quy mô', 'Diện tích'],
    note: 'Khối lượng tạm tính, quyết toán theo khối lượng thực tế.\nChủ nhà cung cấp toàn bộ vật tư, điện nước thi công.',
    pay: [{ pct: 20, label: 'Tạm ứng khi ký hợp đồng' }, { pct: 70, label: 'Khi hoàn thành 70% khối lượng' }, { pct: 10, label: 'Khi nghiệm thu bàn giao công trình' }],
  },
  rough: {
    name: 'Trọn gói thô', deftitle: 'Báo giá phần thô + nhân công hoàn thiện', title: 'BÁO GIÁ PHẦN THÔ + NHÂN CÔNG HOÀN THIỆN', coef: true, tpl: 'Phần thô + NC hoàn thiện',
    ct: 'HỢP ĐỒNG THI CÔNG XÂY DỰNG NHÀ Ở (TRỌN GÓI VẬT TƯ THÔ VÀ NHÂN CÔNG HOÀN THIỆN)', ctName: 'Hợp đồng thi công phần thô + NC hoàn thiện', ctCode: 'HĐTC', sideB: 'BÊN NHẬN THẦU',
    info: ['Quy mô', 'Diện tích', 'Kết cấu mái'],
    note: 'Công ty cung cấp vật tư phần thô và toàn bộ nhân công; chủ nhà cung cấp vật tư hoàn thiện (gạch, sơn, thiết bị điện nước, cửa, đá…).\nDiện tích tạm tính, tính lại theo bản vẽ khi chốt.',
    pay: [{ pct: 20, label: 'Tạm ứng khi ký hợp đồng' }, { pct: 20, label: 'Khi xong bê tông móng' }, { pct: 20, label: 'Khi xong sàn tầng 2' }, { pct: 20, label: 'Khi xong sàn mái' }, { pct: 15, label: 'Khi xong xây tô' }, { pct: 5, label: 'Khi nghiệm thu bàn giao công trình' }],
  },
  full: {
    name: 'Trọn gói hoàn thiện', deftitle: 'Khái toán xây dựng trọn gói', title: 'BẢNG KHÁI TOÁN XÂY DỰNG', coef: true, tpl: 'Khái toán trọn gói',
    info: ['Quy mô', 'Diện tích', 'Kết cấu mái', 'Mức hoàn thiện'],
    note: 'Đơn giá hoàn thiện cơ bản, chưa gồm nội thất rời.\nPhần móng hệ số 20% chưa gồm cọc; móng cọc là chi phí dự kiến, tính lại theo thiết kế kết cấu.\nDiện tích tạm tính, quy đổi theo hệ số; tính lại theo bản vẽ khi chốt.\nGiá tham khảo, chưa phải giá hợp đồng; giá hợp đồng lấy theo dự toán chi tiết đã ký.\nChưa gồm phí thiết kế (báo riêng), lệ phí cấp phép, điện 3 pha, VAT.',
  },
};

// Phí thiết kế = diện tích tính phí × đơn giá gói × K1 × K2 × K3, không thấp hơn phí tối thiểu ("Hướng dẫn báo giá thiết kế – Hữu Nhân")
const DZ = {
  pkg: {
    G1: { name: 'G1 – Bản vẽ xin phép', base: 60000, min: 8e6, k: false, desc: 'Bản vẽ xin phép xây dựng',
      deliver: ['2 bộ bản vẽ xin phép khổ A3 ký, đóng dấu + file PDF'] },
    G2: { name: 'G2 – Kiến trúc trọn bộ', base: 200000, min: 20e6, k: true, desc: 'Kiến trúc trọn bộ: 3D mặt tiền, kiến trúc, kết cấu, điện nước + nộp hồ sơ xin phép',
      deliver: ['2 bộ A3 ký, đóng dấu + file PDF', 'Công ty nộp hồ sơ xin phép thay chủ nhà', 'Kỹ thuật công ty theo sát suốt quá trình thi công'],
      offer: [['Trọn gói – trừ 50%', 0.5], ['Thô + NC hoàn thiện – trừ 30%', 0.3]] },
    G3: { name: 'G3 – Nội thất', base: 200000, min: 15e6, k: true, desc: 'Nội thất: 3D từng không gian, khai triển, chi tiết sản xuất',
      deliver: ['2 bộ A3 ký, đóng dấu + file PDF', 'Bảng vật liệu và chi tiết sản xuất đồ nội thất'],
      offer: [['Thi công nội thất – trừ 50%', 0.5]] },
    G4: { name: 'G4 – Kiến trúc + nội thất', base: 360000, min: 35e6, k: true, desc: 'Kiến trúc + nội thất trọn bộ',
      deliver: ['2 bộ A3 ký, đóng dấu + file PDF', 'Công ty nộp hồ sơ xin phép thay chủ nhà', 'Bảng vật liệu và chi tiết sản xuất đồ nội thất'],
      offer: [['Trọn gói – trừ 50%', 0.5], ['Thô + NC hoàn thiện – trừ 30%', 0.3]] },
  },
  k1: { modern: [1, 'Hiện đại, tối giản', 'hiện đại'], premium: [1.2, 'Hiện đại cao cấp, Indochine, Japandi, nhiệt đới', 'hiện đại cao cấp'], neo: [1.4, 'Tân cổ điển', 'tân cổ điển'], classic: [1.6, 'Cổ điển', 'cổ điển'] },
  k3: { town: [1, 'Nhà phố, nhà vườn, nhà cấp 4', 'nhà phố'], hotel: [1.1, 'Khách sạn, nhà nghỉ, căn hộ dịch vụ', 'khách sạn'], villa: [1.2, 'Biệt thự', 'biệt thự'], reno: [1.2, 'Cải tạo, nâng tầng', 'cải tạo'], shop: [1.2, 'Thương mại – dịch vụ', 'thương mại'] },
};
const k2Of = a => a < 100 ? 1 : a < 200 ? 1.1 : a < 400 ? 1 : a < 800 ? 0.9 : 0.8;

// ---------- Tính toán ----------
const proj = id => S.projects.find(p => p.id === id);
const pname = id => proj(id)?.name || '(Chưa chọn dự án)';
const inScope = x => !S.ui.pid || x.projectId === S.ui.pid;
// Khối lượng một dòng: diện tích × hệ số % khi có, ngược lại là khối lượng nhập tay
const iq = i => (+i.area > 0 && +i.coef > 0) ? Math.round(i.area * i.coef) / 100 : (+i.qty || 0);
function dzOf(q, area) {
  const d = q.dz || {}, P = DZ.pkg[d.pkg] || DZ.pkg.G2, a = DZ.k1[d.k1] || DZ.k1.modern, c = DZ.k3[d.k3] || DZ.k3.town;
  const k1 = P.k ? a[0] : 1, k2 = P.k ? k2Of(area) : 1, k3 = P.k ? c[0] : 1;
  return { P, area, k1, k2, k3, k1s: a[2], k3s: c[2], unit: Math.round(P.base * k1 * k2 * k3), min: P.min };
}
const dzFormula = d => d.P.k ? `${fmt(d.P.base)} đ × ${fmt(d.k1)} (${d.k1s}) × ${fmt(d.k2)} (quy mô) × ${fmt(d.k3)} (${d.k3s})` : `${fmt(d.P.base)} đ (gói G1 không nhân hệ số)`;
function qTotal(q) {
  const items = (q.items || []).filter(i => !i.head);
  const dz = q.form === 'design' ? dzOf(q, Math.round(items.reduce((t, i) => t + iq(i), 0) * 100) / 100) : null;
  const line = i => i.head ? 0 : Math.round(iq(i) * (dz ? dz.unit : (+i.price || 0)));
  const raw = items.reduce((t, i) => t + line(i), 0);
  const minApplied = !!(dz && raw > 0 && raw < dz.min);
  const sub = minApplied ? dz.min : raw;
  const disc = Math.round(sub * (+q.discount || 0) / 100), vat = Math.round((sub - disc) * (+q.vat || 0) / 100);
  return { raw, sub, disc, vat, total: sub - disc + vat, line, dz, minApplied };
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
    </div>${window.dueBannerHTML ? dueBannerHTML() : ''}<div class="list cols">${S.projects.map(p => {
      const m = pMoney(p.id), base = p.budget || p.contract, pct = base ? Math.round(m.chi / base * 100) : 0;
      const nq = S.quotes.filter(q => q.projectId === p.id).length, nl = S.logs.filter(l => l.projectId === p.id).length;
      const cover = (p.photos || [])[0];
      return `<div class="card pcard">${cover ? `<img class="cover" data-ph="${cover}" data-act="viewPhoto" alt="Phối cảnh ${esc(p.name)}">`
        : `<button type="button" class="cover add" data-act="addCover" data-id="${p.id}">📷 Thêm ảnh phối cảnh 3D</button>`}
        <div class="row between tap" data-act="editProject" data-id="${p.id}">
          <div class="grow"><div class="bold clip">${esc(p.name)}</div><div class="small muted clip">${esc([p.client, p.address].filter(Boolean).join(' · ') || 'Chưa có thông tin khách hàng')}</div></div>
          ${badge(P_STATUS[p.status] || P_STATUS.prep)}
        </div>
        <div class="row between wrap small mt"><span class="muted">Chi phí / ${p.budget ? 'ngân sách' : 'hợp đồng'}</span><span class="num"><b>${short(m.chi)}</b> / ${short(base)}${base ? ` (${pct}%)` : ''}</span></div>
        <div class="bar mt"><i class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></i></div>
        <div class="row between wrap small mt"><span class="muted">Đã thu <b class="pos num">${short(m.thu)}</b></span><span class="muted">Lãi tạm tính <b class="num ${p.contract - m.chi < 0 ? 'neg' : 'pos'}">${short(p.contract - m.chi)}</b></span></div>
        ${window.progressSummaryHTML ? progressSummaryHTML(p) : ''}
        <div class="row wrap mt" style="column-gap:16px">
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="quotes">Báo giá (${nq})</button>
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="logs">Nhật ký (${nl})</button>
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="costs">Chi phí</button>
          <button class="linkbtn" data-act="go" data-id="${p.id}" data-tab="docs">Hồ sơ (${S.docs.filter(d => d.projectId === p.id).length})</button>
          ${window.progressLinkLabel ? `<button class="linkbtn" data-act="openProgress" data-id="${p.id}">${progressLinkLabel(p)}</button>` : ''}
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
      <div class="row between mt"><span class="small muted">${q.form && FORMS[q.form] ? `<span class="badge orange">${FORMS[q.form].name}</span> ` : ''}${(q.items || []).filter(i => !i.head).length} hạng mục</span><span class="bold num">${money(qTotal(q).total)}</span></div></div>`).join('')}</div>`;
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
    <div class="card"><div class="bold mb">Thông tin công ty <span class="small muted" style="font-weight:400">(in trên báo giá, hợp đồng)</span></div>
      <div class="fields">
        <div class="full"><label>Tên công ty / nhà thầu</label><input data-set="company" value="${esc(s.company)}" placeholder="Công ty TNHH Xây dựng ABC"></div>
        <div><label>Điện thoại</label><input data-set="phone" inputmode="tel" value="${esc(s.phone)}"></div>
        <div><label>Mã số thuế</label><input data-set="tax" value="${esc(s.tax)}"></div>
        <div class="full"><label>Địa chỉ</label><input data-set="address" value="${esc(s.address)}"></div>
        <div><label>Người đại diện ký hợp đồng</label><input data-set="rep" value="${esc(s.rep)}" placeholder="Họ tên"></div>
        <div><label>Chức vụ</label><input data-set="repTitle" value="${esc(s.repTitle)}" placeholder="VD: Giám đốc"></div>
        <div class="full"><label>Tài khoản ngân hàng</label><input data-set="bank" value="${esc(s.bank)}" placeholder="VD: 0123456789 – Ngân hàng …, chi nhánh …"></div>
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
        try { const id = uid(), src = await compressImage(file, pf.max || 1280); await DB.set('photos', id, src); photoCache.set(id, src); photos.push(id); added.push(id); }
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
      { k: 'photos', label: 'Ảnh phối cảnh 3D (ảnh đầu tiên hiện trên thẻ dự án)', type: 'photos', max: 1600 },
    ],
    onSave: v => { if (p) Object.assign(p, v); else S.projects.unshift({ id: uid(), ...v }); },
    onDelete: p && (() => {
      (p.photos || []).forEach(ph => DB.del('photos', ph));
      S.logs.filter(l => l.projectId === id).forEach(l => (l.photos || []).forEach(ph => DB.del('photos', ph)));
      S.docs.filter(d => d.projectId === id).forEach(d => (d.files || []).forEach(f => DB.del('files', f.id)));
      S.tasks.filter(t => t.projectId === id).forEach(t => (t.photos || []).forEach(ph => DB.del('photos', ph)));
      S.changes.filter(c => c.projectId === id).forEach(c => (c.photos || []).forEach(ph => DB.del('photos', ph)));
      for (const k of ['quotes', 'logs', 'costs', 'docs', 'tasks', 'changes']) S[k] = S[k].filter(x => x.projectId !== id);
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
  if (!/pdf/.test(meta.type)) a.download = fileSafe(meta.name);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// ---------- Trình lập báo giá ----------
function nextQuoteNo() {
  const y = new Date().getFullYear(), n = S.quotes.filter(q => (q.no || '').includes(`BG-${y}-`)).length + 1;
  return `BG-${y}-${String(n).padStart(3, '0')}`;
}
const newItem = () => ({ name: '', unit: 'm²', qty: 0, price: 0 });
// Bản sạch để lưu / xuất: bỏ dòng trống, đơn giá thiết kế theo hệ số
function cleanQuote(q) {
  q.items = (q.items || []).filter(i => i.head ? (i.name || '').trim() : ((i.name || '').trim() || i.price || i.qty || i.area));
  q.info = (q.info || []).filter(r => (r.k || '').trim() || (r.v || '').trim());
  const t = qTotal(q);
  if (t.dz) q.items.forEach(i => { if (!i.head) i.price = t.dz.unit; });
  return q;
}
function formQuote(id) {
  if (!needProject()) return;
  const orig = S.quotes.find(x => x.id === id);
  const pid = S.ui.pid || S.projects[0].id;
  const q = orig ? JSON.parse(JSON.stringify(orig)) : { id: uid(), projectId: pid, no: nextQuoteNo(), date: today(), title: '', customer: proj(pid)?.client || '', status: 'draft', form: '', coef: false, vat: 0, discount: 0, note: '', info: [], items: [newItem()] };
  q.items = q.items || []; q.info = q.info || [];
  const opt = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const el = openSheet(`<header><h2>${orig ? 'Báo giá ' + esc(q.no) : 'Lập báo giá'}</h2><button class="btn sm" data-act="closeSheet" type="button">Đóng</button></header>
  <div class="body">
    <div class="fields">
      <div class="full"><label>Hình thức</label><select data-q="form">${opt([['', '— Chọn hình thức —'], ...Object.entries(FORMS).map(([k, f]) => [k, f.name])], q.form || '')}</select></div>
      <div class="full"><label>Tiêu đề</label><input data-q="title" value="${esc(q.title)}" placeholder="VD: Báo giá thi công phần thô"></div>
      <div class="full"><label>Dự án</label><select data-q="projectId">${opt(projOptions(), q.projectId)}</select></div>
      <div><label>Số báo giá</label><input data-q="no" value="${esc(q.no)}"></div>
      <div><label>Ngày</label><input data-q="date" type="date" value="${q.date}"></div>
      <div><label>Khách hàng</label><input data-q="customer" value="${esc(q.customer)}"></div>
      <div><label>Trạng thái</label><select data-q="status">${opt(Object.entries(Q_STATUS).map(([k, v]) => [k, v[0]]), q.status)}</select></div>
    </div>
    <div id="qDz"></div>
    <div class="row between" style="margin:18px 0 8px"><b>Thông tin công trình</b><button class="linkbtn" type="button" id="qInfoAdd">+ Thêm dòng</button></div>
    <div id="qInfo"></div>
    <div class="row between wrap" style="margin:18px 0 8px;gap:8px"><b>Hạng mục</b>
      <label class="chk"><input type="checkbox" id="qCoef" ${q.coef ? 'checked' : ''}> Diện tích × hệ số</label>
      <select id="qTpl" style="width:auto;min-height:36px;padding:4px 10px;font-size:14px"><option value="">+ Thêm từ mẫu…</option>${Object.keys(TPL).map(k => `<option>${esc(k)}</option>`).join('')}</select></div>
    <div id="qItems"></div>
    <div class="btns"><button class="btn" type="button" id="qAdd" style="flex:1">+ Thêm hạng mục</button><button class="btn" type="button" id="qAddH">+ Thêm nhóm</button></div>
    <div class="card totals">
      <div class="row between"><span>Tạm tính</span><b class="num" id="tSub"></b></div>
      <div class="row between" id="tMinRow" hidden><span>Áp phí tối thiểu</span><b class="num" id="tMin"></b></div>
      <div class="row between"><span>Giảm giá <input data-q="discount" inputmode="decimal" value="${q.discount || 0}" aria-label="Giảm giá phần trăm"> %</span><span class="num" id="tDisc"></span></div>
      <div class="row between"><span>VAT <input data-q="vat" inputmode="decimal" value="${q.vat || 0}" aria-label="VAT phần trăm"> %</span><span class="num" id="tVat"></span></div>
      <div class="row between grand"><span>Tổng cộng</span><span class="num" id="tTotal"></span></div>
      <div class="small muted right" id="tWords"></div>
    </div>
    <div class="mt"><label>Ghi chú / điều khoản</label><textarea data-q="note" rows="3" placeholder="Mỗi dòng là một ý">${esc(q.note)}</textarea></div>
    <div class="btns mt" id="qBtns"></div>
  </div>
  <footer><button class="btn primary" type="button" id="qSave">Lưu báo giá</button></footer>`, true);
  const $q = sel => $(sel, el);

  const drawDz = () => {
    if (q.form !== 'design') { $q('#qDz').innerHTML = ''; return; }
    q.dz = q.dz || { pkg: 'G2', k1: 'modern', k3: 'town' };
    $q('#qDz').innerHTML = `<div class="card mt"><div class="bold small mb">Cách tính phí thiết kế</div><div class="fields">
      <div class="full"><label>Gói thiết kế</label><select data-dz="pkg">${opt(Object.entries(DZ.pkg).map(([k, v]) => [k, `${v.name} – ${fmt(v.base)} đ/m²`]), q.dz.pkg)}</select></div>
      <div><label>K1 – Phong cách</label><select data-dz="k1">${opt(Object.entries(DZ.k1).map(([k, v]) => [k, `${v[1]} (${fmt(v[0])})`]), q.dz.k1)}</select></div>
      <div><label>K3 – Loại công trình</label><select data-dz="k3">${opt(Object.entries(DZ.k3).map(([k, v]) => [k, `${v[1]} (${fmt(v[0])})`]), q.dz.k3)}</select></div>
    </div><p class="small muted mt" id="dzLine"></p></div>`;
  };
  const drawInfo = () => {
    $q('#qInfo').innerHTML = q.info.map((r, i) => `<div class="kvrow" data-n="${i}"><input data-iv="k" value="${esc(r.k)}" placeholder="Mục" aria-label="Mục"><input data-iv="v" value="${esc(r.v)}" placeholder="Nội dung" aria-label="Nội dung"><button type="button" class="del" data-idel="${i}" aria-label="Xóa dòng">×</button></div>`).join('')
      || '<p class="small muted">Không bắt buộc. VD: Quy mô, Diện tích, Kết cấu mái, Mức hoàn thiện.</p>';
  };
  const drawItems = () => {
    const K = !!q.coef, ro = q.form === 'design';
    $q('#qItems').innerHTML = q.items.map((it, i) => it.head
      ? `<div class="qi h" data-i="${i}"><input class="nm" data-f="name" value="${esc(it.name)}" placeholder="Tên nhóm (VD: NHÀ CHÍNH)" aria-label="Tên nhóm"><div class="tt num"></div><button class="del" type="button" data-del="${i}" aria-label="Xóa nhóm">×</button></div>`
      : `<div class="qi${K ? ' k' : ''}" data-i="${i}">
      <input class="nm" data-f="name" value="${esc(it.name)}" placeholder="Tên hạng mục / công việc" aria-label="Tên hạng mục">
      <input class="un" data-f="unit" value="${esc(it.unit)}" placeholder="ĐVT" aria-label="Đơn vị tính">
      ${K ? `<input class="ar right" data-f="area" inputmode="decimal" value="${it.area || ''}" placeholder="Diện tích" aria-label="Diện tích">
      <input class="cf right" data-f="coef" inputmode="decimal" value="${it.coef || ''}" placeholder="Hệ số %" aria-label="Hệ số phần trăm">` : ''}
      <input class="ql right" data-f="qty" inputmode="decimal" value="${it.qty || ''}" placeholder="${K ? 'KL quy đổi' : 'KL'}" aria-label="Khối lượng">
      <input class="pr right" data-f="price" data-money inputmode="numeric" value="${it.price ? fmt(it.price) : ''}" placeholder="Đơn giá" aria-label="Đơn giá"${ro ? ' readonly' : ''}>
      <button class="del" type="button" data-del="${i}" aria-label="Xóa hạng mục">×</button>
      <div class="tt num"></div></div>`).join('');
    refresh();
  };
  const refresh = () => {
    const t = qTotal(q);
    $$('.qi', el).forEach(row => {
      const n = +row.dataset.i, it = q.items[n];
      if (!it) return;
      if (it.head) {
        let g = 0;
        for (let j = n + 1; j < q.items.length && !q.items[j].head; j++) g += t.line(q.items[j]);
        $('.tt', row).textContent = '= ' + money(g); return;
      }
      const ql = $('.ql', row), pr = $('.pr', row), auto = q.coef && +it.area > 0 && +it.coef > 0;
      ql.readOnly = auto;
      if (auto && document.activeElement !== ql) ql.value = String(iq(it)).replace('.', ',');
      if (t.dz && document.activeElement !== pr) pr.value = fmt(t.dz.unit);
      $('.tt', row).textContent = '= ' + money(t.line(it));
    });
    $q('#tSub').textContent = money(t.raw);
    $q('#tMinRow').hidden = !t.minApplied; $q('#tMin').textContent = money(t.sub);
    $q('#tDisc').textContent = '−' + money(t.disc); $q('#tVat').textContent = '+' + money(t.vat);
    $q('#tTotal').textContent = money(t.total); $q('#tWords').textContent = docSo(t.total);
    if (t.dz && $q('#dzLine')) $q('#dzLine').textContent = `Diện tích tính phí ${fmt(t.dz.area)} m² → K2 = ${fmt(t.dz.k2)}. Đơn giá: ${dzFormula(t.dz)} = ${fmt(t.dz.unit)} đ/m². Phí tối thiểu ${fmt(t.dz.min)} đ.`;
  };
  const drawBtns = () => {
    const F = FORMS[q.form];
    $q('#qBtns').innerHTML = (q.form === 'full'
      ? `<button class="btn sm primary" type="button" data-qa="print">📄 Xuất khái toán (PDF)</button>`
      : `<button class="btn sm" type="button" data-qa="print">🖨 In / lưu PDF</button>${F ? `<button class="btn sm" type="button" data-qa="xlsx">⬇ Xuất Excel</button><button class="btn sm" type="button" data-qa="ct">📝 Soạn hợp đồng</button>` : ''}`)
      + (orig ? `<button class="btn sm" type="button" data-qa="dup">Nhân bản</button><button class="btn sm" type="button" data-qa="apply">Lấy làm giá trị hợp đồng</button><button class="btn sm danger" type="button" data-qa="del">Xóa</button>` : '')
      + (F ? '' : `<p class="small muted" style="flex-basis:100%">Chọn <b>Hình thức</b> để xuất Excel và soạn hợp đồng (Thiết kế, Nhân công, Trọn gói thô) hoặc xuất khái toán (Trọn gói hoàn thiện).</p>`);
  };
  const setForm = f => {
    q.form = f;
    const F = FORMS[f];
    if (F) {
      q.coef = F.coef; $q('#qCoef').checked = q.coef;
      if (f === 'design') q.dz = q.dz || { pkg: 'G2', k1: 'modern', k3: 'town' };
      if (!q.info.some(r => (r.v || '').trim())) q.info = F.info.map(k => ({ k, v: k === 'Gói thiết kế' ? DZ.pkg[q.dz.pkg].desc : '' }));
      if (!(q.note || '').trim() && F.note) { q.note = F.note; $q('[data-q=note]').value = q.note; }
      if (!(q.title || '').trim()) { q.title = F.deftitle; $q('[data-q=title]').value = q.title; }
      if (!q.items.some(i => (i.name || '').trim())) q.items = TPL[F.tpl].map(x => ({ ...x }));
    }
    drawDz(); drawInfo(); drawItems(); drawBtns();
  };
  drawDz(); drawInfo(); drawItems(); drawBtns();

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.q) { if (t.dataset.q === 'form') return; q[t.dataset.q] = ['vat', 'discount'].includes(t.dataset.q) ? Math.max(0, dec(t.value)) : t.value; }
    else if (t.dataset.f) { const it = q.items[+t.closest('.qi').dataset.i], f = t.dataset.f; it[f] = ['qty', 'area', 'coef'].includes(f) ? dec(t.value) : f === 'price' ? num(t.value) : t.value; }
    else if (t.dataset.iv) { q.info[+t.closest('.kvrow').dataset.n][t.dataset.iv] = t.value; return; }
    else return;
    refresh();
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.q === 'form') setForm(t.value);
    else if (t.id === 'qCoef') { q.coef = t.checked; drawItems(); }
    else if (t.dataset.dz) {
      const old = DZ.pkg[q.dz.pkg].desc;
      q.dz[t.dataset.dz] = t.value;
      const row = q.info.find(r => r.k === 'Gói thiết kế');
      if (t.dataset.dz === 'pkg' && row && (!row.v || row.v === old)) { row.v = DZ.pkg[t.value].desc; drawInfo(); }
      refresh();
    }
  });
  el.addEventListener('click', e => {
    const t = e.target;
    if (t.dataset.del !== undefined) { q.items.splice(+t.dataset.del, 1); drawItems(); }
    else if (t.dataset.idel !== undefined) { q.info.splice(+t.dataset.idel, 1); drawInfo(); }
  });
  $q('#qInfoAdd').onclick = () => { q.info.push({ k: '', v: '' }); drawInfo(); $$('.kvrow input', el).slice(-2)[0].focus(); };
  $q('#qAdd').onclick = () => { q.items.push(newItem()); drawItems(); $$('.qi .nm', el).pop().focus(); };
  $q('#qAddH').onclick = () => { q.items.push({ head: true, name: '' }); drawItems(); $$('.qi .nm', el).pop().focus(); };
  $q('#qTpl').onchange = e => {
    const name = e.target.value;
    e.target.value = '';
    if (!name) return;
    const kept = q.items.filter(i => i.head ? (i.name || '').trim() : ((i.name || '').trim() || i.price || i.qty || i.area));
    // Đã có hạng mục: hỏi thay thế hay thêm vào cuối
    const replace = kept.length > 0 && confirm(`Báo giá đang có ${kept.length} dòng.\n\nOK = THAY bằng mẫu "${name}"\nHủy = THÊM mẫu vào cuối danh sách`);
    const first = replace ? 0 : kept.length;
    q.items = [...(replace ? [] : kept), ...TPL[name].map(x => ({ ...x }))];
    if (TPL[name].some(x => x.coef)) { q.coef = true; $q('#qCoef').checked = true; }
    if (!(q.title || '').trim()) { q.title = 'Báo giá ' + name.toLowerCase(); $q('[data-q=title]').value = q.title; }
    drawItems();
    const rows = $$('.qi', el).slice(first);
    rows.forEach(r => r.classList.add('flash'));
    if (rows[0]) rows[0].scrollIntoView({ block: 'start', behavior: 'smooth' });
    toast(`${replace ? 'Đã thay bằng' : 'Đã thêm'} ${TPL[name].length} dòng từ mẫu "${name}"`);
  };
  const snapshot = () => cleanQuote(JSON.parse(JSON.stringify(q)));
  const commit = () => {
    cleanQuote(q);
    if (orig) Object.assign(orig, q); else if (!S.quotes.includes(q)) S.quotes.push(q);
    save();
  };
  $q('#qSave').onclick = () => { commit(); closeSheet(); render(); toast('Đã lưu báo giá'); };
  $q('#qBtns').addEventListener('click', e => {
    const a = e.target.closest('[data-qa]')?.dataset.qa;
    if (!a) return;
    if (a === 'print') printHTML(quoteDocHTML(snapshot()));
    else if (a === 'xlsx') { const x = snapshot(); download(docFileName(x, 'xlsx'), quoteXlsx(x)); }
    else if (a === 'ct') { commit(); closeSheet(); render(); openContract(q.id); }
    else if (a === 'del') { if (confirm('Xóa báo giá này?')) { S.quotes = S.quotes.filter(x => x.id !== id); save(); closeSheet(); render(); toast('Đã xóa'); } }
    else if (a === 'dup') { commit(); const c = JSON.parse(JSON.stringify(q)); delete c.ct; S.quotes.push({ ...c, id: uid(), no: nextQuoteNo(), date: today(), status: 'draft' }); save(); closeSheet(); render(); toast('Đã nhân bản báo giá'); }
    else if (a === 'apply') {
      const p = proj(q.projectId), t = qTotal(q).total;
      if (p && confirm(`Đặt giá trị hợp đồng của "${p.name}" thành ${money(t)}?`)) { p.contract = t; q.status = 'approved'; commit(); closeSheet(); render(); toast('Đã cập nhật giá trị hợp đồng'); }
    }
  });
}

// ---------- In & xuất file ----------
function printHTML(html) {
  const box = $('#print');
  box.innerHTML = html;
  // Chờ ảnh (logo) tải xong rồi mới mở hộp thoại in
  const wait = $$('img', box).filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; }));
  Promise.race([Promise.all(wait), new Promise(r => setTimeout(r, 3000))]).then(() => setTimeout(() => window.print(), 50));
}
function companyHead() {
  const s = S.settings;
  return `<div><b style="font-size:15px">${esc(s.company || 'TÊN CÔNG TY / NHÀ THẦU')}</b><br>${esc(s.address)}${s.phone ? `<br>ĐT: ${esc(s.phone)}` : ''}${s.tax ? ` · MST: ${esc(s.tax)}` : ''}</div>`;
}
async function printLogs() {
  const list = S.logs.filter(inScope).sort((a, b) => -byDateDesc(a, b));
  for (const l of list) for (const id of l.photos || []) await getPhoto(id);
  printHTML(`${companyHead()}<h1>NHẬT KÝ THI CÔNG</h1><div class="c">${esc(S.ui.pid ? pname(S.ui.pid) : 'Tất cả dự án')}</div>
  ${list.map(l => `<div class="entry"><b>Ngày ${fdate(l.date)}</b> — ${esc(l.weather || '')}${l.workers ? ` — Nhân công: ${fmt(l.workers)}` : ''}${S.ui.pid ? '' : ` — ${esc(pname(l.projectId))}`}${l.supervisor ? ` — Người ghi: ${esc(l.supervisor)}` : ''}
    <div class="pre">${esc(l.content)}</div>${l.issue ? `<div class="pre"><b>Vướng mắc:</b> ${esc(l.issue)}</div>` : ''}
    ${l.photos?.length ? `<div class="pimgs">${l.photos.map(id => photoCache.get(id) ? `<img src="${photoCache.get(id)}">` : '').join('')}</div>` : ''}</div>`).join('')}`);
}
// Tên file không dấu: một số trình duyệt bỏ tên có dấu và lưu thành "download"
const fileSafe = name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[–—]/g, '-').replace(/[^\w .,()+-]/g, '').replace(/\s+/g, ' ').trim() || 'tep';
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileSafe(name);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function backup() {
  const photos = {};
  for (const x of [...S.logs, ...S.projects, ...S.tasks, ...S.changes]) for (const id of x.photos || []) photos[id] = await getPhoto(id);
  const files = {};
  for (const d of S.docs) for (const f of d.files || []) { const b = await DB.get('files', f.id); if (b) files[f.id] = await blobToDataURL(b); }
  download(`sao-luu-xay-dung-${today()}.json`, new Blob([JSON.stringify({ app: 'qlxd', v: 2, state: S, photos, files })], { type: 'application/json' }));
}
// Gói dự án: chỉ THÊM các mục chưa có (theo mã), không xóa hay ghi đè dữ liệu hiện có
async function importPackage(d) {
  const kinds = ['projects', 'quotes', 'logs', 'costs', 'docs', 'tasks', 'changes'];
  const add = {};
  for (const k of kinds) add[k] = (Array.isArray(d[k]) ? d[k] : []).filter(r => r && typeof r.id === 'string' && !S[k].some(x => x.id === r.id));
  const total = kinds.reduce((t, k) => t + add[k].length, 0);
  if (!total) return toast('Các mục trong file này đã có sẵn, không có gì để thêm');
  const names = add.projects.map(p => p.name).filter(Boolean).join(', ');
  if (!confirm(`Thêm ${total} mục${names ? ` (dự án: ${names})` : ''} vào dữ liệu hiện có? Không xóa hay ghi đè mục nào.`)) return;
  const ph = new Set([...add.logs, ...add.projects, ...add.tasks, ...add.changes].flatMap(l => l.photos || [])), fl = new Set(add.docs.flatMap(x => (x.files || []).map(f => f.id)));
  for (const [id, src] of Object.entries(d.photos || {})) if (ph.has(id) && typeof src === 'string' && src.startsWith('data:image/')) await DB.set('photos', id, src);
  for (const [id, src] of Object.entries(d.files || {})) if (fl.has(id) && typeof src === 'string' && src.startsWith('data:')) await DB.set('files', id, await (await fetch(src)).blob());
  for (const k of kinds) S[k].push(...add[k]);
  save(); render(); toast(`Đã thêm ${total} mục`);
}
async function restore(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app === 'qlxd' && d.pkg === 1) return await importPackage(d);
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
    { id: uid(), projectId: p1, no: nextQuoteNo(), date: d(50), title: 'Báo giá thi công phần thô', form: 'rough', coef: false, customer: 'Nguyễn Văn Minh', status: 'approved',
      // Hợp đồng mẫu: đã thu 2 đợt đầu, các đợt sau nhắc theo mốc tiến độ
      ct: { form: 'rough', no: '01/2026/HĐTC', date: d(46), deduct: 0, pay: FORMS.rough.pay.map((x, i) => ({ ...x, ...(i < 2 ? { paid: { date: d(44 - i * 24), costId: '' } } : {}) })) }, vat: 8, discount: 2, note: 'Báo giá có hiệu lực 30 ngày.\nThanh toán theo 5 đợt theo tiến độ.',
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
  // Tiến độ mẫu cho nhà phố 4 tầng: các mốc đã qua 3 ngày trước được đánh dấu xong
  if (typeof buildPlan === 'function') {
    const opt = { floors: 3, roof: 'btct', tum: false, pile: true };
    schedule(buildPlan(opt), d(45)).forEach((t, i) => {
      delete t.par;
      const done = taskEnd(t) <= d(3);
      S.tasks.push({ id: uid(), projectId: p1, order: i, done, doneDate: done ? taskEnd(t) : '', photos: [], note: '', ...t });
    });
    proj(p1).plan = opt;
    // Nghiệm thu mẫu: các mốc công việc khuất đã xong được nghiệm thu đạt, trừ mốc gần nhất (chờ nghiệm thu)
    if (typeof checklistFor === 'function') {
      const chk = tasksOf(p1).filter(t => t.chk && t.done);
      chk.slice(0, -1).forEach((t, i) => { t.acc = { no: i + 1, date: t.doneDate, a: 'Nguyễn Văn Minh', b: 'Lê Hoàng Sơn', items: checklistFor(t).map(x => ({ t: x, ok: true, note: '' })), note: '', fix: '', due: '', result: 'pass' }; });
      S.changes.push(
        { id: uid(), projectId: p1, no: 'PS-01', date: d(25), sign: 'add', title: 'Nâng nền tầng trệt thêm 20 cm', reason: 'Chủ nhà yêu cầu thay đổi', status: 'approved', approvedDate: d(24), days: 2, note: '', photos: [],
          items: [{ name: 'Đắp cát nền, đầm chặt', unit: 'm³', qty: '18', price: 320000 }, { name: 'Xây tường móng gạch thẻ nâng cốt', unit: 'm³', qty: '3,5', price: 1850000 }] },
        { id: uid(), projectId: p1, no: 'PS-02', date: d(1), sign: 'add', title: 'Thêm ban công lầu 3 phía sau', reason: 'Thay đổi thiết kế', status: 'sent', days: 3, note: 'Chờ chủ nhà xác nhận qua Zalo', photos: [],
          items: [{ name: 'Bê tông, cốt thép sàn ban công', unit: 'm²', qty: '6,5', price: 2400000 }, { name: 'Lan can sắt sơn tĩnh điện', unit: 'md', qty: '4,2', price: 1150000 }] });
    }
  }
  save(); render(); toast('Đã thêm dữ liệu mẫu');
}

// ---------- Sự kiện ----------
const ACT = {
  tab: d => { S.ui.tab = d.id; save(); render(); window.scrollTo(0, 0); },
  go: d => { S.ui.pid = d.id; S.ui.tab = d.tab; save(); render(); window.scrollTo(0, 0); },
  add: () => ({ projects: formProject, quotes: formQuote, logs: formLog, costs: formCost, docs: formDoc }[S.ui.tab] || formProject)(),
  editProject: d => formProject(d.id),
  openProgress: d => openProgress(d.id),
  // Thêm ảnh phối cảnh ngay trên thẻ dự án
  addCover: d => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const p = proj(d.id), file = inp.files[0];
      if (!p || !file) return;
      try {
        const id = uid(), src = await compressImage(file, 1600);
        await DB.set('photos', id, src); photoCache.set(id, src);
        p.photos = [id, ...(p.photos || [])];
        save(); render(); toast('Đã thêm ảnh phối cảnh');
      } catch (e) { toast('Không thêm được ảnh'); }
    };
    inp.click();
  }, editQuote: d => formQuote(d.id), editLog: d => formLog(d.id), editCost: d => formCost(d.id), editDoc: d => formDoc(d.id),
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
  csvCosts: () => download(`thu-chi-${S.ui.pid ? pname(S.ui.pid).replace(/[\\/:*?"<>|]/g, '') + '-' : ''}${today()}.xlsx`, costsXlsx(S.costs.filter(inScope).sort(byDateDesc))),
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
