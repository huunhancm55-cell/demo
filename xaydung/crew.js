'use strict';
/* Tiến độ đợt 5: chủ thầu tạo tài khoản đội thợ và giao công trình (Cài đặt → Đội thợ).
   Phân quyền thật nằm trên máy chủ (supabase/crew.sql); app chỉ ẩn các mục không dùng tới. */
const Crew = { list: null, owners: [], reqs: [], error: '', busy: false };

async function loadCrew() {
  const sb = window.Sync && Sync.client();
  if (!sb || Crew.busy) return;
  Crew.busy = true;
  const { data, error } = await sb.from('members').select('*').order('email');
  // Yêu cầu truy cập (bảng có sau khi chạy requests.sql; chưa có thì bỏ qua)
  const rq = await sb.from('access_requests').select('*').order('created_at', { ascending: false });
  Crew.reqs = rq.error ? null : rq.data || [];
  Crew.busy = false;
  if (error) Crew.error = error.message;
  else if (data.length && !('role' in data[0])) Crew.error = 'need-sql';
  else { Crew.error = ''; Crew.list = data.filter(r => r.role === 'crew' || r.role === 'supervisor'); Crew.owners = data.filter(r => r.role === 'owner' || !r.role).map(r => r.email); }
  if (S.ui.tab === 'settings' && $('#crewCard')) $('#crewCard').outerHTML = crewCardHTML();
}
const projChecks = (name, sel) => S.projects.length
  ? `<div class="crew-pj">${S.projects.map(p => `<label class="chk"><input type="checkbox" name="${name}" value="${p.id}"${sel.includes(p.id) ? ' checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>`
  : '<p class="small muted">Chưa có công trình nào.</p>';

function crewCardHTML() {
  if (Sync.role() !== 'owner') return '';
  if (Crew.list === null && !Crew.error) { setTimeout(loadCrew, 0); return '<div class="card" id="crewCard"><div class="bold">👷 Giám sát &amp; cai thợ</div><p class="small muted mt">Đang tải…</p></div>'; }
  if (Crew.error === 'need-sql') return `<div class="card" id="crewCard"><div class="bold mb">👷 Giám sát &amp; cai thợ</div><p class="small">Để tạo tài khoản riêng cho từng đội thợ, chạy file <b>supabase/crew.sql</b> một lần trong Supabase → SQL Editor, rồi bấm Tải lại.</p><div class="btns mt"><button class="btn sm" data-act="crewReload">Tải lại</button></div></div>`;
  if (Crew.error) return `<div class="card" id="crewCard"><div class="bold mb">👷 Giám sát &amp; cai thợ</div><p class="small neg">${esc(Crew.error)}</p><div class="btns mt"><button class="btn sm" data-act="crewReload">Thử lại</button></div></div>`;
  const pname2 = id => (S.projects.find(p => p.id === id) || {}).name;
  const pend = (Crew.reqs || []).filter(r => r.status === 'pending'), rej = (Crew.reqs || []).filter(r => r.status === 'rejected');
  const reqRow = r => `<div class="crew-row req" data-email="${esc(r.email)}">
      <div class="row" style="gap:10px">${r.avatar ? `<img class="req-av" src="${esc(r.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="g-av req-av">${esc((r.name || r.email).trim().charAt(0).toUpperCase())}</span>`}
        <div class="grow" style="min-width:0"><b>${esc(r.name || r.email.split('@')[0])}</b><div class="small muted clip">${esc(r.email)} · ${new Date(r.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</div></div></div>
      <div class="fields mt"><div><label>Vai trò khi duyệt</label><select data-rrole="${esc(r.email)}"><option value="crew">Cai thợ / đội thợ</option><option value="supervisor">Giám sát</option><option value="owner">Chủ thầu (toàn quyền)</option></select></div></div>
      ${projChecks('rp-' + r.email, [])}
      <div class="btns mt"><button class="btn sm primary" data-act="reqOk" data-email="${esc(r.email)}">✓ Duyệt</button>${r.status === 'pending' ? `<button class="btn sm danger" data-act="reqNo" data-email="${esc(r.email)}">Từ chối</button>` : `<button class="btn sm" data-act="reqDel" data-email="${esc(r.email)}">Xóa</button>`}</div></div>`;
  const reqHTML = Crew.reqs === null ? '<p class="small muted mb">Muốn người lạ đăng nhập (VD bằng Google) được xin quyền và báo email cho anh: chạy file <b>supabase/requests.sql</b> trên Supabase.</p>'
    : (pend.length ? `<div class="req-box"><div class="bold">🔔 Yêu cầu truy cập đang chờ duyệt (${pend.length})</div>${pend.map(reqRow).join('')}</div>` : '')
      + (rej.length ? `<details class="mt"><summary class="small">Đã từ chối (${rej.length})</summary>${rej.map(reqRow).join('')}</details>` : '');
  return `<div class="card" id="crewCard"><div class="row between"><div class="bold">👷 Giám sát &amp; cai thợ</div><button class="linkbtn" data-act="crewReload">⟳ Tải lại</button></div>
    ${reqHTML}
    <p class="small muted mt mb">Mỗi người đăng nhập bằng tài khoản riêng, chỉ thấy công trình được giao, không thấy báo giá, chi phí, hợp đồng, hồ sơ, giá trị công trình.<br><b>Cai thợ</b>: đánh dấu xong mốc kèm ảnh, ghi nhật ký. <b>Giám sát</b>: thêm nghiệm thu, biên bản và báo cáo tuần.</p>
    ${Crew.list.map(m => `<div class="crew-row" data-email="${esc(m.email)}">
      <div class="row between wrap" style="gap:6px"><div><b>${esc(m.name || m.email)}</b> <span class="badge ${m.role === 'supervisor' ? 'blue' : 'orange'}">${m.role === 'supervisor' ? 'Giám sát' : 'Cai thợ'}</span><div class="small muted">${esc(m.email)}</div></div>
        <select data-crole="${esc(m.email)}" aria-label="Vai trò"><option value="supervisor"${m.role === 'supervisor' ? ' selected' : ''}>Giám sát</option><option value="crew"${m.role !== 'supervisor' ? ' selected' : ''}>Cai thợ / đội thợ</option></select></div>
      ${projChecks('cp-' + m.email, m.projects || [])}
      <div class="btns mt"><button class="btn sm" data-act="crewSave" data-email="${esc(m.email)}">Lưu</button><button class="btn sm danger" data-act="crewDel" data-email="${esc(m.email)}">Thu hồi quyền</button></div></div>`).join('') || '<p class="small muted">Chưa có tài khoản đội thợ.</p>'}
    <details class="mt" id="crewNew"><summary class="bold small">+ Thêm tài khoản giám sát / cai thợ</summary>
      <div class="fields mt"><div><label for="cwRole">Vai trò</label><select id="cwRole"><option value="supervisor">Giám sát</option><option value="crew" selected>Cai thợ / đội thợ</option></select></div>
        <div><label for="cwName">Họ tên / tên đội</label><input id="cwName" placeholder="VD: Anh Sơn – cai thợ"></div>
        <div><label for="cwEmail">Email đăng nhập</label><input id="cwEmail" type="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="doi.son@gmail.com"></div>
        <div><label for="cwPass">Mật khẩu (ít nhất 6 ký tự)</label><input id="cwPass" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <div class="full"><label>Công trình được giao</label>${projChecks('cp-new', S.ui.pid ? [S.ui.pid] : [])}</div>
        <div class="full btns"><button class="btn primary" data-act="crewAdd">Tạo tài khoản</button></div></div>
      <p class="small muted mt">Gửi email + mật khẩu cho người đó để đăng nhập khi mở app. Nếu Supabase bật "Confirm email", họ phải bấm link xác nhận trong email trước khi đăng nhập được.</p></details>
    ${Crew.owners.length ? `<p class="small muted mt">Chủ thầu (toàn quyền): ${Crew.owners.map(esc).join(', ')}</p>` : ''}</div>`;
}
const checkedPids = name => [...document.querySelectorAll(`input[name="${CSS.escape(name)}"]:checked`)].map(i => i.value);

Object.assign(ACT, {
  // Duyệt yêu cầu: thêm vào danh sách thành viên với vai trò + công trình đã chọn, rồi xóa yêu cầu
  reqOk: async d => {
    const r = (Crew.reqs || []).find(x => x.email === d.email);
    if (!r) return;
    const role = (document.querySelector(`[data-rrole="${CSS.escape(d.email)}"]`) || {}).value || 'crew', projects = checkedPids('rp-' + d.email);
    if (role !== 'owner' && !projects.length && !confirm('Chưa chọn công trình nào — người này sẽ chưa thấy công trình nào. Vẫn duyệt?')) return;
    if (role === 'owner' && !confirm(`Cấp quyền CHỦ THẦU (xem toàn bộ tiền, hợp đồng, hồ sơ) cho ${d.email}?`)) return;
    const sb = Sync.client();
    const { error } = await sb.from('members').upsert({ email: d.email.toLowerCase(), role, name: r.name || '', projects: role === 'owner' ? [] : projects });
    if (error) return toast(error.message);
    await sb.from('access_requests').delete().eq('email', d.email);
    toast(`Đã duyệt ${r.name || d.email} — ${ROLE_NAME[role]}`); Crew.list = null; render();
  },
  reqNo: async d => {
    if (!confirm(`Từ chối yêu cầu của ${d.email}?`)) return;
    const { error } = await Sync.client().from('access_requests').update({ status: 'rejected' }).eq('email', d.email);
    if (error) return toast(error.message);
    toast('Đã từ chối'); Crew.list = null; render();
  },
  reqDel: async d => {
    const { error } = await Sync.client().from('access_requests').delete().eq('email', d.email);
    if (error) return toast(error.message);
    Crew.list = null; render();
  },
  crewReload: () => { Crew.list = null; Crew.error = ''; render(); },
  crewSave: async d => {
    const role = (document.querySelector(`[data-crole="${CSS.escape(d.email)}"]`) || {}).value || 'crew';
    const { error } = await Sync.client().from('members').update({ projects: checkedPids('cp-' + d.email), role }).eq('email', d.email);
    if (error) return toast(error.message);
    toast('Đã lưu vai trò và công trình giao'); loadCrew();
  },
  crewDel: async d => {
    if (!confirm(`Thu hồi quyền của ${d.email}? Tài khoản này sẽ không xem hay ghi được dữ liệu công ty nữa.`)) return;
    const { error } = await Sync.client().from('members').delete().eq('email', d.email);
    if (error) return toast(error.message);
    toast('Đã thu hồi quyền'); loadCrew();
  },
  crewAdd: async (d, btn) => {
    const role = $('#cwRole').value === 'supervisor' ? 'supervisor' : 'crew', name = $('#cwName').value.trim(), email = $('#cwEmail').value.trim().toLowerCase(), pass = $('#cwPass').value, projects = checkedPids('cp-new');
    if (!name) return toast('Nhập họ tên / tên đội');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Email không hợp lệ');
    if (pass.length < 6) return toast('Mật khẩu ít nhất 6 ký tự');
    if (Crew.owners.some(e => e.toLowerCase() === email)) return toast('Email này đang là chủ thầu');
    if (btn) btn.disabled = true;
    let note = '';
    try {
      // Tạo tài khoản bằng một kết nối riêng để không đăng xuất chủ thầu
      const c = Sync.config(), tmp = supabase.createClient(c.url, c.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'qlxd-tmp' } });
      const { data, error } = await tmp.auth.signUp({ email, password: pass });
      if (error && /signups? not allowed/i.test(error.message)) throw new Error('Supabase đang tắt đăng ký mới — bật Authentication → Sign In / Providers → Allow new users to sign up rồi tạo lại');
      if (error && !/already|registered|exists/i.test(error.message)) throw error;
      if (error) note = ' (email đã có tài khoản — dùng mật khẩu cũ của tài khoản đó)';
      else if (data && data.user && !data.session) note = ' — đội thợ cần bấm link xác nhận trong email trước khi đăng nhập';
      const { error: e2 } = await Sync.client().from('members').upsert({ email, role, name, projects });
      if (e2) throw e2;
      toast(`Đã tạo tài khoản ${role === 'supervisor' ? 'giám sát' : 'cai thợ'}` + note);
      Crew.list = null; render();
    } catch (e) { toast(e.message || 'Không tạo được tài khoản'); }
    if (btn) btn.disabled = false;
  },
});
window.crewCardHTML = crewCardHTML;
