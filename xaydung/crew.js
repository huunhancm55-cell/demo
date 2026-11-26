'use strict';
/* Tiến độ đợt 5: chủ thầu tạo tài khoản đội thợ và giao công trình (Cài đặt → Đội thợ).
   Phân quyền thật nằm trên máy chủ (supabase/crew.sql); app chỉ ẩn các mục không dùng tới. */
const Crew = { list: null, owners: [], error: '', busy: false };

async function loadCrew() {
  const sb = window.Sync && Sync.client();
  if (!sb || Crew.busy) return;
  Crew.busy = true;
  const { data, error } = await sb.from('members').select('*').order('email');
  Crew.busy = false;
  if (error) Crew.error = error.message;
  else if (data.length && !('role' in data[0])) Crew.error = 'need-sql';
  else { Crew.error = ''; Crew.list = data.filter(r => r.role === 'crew'); Crew.owners = data.filter(r => r.role !== 'crew').map(r => r.email); }
  if (S.ui.tab === 'settings' && $('#crewCard')) $('#crewCard').outerHTML = crewCardHTML();
}
const projChecks = (name, sel) => S.projects.length
  ? `<div class="crew-pj">${S.projects.map(p => `<label class="chk"><input type="checkbox" name="${name}" value="${p.id}"${sel.includes(p.id) ? ' checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>`
  : '<p class="small muted">Chưa có công trình nào.</p>';

function crewCardHTML() {
  if (Sync.role() !== 'owner') return '';
  if (Crew.list === null && !Crew.error) { setTimeout(loadCrew, 0); return '<div class="card" id="crewCard"><div class="bold">👷 Đội thợ</div><p class="small muted mt">Đang tải…</p></div>'; }
  if (Crew.error === 'need-sql') return `<div class="card" id="crewCard"><div class="bold mb">👷 Đội thợ</div><p class="small">Để tạo tài khoản riêng cho từng đội thợ, chạy file <b>supabase/crew.sql</b> một lần trong Supabase → SQL Editor, rồi bấm Tải lại.</p><div class="btns mt"><button class="btn sm" data-act="crewReload">Tải lại</button></div></div>`;
  if (Crew.error) return `<div class="card" id="crewCard"><div class="bold mb">👷 Đội thợ</div><p class="small neg">${esc(Crew.error)}</p><div class="btns mt"><button class="btn sm" data-act="crewReload">Thử lại</button></div></div>`;
  const pname2 = id => (S.projects.find(p => p.id === id) || {}).name;
  return `<div class="card" id="crewCard"><div class="row between"><div class="bold">👷 Đội thợ</div><button class="linkbtn" data-act="crewReload">⟳ Tải lại</button></div>
    <p class="small muted mt mb">Mỗi đội thợ đăng nhập bằng tài khoản riêng, chỉ thấy công trình được giao: đánh dấu xong mốc kèm ảnh và ghi nhật ký. Không thấy báo giá, chi phí, hợp đồng, hồ sơ, giá trị công trình.</p>
    ${Crew.list.map(m => `<div class="crew-row" data-email="${esc(m.email)}">
      <div class="row between wrap" style="gap:6px"><div><b>${esc(m.name || m.email)}</b><div class="small muted">${esc(m.email)}</div></div>
        <span class="small muted">${(m.projects || []).map(pname2).filter(Boolean).length} công trình</span></div>
      ${projChecks('cp-' + m.email, m.projects || [])}
      <div class="btns mt"><button class="btn sm" data-act="crewSave" data-email="${esc(m.email)}">Lưu công trình giao</button><button class="btn sm danger" data-act="crewDel" data-email="${esc(m.email)}">Thu hồi quyền</button></div></div>`).join('') || '<p class="small muted">Chưa có tài khoản đội thợ.</p>'}
    <details class="mt" id="crewNew"><summary class="bold small">+ Thêm đội thợ</summary>
      <div class="fields mt"><div class="full"><label for="cwName">Tên đội / người phụ trách</label><input id="cwName" placeholder="VD: Đội anh Sơn – phần thô"></div>
        <div><label for="cwEmail">Email đăng nhập</label><input id="cwEmail" type="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="doi.son@gmail.com"></div>
        <div><label for="cwPass">Mật khẩu (ít nhất 6 ký tự)</label><input id="cwPass" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <div class="full"><label>Công trình được giao</label>${projChecks('cp-new', S.ui.pid ? [S.ui.pid] : [])}</div>
        <div class="full btns"><button class="btn primary" data-act="crewAdd">Tạo tài khoản đội thợ</button></div></div>
      <p class="small muted mt">Gửi email + mật khẩu cho đội thợ để đăng nhập trên điện thoại (Cài đặt → Đồng bộ). Nếu Supabase bật "Confirm email", đội thợ phải bấm link xác nhận trong email trước khi đăng nhập được.</p></details>
    ${Crew.owners.length ? `<p class="small muted mt">Chủ thầu (toàn quyền): ${Crew.owners.map(esc).join(', ')}</p>` : ''}</div>`;
}
const checkedPids = name => [...document.querySelectorAll(`input[name="${CSS.escape(name)}"]:checked`)].map(i => i.value);

Object.assign(ACT, {
  crewReload: () => { Crew.list = null; Crew.error = ''; render(); },
  crewSave: async d => {
    const { error } = await Sync.client().from('members').update({ projects: checkedPids('cp-' + d.email) }).eq('email', d.email);
    if (error) return toast(error.message);
    toast('Đã lưu công trình giao cho đội thợ'); loadCrew();
  },
  crewDel: async d => {
    if (!confirm(`Thu hồi quyền của ${d.email}? Tài khoản này sẽ không xem hay ghi được dữ liệu công ty nữa.`)) return;
    const { error } = await Sync.client().from('members').delete().eq('email', d.email);
    if (error) return toast(error.message);
    toast('Đã thu hồi quyền'); loadCrew();
  },
  crewAdd: async (d, btn) => {
    const name = $('#cwName').value.trim(), email = $('#cwEmail').value.trim().toLowerCase(), pass = $('#cwPass').value, projects = checkedPids('cp-new');
    if (!name) return toast('Nhập tên đội thợ');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Email không hợp lệ');
    if (pass.length < 6) return toast('Mật khẩu ít nhất 6 ký tự');
    if (Crew.owners.some(e => e.toLowerCase() === email)) return toast('Email này đang là chủ thầu');
    if (btn) btn.disabled = true;
    let note = '';
    try {
      // Tạo tài khoản bằng một kết nối riêng để không đăng xuất chủ thầu
      const c = Sync.config(), tmp = supabase.createClient(c.url, c.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'qlxd-tmp' } });
      const { data, error } = await tmp.auth.signUp({ email, password: pass });
      if (error && !/already|registered|exists/i.test(error.message)) throw error;
      if (error) note = ' (email đã có tài khoản — dùng mật khẩu cũ của tài khoản đó)';
      else if (data && data.user && !data.session) note = ' — đội thợ cần bấm link xác nhận trong email trước khi đăng nhập';
      const { error: e2 } = await Sync.client().from('members').upsert({ email, role: 'crew', name, projects });
      if (e2) throw e2;
      toast('Đã tạo tài khoản đội thợ' + note);
      Crew.list = null; render();
    } catch (e) { toast(e.message || 'Không tạo được tài khoản'); }
    if (btn) btn.disabled = false;
  },
});
window.crewCardHTML = crewCardHTML;
