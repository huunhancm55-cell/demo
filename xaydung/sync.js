'use strict';
/* Đồng bộ dữ liệu giữa các thiết bị qua Supabase.
   - Mỗi dự án / báo giá / nhật ký / khoản thu chi / hồ sơ là một dòng trong bảng `records`.
   - Máy nào cũng lưu đầy đủ dữ liệu cục bộ (chạy được khi mất mạng); có mạng thì đẩy thay đổi lên và kéo thay đổi về.
   - Ảnh nhật ký và tệp hồ sơ nằm trong kho lưu trữ `files` (p/<id> là ảnh, f/<id> là tệp). */
const Sync = (() => {
  const KINDS = ['projects', 'quotes', 'logs', 'costs', 'docs', 'tasks', 'changes'];
  const LIB = 'vendor/supabase-js-2.118.0.js';
  const BUCKET = 'files';
  const PAGE = 1000;

  let sb = null, user = null, chan = null, tick = 0, timer = 0;
  let running = false, again = false, pendingRender = false;
  let status = 'off', lastError = '', lastSync = 0;
  // synced: id -> { k: loại, j: JSON lần cuối khớp với máy chủ }; cursor: mốc thời gian đã kéo về; blobs: đường dẫn tệp đã có trên máy chủ
  let st = { synced: {}, cursor: '', blobs: [], uid: '' };

  // ---------- Cấu hình ----------
  function cfg() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem('qlxd-sb') || '{}'); } catch (e) { /* bỏ qua */ }
    const c = window.QLXD_CONFIG || {};
    return { url: (o.url || c.supabaseUrl || '').trim().replace(/\/+$/, ''), key: (o.key || c.supabaseKey || '').trim(), override: !!o.url };
  }
  const configured = () => { const c = cfg(); return !!(c.url && c.key); };
  const persist = () => DB.set('kv', 'sync', st).catch(() => {});
  // Vai trò: chủ thầu (owner) toàn quyền; đội thợ (crew) chỉ công trình được giao, chỉ mốc tiến độ + nhật ký
  const crew = () => st.me?.role === 'crew';
  const crewPids = () => new Set(st.me?.projects || []);
  const crewOk = r => crewPids().has(r.projectId);

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      // Quá 8 giây chưa tải xong thì bỏ, để kết nối lại (tránh kẹt "Đang kết nối…")
      const t = setTimeout(() => { s.remove(); rej(new Error('Tải thư viện đồng bộ quá lâu')); }, 8000);
      s.src = src + (loadScript.n ? `?r=${loadScript.n}` : ''); loadScript.n = (loadScript.n || 0) + 1;
      s.onload = () => { clearTimeout(t); res(); }; s.onerror = () => { clearTimeout(t); s.remove(); rej(new Error('Không tải được thư viện đồng bộ')); };
      document.head.appendChild(s);
    });
  }

  // ---------- So sánh dữ liệu ----------
  function current() {
    const m = new Map();
    if (crew()) {
      for (const k of ['projects', 'tasks', 'logs']) for (const r of S[k]) m.set(r.id, [k, r]);
      return m;
    }
    for (const k of KINDS) for (const r of S[k]) m.set(r.id, [k, r]);
    m.set('settings', ['settings', S.settings]);
    return m;
  }
  function dirtyList() {
    const cur = current(), up = [], del = [];
    const c = crew();
    for (const [id, [k, r]] of cur) {
      if (c && (k === 'projects' || !crewOk(r))) continue; // đội thợ không sửa công trình, không ghi ngoài công trình được giao
      const j = JSON.stringify(r);
      if (st.synced[id]?.j !== j) up.push({ id, kind: k, data: r, deleted: false, _j: j });
    }
    for (const id in st.synced) if (!cur.has(id) && !(c && st.synced[id].k === 'projects')) del.push({ id, kind: st.synced[id].k, data: null, deleted: true });
    return up.concat(del);
  }
  const blobPaths = rec => [...(rec?.photos || []).map(id => 'p/' + id), ...(rec?.files || []).map(f => 'f/' + f.id)];
  function referencedBlobs() {
    const s = new Set();
    if (crew()) { for (const l of [...S.logs, ...S.tasks].filter(crewOk)) blobPaths(l).forEach(p => s.add(p)); return s; }
    for (const l of [...S.logs, ...S.projects, ...S.tasks, ...S.changes]) blobPaths(l).forEach(p => s.add(p));
    for (const d of S.docs) blobPaths(d).forEach(p => s.add(p));
    return s;
  }
  function replaceInPlace(obj, data) {
    for (const k of Object.keys(obj)) delete obj[k];
    Object.assign(obj, data);
  }

  // ---------- Đẩy lên ----------
  async function push() {
    const known = new Set(st.blobs);
    for (const path of referencedBlobs()) {
      if (known.has(path)) continue;
      const id = path.slice(2);
      let blob = null;
      if (path[0] === 'p') { const src = await DB.get('photos', id).catch(() => null); if (src) blob = await (await fetch(src)).blob(); }
      else blob = await DB.get('files', id).catch(() => null);
      if (!blob) continue; // tệp của máy khác, máy này chưa tải về
      const { error } = await sb.storage.from(BUCKET).upload(path, await blob.arrayBuffer(), { upsert: true, contentType: blob.type || 'application/octet-stream' });
      if (error) throw error;
      known.add(path); st.blobs = [...known];
    }
    const rows = dirtyList();
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from('records').upsert(chunk.map(({ _j, ...r }) => r));
      if (error) throw error;
      for (const r of chunk) { if (r.deleted) delete st.synced[r.id]; else st.synced[r.id] = { k: r.kind, j: r._j }; }
    }
    return rows.length;
  }

  // ---------- Kéo về ----------
  function apply(row, cur, force) {
    const id = row.id, local = cur.get(id);
    const lj = local ? JSON.stringify(local[1]) : undefined, sj = st.synced[id]?.j;
    const dirty = local ? lj !== sj : sj !== undefined;
    if (dirty && !force) return false; // máy này có sửa chưa đẩy lên: giữ bản của máy này
    if (row.deleted) {
      delete st.synced[id];
      if (!local || local[0] === 'settings') return false;
      const arr = S[local[0]];
      arr.splice(arr.indexOf(local[1]), 1); cur.delete(id);
      if (['logs', 'projects', 'tasks', 'changes'].includes(local[0])) (local[1].photos || []).forEach(p => DB.del('photos', p));
      if (local[0] === 'docs') (local[1].files || []).forEach(f => DB.del('files', f.id));
      if (local[0] === 'projects' && S.ui.pid === id) S.ui.pid = '';
      return true;
    }
    if (!row.data || (row.kind !== 'settings' && !KINDS.includes(row.kind))) return false;
    const j = JSON.stringify(row.data);
    st.synced[id] = { k: row.kind, j };
    const known = new Set(st.blobs); blobPaths(row.data).forEach(p => known.add(p)); st.blobs = [...known];
    if (lj === j) return false;
    if (row.kind === 'settings') replaceInPlace(S.settings, row.data);
    else if (local) replaceInPlace(local[1], row.data);
    else { S[row.kind].push(row.data); cur.set(id, [row.kind, row.data]); }
    return true;
  }
  // Lùi mốc 30 giây để không bỏ sót dòng ghi đồng thời; dòng kéo trùng được bỏ qua
  function back30(ts) {
    const t = Date.parse(String(ts).replace(/(\.\d{3})\d+/, '$1'));
    return isNaN(t) ? ts : new Date(t - 30000).toISOString();
  }
  async function pull(force) {
    const cur = current();
    let changed = false, max = '';
    for (const table of crew() ? ['records', 'crew_projects_v'] : ['records']) for (let off = 0; ; off += PAGE) {
      let q = sb.from(table).select('id,kind,data,deleted,updated_at');
      if (st.cursor) q = q.gt('updated_at', st.cursor);
      const { data, error } = await q.order('updated_at', { ascending: true }).order('id', { ascending: true }).range(off, off + PAGE - 1);
      if (error) throw error;
      for (const row of data) { if (apply(row, cur, force)) changed = true; if (row.updated_at > max) max = row.updated_at; }
      if (data.length < PAGE) break;
    }
    if (max) { const c = back30(max); if (!st.cursor || c > st.cursor) st.cursor = c; }
    if (crew() && purge()) changed = true;
    return changed;
  }

  // Đội thợ: bỏ khỏi máy các công trình không còn được giao và mọi dữ liệu tiền bạc, hồ sơ
  function purge() {
    const ok = crewPids(), keepRec = (k, r) => (k === 'projects' ? ok.has(r.id) : ok.has(r.projectId));
    let n = 0;
    for (const k of ['projects', 'tasks', 'logs']) {
      const drop = S[k].filter(r => !keepRec(k, r));
      if (!drop.length) continue;
      n += drop.length;
      for (const r of drop) { delete st.synced[r.id]; (r.photos || []).forEach(p => DB.del('photos', p)); }
      S[k] = S[k].filter(r => keepRec(k, r));
    }
    for (const k of ['quotes', 'costs', 'docs', 'changes']) if (S[k].length) { n += S[k].length; S[k].forEach(r => delete st.synced[r.id]); S[k] = []; }
    if (S.ui.pid && !ok.has(S.ui.pid)) S.ui.pid = '';
    return n > 0;
  }
  // Vai trò của tài khoản đang đăng nhập (bảng members)
  async function loadMe() {
    const { data, error } = await sb.from('members').select('*').ilike('email', user.email || '');
    if (error) return; // máy chủ chưa nâng cấp: giữ như cũ
    const row = (data || []).find(r => String(r.email).toLowerCase() === String(user.email).toLowerCase());
    let me = row ? { role: row.role || 'owner', name: row.name || '', projects: row.projects || [] } : { role: 'none', name: '', projects: [] };
    // Đội thợ bị thu hồi quyền: vẫn là đội thợ nhưng không còn công trình nào (xóa dữ liệu công trình trên máy)
    if (!row && crew()) me = { role: 'crew', name: st.me.name, projects: [] };
    const before = JSON.stringify(st.me || null);
    if (before === JSON.stringify(me)) return;
    const wasCrew = crew();
    st.me = me;
    if (crew() && !wasCrew) { st.cursor = ''; } // vừa thành đội thợ: kéo lại công trình được giao
    if (crew()) { purge(); DB.set('kv', 'state', S).catch(() => {}); }
    if (wasCrew && !crew()) st.cursor = ''; // được nâng lên chủ thầu: tải đủ dữ liệu
    await persist(); safeRender();
  }

  // Xóa trên máy chủ các ảnh/tệp không còn hồ sơ nào dùng
  async function cleanBlobs() {
    const keep = referencedBlobs(), orphan = st.blobs.filter(p => !keep.has(p));
    if (!orphan.length) return;
    const { error } = await sb.storage.from(BUCKET).remove(orphan);
    if (!error) st.blobs = st.blobs.filter(p => keep.has(p));
  }

  // ---------- Vòng đồng bộ ----------
  function schedule(ms = 0) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }
  async function run() {
    if (!sb || !user) return;
    if (running) { again = true; return; }
    running = true; setStatus('busy');
    try {
      await loadMe();
      if (st.me?.role === 'none') throw Object.assign(new Error('not member'), { code: '42501' });
      const first = !st.cursor && !Object.keys(st.synced).length;
      let changed = false;
      if (first) changed = await pull(true); // lần đầu trên máy này: lấy dữ liệu chung trước, rồi gộp phần riêng của máy lên
      await push();
      if (await pull(false)) changed = true;
      if (!crew() && !dirtyList().length) await cleanBlobs();
      lastSync = Date.now(); lastError = '';
      setStatus('ok');
      if (changed) { DB.set('kv', 'state', S).catch(() => {}); safeRender(); }
    } catch (e) {
      lastError = errMsg(e);
      setStatus(navigator.onLine === false || /mạng/.test(lastError) ? 'offline' : 'err');
    } finally {
      await persist();
      running = false;
      if (again) { again = false; schedule(300); }
    }
  }
  function errMsg(e) {
    const m = String(e?.message || e || '');
    if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Tài khoản này chưa được cấp quyền (chưa có trong danh sách thành viên).';
    if (/fetch|network|load failed|internet/i.test(m)) return 'Không có mạng — sẽ tự đồng bộ khi có mạng lại.';
    if (/jwt|token|session/i.test(m)) return 'Phiên đăng nhập hết hạn, hãy đăng nhập lại.';
    return m || 'Lỗi không rõ';
  }

  function inputFocused() {
    const a = document.activeElement;
    return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#main').contains(a);
  }
  function safeRender() {
    if (inputFocused()) { pendingRender = true; return; }
    pendingRender = false; render();
  }
  document.addEventListener('focusout', () => {
    if (pendingRender) setTimeout(() => { if (pendingRender && !inputFocused()) { pendingRender = false; render(); } }, 0);
  });

  // ---------- Trạng thái ----------
  function setStatus(s) {
    status = s;
    const c = $('#syncChip');
    if (!c) return;
    c.hidden = !user;
    const n = s === 'ok' || s === 'busy' ? 0 : dirtyList().length;
    const [ic, txt, cls] = {
      busy: ['⟳', 'Đang đồng bộ', ''], ok: ['✓', 'Đã đồng bộ', 'ok'], pending: ['⟳', 'Chờ đồng bộ', ''],
      offline: ['⚠', n ? `Ngoại tuyến · ${n} chờ` : 'Ngoại tuyến', 'warn'], err: ['⚠', 'Lỗi đồng bộ', 'warn'], off: ['', '', ''],
    }[s];
    c.className = 'syncchip ' + cls;
    c.innerHTML = `<b>${ic}</b><span>${txt}</span>`;
    c.title = lastError || txt;
    const live = $('#syncLive');
    if (live) live.innerHTML = statusLine();
  }
  function statusLine() {
    if (lastError) return `<span class="neg">${esc(lastError)}</span>`;
    if (status === 'busy') return 'Đang đồng bộ…';
    if (lastSync) return `Đồng bộ lần cuối lúc ${new Date(lastSync).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    return 'Chưa đồng bộ';
  }

  // ---------- Đăng nhập ----------
  function setUser(u) {
    if ((u?.id || '') === (user?.id || '')) return;
    user = u || null;
    clearInterval(tick);
    if (chan) { try { sb.removeChannel(chan); } catch (e) { /* bỏ qua */ } chan = null; }
    if (user) {
      if (st.uid && st.uid !== user.id) st = { synced: {}, cursor: '', blobs: [], uid: '' }; // tài khoản khác: đồng bộ lại từ đầu
      st.uid = user.id; persist();
      try {
        chan = sb.channel('qlxd-records')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, () => schedule(400))
          .subscribe();
      } catch (e) { /* không có cập nhật tức thì thì vẫn đồng bộ định kỳ */ }
      tick = setInterval(() => { if (document.visibilityState !== 'hidden') schedule(0); }, 30000);
      schedule(0);
    } else { lastError = ''; status = 'off'; }
    setStatus(user ? status : 'off');
    if (S.ui.tab === 'settings') safeRender();
  }
  async function connect() {
    if (sb || connect.busy || !configured()) return;
    connect.busy = true;
    try {
      if (!window.supabase?.createClient) await loadScript(LIB);
      const c = cfg();
      sb = supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'qlxd-auth' } });
      sb.auth.onAuthStateChange((ev, session) => setTimeout(() => setUser(session?.user || null), 0));
      const { data } = await sb.auth.getSession();
      setUser(data?.session?.user || null);
    } catch (e) {
      sb = null; lastError = errMsg(e);
      // Tự thử lại vài lần
      if ((connect.retry = (connect.retry || 0) + 1) <= 3) setTimeout(() => { if (!sb) { lastError = ''; connect(); } }, 1500);
    } finally { connect.busy = false; }
    if (S.ui.tab === 'settings') safeRender();
  }

  async function init() {
    try { const saved = await DB.get('kv', 'sync'); if (saved) st = { ...st, ...saved }; } catch (e) { /* bỏ qua */ }
    await connect();
  }
  addEventListener('online', () => { if (!sb) connect(); else schedule(0); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && user) schedule(0); });

  // ---------- Tải ảnh / tệp của máy khác ----------
  async function download(path) {
    if (!sb || !user) return null;
    try {
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      return error ? null : data;
    } catch (e) { return null; }
  }
  async function fetchPhoto(id) {
    const blob = await download('p/' + id);
    if (!blob) return null;
    const src = await blobToDataURL(blob.type ? blob : new Blob([blob], { type: 'image/jpeg' }));
    await DB.set('photos', id, src).catch(() => {});
    return src;
  }
  async function fetchFile(id) {
    const blob = await download('f/' + id);
    if (blob) await DB.set('files', id, blob).catch(() => {});
    return blob;
  }

  // ---------- Giao diện trong Cài đặt ----------
  function card() {
    const c = cfg();
    const head = `<div class="bold mb">Đồng bộ giữa các thiết bị</div>`;
    if (!configured()) return `<div class="card">${head}
      <p class="small muted mb">Nhập thông tin dự án Supabase của công ty để dữ liệu tự đồng bộ giữa điện thoại và máy tính. (Settings → API trên trang Supabase.)</p>
      <div class="fields"><div class="full"><label for="sbUrl">Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
      <div class="full"><label for="sbKey">Anon / publishable key</label><input id="sbKey" autocapitalize="off" autocorrect="off" spellcheck="false"></div></div>
      <div class="btns mt"><button class="btn primary" data-act="sbSaveCfg">Lưu cấu hình</button></div></div>`;
    if (!sb) return `<div class="card">${head}<p class="small muted mb">${lastError ? esc(lastError) : 'Đang kết nối…'}</p>
      <div class="btns"><button class="btn" data-act="sbRetry">Thử lại</button>${c.override ? `<button class="btn danger" data-act="sbResetCfg">Đổi máy chủ</button>` : ''}</div></div>`;
    if (!user) return `<div class="card">${head}
      <p class="small muted mb">Đăng nhập cùng một tài khoản trên điện thoại và máy tính để dùng chung dữ liệu. Dữ liệu đang có trên máy này sẽ được gộp vào dữ liệu chung.</p>
      <form id="sbLogin" class="fields">
        <div class="full"><label for="sbEmail">Email</label><input id="sbEmail" type="email" autocomplete="username" autocapitalize="off" required></div>
        <div class="full"><label for="sbPass">Mật khẩu</label><input id="sbPass" type="password" autocomplete="current-password" required></div>
        <div class="full btns"><button class="btn primary" type="submit">Đăng nhập</button>${c.override ? `<button class="btn" type="button" data-act="sbResetCfg">Đổi máy chủ</button>` : ''}</div>
      </form></div>`;
    return `<div class="card">${head}
      <p class="small">Đã đăng nhập: <b>${esc(user.email || '')}</b></p>
      <p class="small muted mt" id="syncLive">${statusLine()}</p>
      <div class="btns mt"><button class="btn" data-act="sbSyncNow">⟳ Đồng bộ ngay</button><button class="btn" data-act="sbLogout">Đăng xuất</button></div></div>`;
  }

  Object.assign(ACT, {
    sbSaveCfg: () => {
      const url = $('#sbUrl').value.trim(), key = $('#sbKey').value.trim();
      if (!/^https?:\/\/[^/]+/.test(url) || key.length < 20) return toast('Kiểm tra lại Project URL và key');
      try { localStorage.setItem('qlxd-sb', JSON.stringify({ url, key })); } catch (e) { return toast('Không lưu được cấu hình'); }
      connect();
    },
    sbResetCfg: () => {
      if (!confirm('Bỏ cấu hình máy chủ đồng bộ trên máy này?')) return;
      try { localStorage.removeItem('qlxd-sb'); } catch (e) { /* bỏ qua */ }
      location.reload();
    },
    sbRetry: () => { sb = null; lastError = ''; connect(); },
    sbSyncNow: () => schedule(0),
    sbLogout: async () => {
      if (dirtyList().length && !confirm('Còn thay đổi chưa đồng bộ lên máy chủ. Vẫn đăng xuất?')) return;
      await sb.auth.signOut().catch(() => {});
      setUser(null);
      toast('Đã đăng xuất');
    },
  });
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'sbLogin') return;
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: $('#sbEmail').value.trim(), password: $('#sbPass').value });
      if (error) toast(/invalid/i.test(error.message) ? 'Sai email hoặc mật khẩu' : errMsg(error));
      else { setUser(data.user); toast('Đã đăng nhập — đang đồng bộ'); }
    } catch (err) { toast(errMsg(err)); }
    btn.disabled = false;
  });

  return {
    init, card, fetchPhoto, fetchFile,
    signedIn: () => !!user,
    role: () => st.me?.role || 'owner',
    me: () => ({ ...(st.me || { role: 'owner', name: '', projects: [] }), email: user?.email || '' }),
    client: () => (user ? sb : null),
    config: () => cfg(),
    // Kho công khai "share": ảnh chụp tiến độ cho chủ nhà xem qua link (chỉ thành viên được ghi)
    async shareUpload(path, body, type) {
      if (!sb || !user) throw new Error('Chưa đăng nhập đồng bộ');
      const { error } = await sb.storage.from('share').upload(path, body instanceof Blob ? await body.arrayBuffer() : body, { upsert: true, contentType: type, cacheControl: '60' });
      if (error) throw error;
    },
    async shareRemove(paths) {
      if (!sb || !user || !paths.length) return;
      const { error } = await sb.storage.from('share').remove(paths);
      if (error) throw error;
    },
    publicUrl: path => `${cfg().url.replace(/\/+$/, '')}/storage/v1/object/public/share/${path}`,
    // Gọi sau mỗi lần dữ liệu thay đổi trên máy này
    changed() { if (user && dirtyList().length) { setStatus('pending'); schedule(1500); } },
    // Quên trạng thái đồng bộ: lần đồng bộ sau sẽ gộp với dữ liệu chung, không xóa gì trên máy chủ
    async reset(signOut) {
      st = { synced: {}, cursor: '', blobs: [], uid: st.uid };
      await persist();
      if (signOut && sb && user) { await sb.auth.signOut().catch(() => {}); setUser(null); }
      else if (user) schedule(300);
    },
  };
})();
window.Sync = Sync;
