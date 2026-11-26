'use strict';
/* Tiến độ công trình — đợt 1: lập kế hoạch theo mẫu từng tầng, đánh dấu xong kèm ảnh, % hoàn thành, cảnh báo trễ.
   Mỗi mốc là một bản ghi riêng (S.tasks) có projectId, để đồng bộ an toàn khi nhiều người cùng cập nhật. */

const DAY_MS = 86400000;
const toDate = iso => new Date(iso + 'T00:00:00');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / DAY_MS);
const ddmm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const taskDays = t => Math.max(1, Math.round(+t.days || 1));
const taskEnd = t => addDays(t.start, taskDays(t) - 1);
const tasksOf = pid => S.tasks.filter(t => t.projectId === pid).sort((a, b) => a.order - b.order);
const LV = n => (n === 0 ? 'tầng trệt' : `lầu ${n}`);
const LVT = n => (n === 0 ? 'Tầng trệt' : `Lầu ${n}`);

// Mẫu tiến độ theo bảng tiến độ trong quy trình công ty (nhà trệt + 1 lầu ≈ 128–134 ngày), tách theo từng tầng.
// chk: mốc cần nghiệm thu công việc khuất (dùng cho đợt 3) · pay: mốc gắn đợt thanh toán (dùng cho đợt 2)
function buildPlan(o) {
  const L = Math.max(0, Math.min(6, +o.floors || 0)), out = [];
  const add = (group, name, days, x = {}) => out.push({ group, name, days, ...x });
  add('Chuẩn bị', 'Định vị ranh mốc, lập biên bản hiện trạng nhà lân cận', 1);
  add('Chuẩn bị', 'Lán trại, điện nước thi công, che chắn công trình', 1, { par: 1 });
  if (o.pile) add('Phần móng', 'Ép cọc', 3, { chk: 'coc' });
  add('Phần móng', 'Đào móng', 5, { chk: 'daomong' });
  add('Phần móng', 'Cốt thép, cốp pha móng và đà kiềng', 8, { chk: 'thep' });
  add('Phần móng', 'Đổ bê tông móng, đà kiềng', 2, { pay: 'mong' });
  add('Phần móng', 'Hầm tự hoại, hồ nước', 5);
  const topSlab = o.tum ? 'sàn sân thượng' : 'sàn mái';
  for (let n = 0; n <= L; n++) {
    const g = 'Phần thô – ' + LVT(n), next = n < L ? `sàn ${LV(n + 1)}` : topSlab;
    add(g, `Cốt thép, cốp pha, đổ bê tông cột ${LV(n)}`, 4, { chk: 'thep' });
    add(g, `Xây tường bao ${LV(n)}`, 5);
    if (n === L && !o.tum && o.roof !== 'btct') { add(g, o.roof === 'ngoi' ? 'Kèo thép, lợp mái ngói' : 'Kèo thép, lợp mái tôn', 6, { pay: 'mai' }); continue; }
    add(g, `Cốt thép, cốp pha dầm ${next}`, 7, { chk: 'thep' });
    add(g, `Đổ bê tông ${next}`, 1, { pay: n === 0 ? 'san2' : (n === L && !o.tum ? 'mai' : '') });
  }
  if (o.tum) {
    const g = 'Phần thô – Tum';
    add(g, 'Cột, xây tường tum thang', 4, { chk: 'thep' });
    if (o.roof === 'btct') { add(g, 'Cốt thép, cốp pha mái tum', 4, { chk: 'thep' }); add(g, 'Đổ bê tông mái tum', 1, { pay: 'mai' }); }
    else add(g, o.roof === 'ngoi' ? 'Kèo thép, lợp mái ngói tum' : 'Kèo thép, lợp mái tôn tum', 4, { pay: 'mai' });
  }
  for (let n = 0; n <= L; n++) {
    const g = 'Xây tô, điện nước – ' + LVT(n);
    add(g, `Xây tường ngăn ${LV(n)}`, 6);
    add(g, `Đi điện nước âm ${LV(n)}`, 4, { par: 1, chk: 'diennuoc' });
    add(g, `Tô trát ${LV(n)}`, 7);
  }
  if (o.tum) add('Xây tô, điện nước – Tum', 'Xây tô tum thang', 4);
  for (let i = out.length - 1; i >= 0; i--) if (out[i].group.startsWith('Xây tô')) { out[i].pay = 'xayto'; break; }
  add('Chống thấm', 'Chống thấm sàn vệ sinh, ban công, sân thượng (ngâm nước 48 giờ)', 5, { chk: 'chongtham' });
  for (let n = 0; n <= L; n++) {
    const g = 'Hoàn thiện – ' + LVT(n);
    add(g, `Ốp lát ${LV(n)}`, 6);
    add(g, `Trần thạch cao ${LV(n)}`, 4);
    add(g, `Sơn nước ${LV(n)}`, 4);
  }
  add('Cửa, thiết bị', 'Sơn ngoại thất', 4);
  add('Cửa, thiết bị', 'Lắp cửa, đá granite, lan can', 5, { pay: 'cua' });
  add('Cửa, thiết bị', 'Lắp thiết bị điện nước, chạy thử 2 giờ', 4, { chk: 'thietbi' });
  add('Bàn giao', 'Vệ sinh công nghiệp', 5);
  add('Bàn giao', 'Nghiệm thu, bàn giao công trình', 1, { pay: 'bangiao' });
  return out;
}
// Xếp ngày nối tiếp; mốc "par" làm song song với mốc ngay trước
function schedule(list, start) {
  let cursor = start, prev = null;
  for (const t of list) {
    t.start = t.par && prev ? prev.start : cursor;
    const next = addDays(t.start, taskDays(t));
    if (next > cursor) cursor = next;
    prev = t;
  }
  return list;
}
function taskState(t, td = today()) {
  if (t.done) return 'done';
  if (taskEnd(t) < td) return 'late';
  if (t.start <= td) return 'doing';
  return 'todo';
}
function planStats(list) {
  const td = today(), total = list.reduce((a, t) => a + taskDays(t), 0), doneDays = list.filter(t => t.done).reduce((a, t) => a + taskDays(t), 0);
  const late = list.filter(t => taskState(t, td) === 'late');
  return {
    pct: total ? Math.round(doneDays / total * 100) : 0,
    done: list.filter(t => t.done).length,
    late: late.length,
    lateDays: late.reduce((m, t) => Math.max(m, diffDays(td, taskEnd(t))), 0),
    next: list.find(t => !t.done),
    finish: list.reduce((m, t) => (taskEnd(t) > m ? taskEnd(t) : m), ''),
  };
}
const STATE_BADGE = (t, td = today()) => {
  const s = taskState(t, td);
  if (s === 'done') return `<span class="badge green">Xong ${ddmm(t.doneDate)}</span>`;
  if (s === 'late') return `<span class="badge red">Trễ ${diffDays(td, taskEnd(t))} ngày</span>`;
  if (s === 'doing') return '<span class="badge orange">Đang làm</span>';
  return '<span class="badge">Chưa tới</span>';
};

// Tóm tắt trên thẻ dự án
function progressSummaryHTML(p) {
  const list = tasksOf(p.id);
  if (!list.length) return '';
  const st = planStats(list);
  return `<div class="prog tap" data-act="openProgress" data-id="${p.id}">
    <div class="row between small"><span class="muted">Tiến độ</span><span><b>${st.pct}%</b> · ${st.done}/${list.length} mốc${st.finish ? ` · dự kiến xong ${fdate(st.finish)}` : ''}</span></div>
    <div class="bar mt"><i class="ok" style="width:${st.pct}%"></i></div>
    <div class="row between wrap small mt" style="gap:6px"><span class="clip grow">${st.next ? `Tiếp theo: <b>${esc(st.next.name)}</b> · ${ddmm(st.next.start)}–${ddmm(taskEnd(st.next))}` : '<b class="pos">Đã xong tất cả các mốc</b>'}</span>${st.late ? `<span class="badge red">Trễ ${st.lateDays} ngày · ${st.late} mốc</span>` : ''}</div></div>`;
}
function progressLinkLabel(p) { const l = tasksOf(p.id); return l.length ? `Tiến độ (${planStats(l).pct}%)` : 'Lập tiến độ'; }

// Chọn ảnh (máy ảnh hoặc thư viện), trả về danh sách mã ảnh đã lưu
function pickPhotos(multiple = true) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = multiple; inp.hidden = true;
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const ids = [];
      for (const file of inp.files) {
        try { const id = uid(), src = await compressImage(file, 1600); await DB.set('photos', id, src); photoCache.set(id, src); ids.push(id); }
        catch (e) { toast('Không thêm được ảnh'); }
      }
      inp.remove(); resolve(ids);
    };
    inp.click();
  });
}

function openProgress(pid) {
  const p = proj(pid);
  if (!p) return;
  const el = openSheet(`<header><h2>Tiến độ · ${esc(p.name)}</h2><button class="btn sm" data-act="closeSheet" type="button">Đóng</button></header><div class="body" id="pgBody"></div><footer id="pgFoot"></footer>`, true);
  const $p = s => $(s, el);
  let filter = 'all', openGroups = null;

  const commit = () => { save(); render(); };
  const renumber = () => tasksOf(pid).forEach((t, i) => { if (t.order !== i) t.order = i; });

  // ---- Lập kế hoạch ----
  const drawSetup = () => {
    const o = p.plan || { floors: 1, roof: 'btct', tum: false, pile: true };
    $p('#pgBody').innerHTML = `<p class="small muted mb">App tạo sẵn các mốc theo quy trình công ty, chia theo từng tầng; ngày dự kiến tự tính từ ngày khởi công. Sau khi tạo vẫn sửa, thêm, xóa và đổi ngày từng mốc được.</p>
      <div class="fields">
        <div><label for="pgStart">Ngày khởi công</label><input type="date" id="pgStart" value="${esc(p.start || today())}"></div>
        <div><label for="pgFloors">Số lầu (trên tầng trệt)</label><select id="pgFloors">${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${+o.floors === n ? ' selected' : ''}>${n === 0 ? 'Chỉ tầng trệt' : `Trệt + ${n} lầu`}</option>`).join('')}</select></div>
        <div><label for="pgRoof">Mái</label><select id="pgRoof">${[['btct', 'Mái bê tông / sân thượng'], ['ngoi', 'Mái ngói kèo thép'], ['ton', 'Mái tôn']].map(([k, v]) => `<option value="${k}"${o.roof === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="full btns"><label class="chk"><input type="checkbox" id="pgTum"${o.tum ? ' checked' : ''}> Có tum thang</label><label class="chk"><input type="checkbox" id="pgPile"${o.pile ? ' checked' : ''}> Có ép cọc</label></div>
      </div>
      <div class="card mt" id="pgPreview"></div>`;
    $p('#pgFoot').innerHTML = `<button class="btn primary" type="button" id="pgCreate">Tạo kế hoạch tiến độ</button>`;
    const read = () => ({ start: $p('#pgStart').value || today(), floors: +$p('#pgFloors').value, roof: $p('#pgRoof').value, tum: $p('#pgTum').checked, pile: $p('#pgPile').checked });
    const preview = () => {
      const o2 = read(), list = schedule(buildPlan(o2), o2.start), end = list.reduce((m, t) => (taskEnd(t) > m ? taskEnd(t) : m), '');
      const groups = [...new Set(list.map(t => t.group))];
      $p('#pgPreview').innerHTML = `<b>${list.length} mốc</b> trong ${groups.length} giai đoạn · dự kiến hoàn thành <b>${fdate(end)}</b> (${diffDays(end, o2.start) + 1} ngày)
        <div class="small muted mt">${groups.map(esc).join(' → ')}</div>`;
    };
    $p('#pgBody').onchange = preview; preview();
    $p('#pgCreate').onclick = () => {
      const o2 = read(), list = schedule(buildPlan(o2), o2.start);
      list.forEach((t, i) => { delete t.par; S.tasks.push({ id: uid(), projectId: pid, order: i, done: false, doneDate: '', photos: [], note: '', ...t }); });
      p.plan = { floors: o2.floors, roof: o2.roof, tum: o2.tum, pile: o2.pile };
      if (!p.start) p.start = o2.start;
      commit(); toast(`Đã tạo ${list.length} mốc tiến độ`); draw();
    };
  };

  // ---- Danh sách mốc ----
  const drawPlan = list => {
    const td = today(), st = planStats(list);
    const groups = [];
    for (const t of list) { let g = groups.find(x => x.name === t.group); if (!g) groups.push(g = { name: t.group, items: [] }); g.items.push(t); }
    if (!openGroups) openGroups = new Set(groups.filter(g => g.items.some(t => !t.done)).slice(0, 3).map(g => g.name));
    const show = t => filter === 'all' || (filter === 'todo' && !t.done) || (filter === 'late' && taskState(t, td) === 'late');
    $p('#pgBody').innerHTML = `<div class="stats three">
        <div class="stat"><div class="k">Hoàn thành</div><div class="v">${st.pct}% <span class="small muted">· ${st.done}/${list.length} mốc</span></div><div class="bar mt"><i class="ok" style="width:${st.pct}%"></i></div></div>
        <div class="stat"><div class="k">Dự kiến xong</div><div class="v">${fdate(st.finish)}</div></div>
        <div class="stat"><div class="k">Trễ</div><div class="v ${st.late ? 'neg' : 'pos'}">${st.late ? `${st.late} mốc · ${st.lateDays} ngày` : 'Đúng tiến độ'}</div></div>
      </div>
      <div class="chips">${[['all', 'Tất cả'], ['todo', 'Chưa xong'], ['late', `Trễ (${st.late})`]].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" type="button" data-pf="${k}">${v}</button>`).join('')}</div>
      ${groups.map(g => {
        const items = g.items.filter(show);
        if (!items.length && filter !== 'all') return '';
        const gd = g.items.filter(t => t.done).length, undone = g.items.filter(t => !t.done).length;
        const gs = g.items.reduce((m, t) => (t.start < m ? t.start : m), g.items[0].start), ge = g.items.reduce((m, t) => (taskEnd(t) > m ? taskEnd(t) : m), '');
        const late = g.items.some(t => taskState(t, td) === 'late');
        const open = filter !== 'all' || openGroups.has(g.name);
        return `<div class="pg-group${gd === g.items.length ? ' gdone' : ''}">
          <div class="pg-gh" data-gt="${esc(g.name)}"><span class="pg-arrow">${open ? '▾' : '▸'}</span><b class="grow">${esc(g.name)}</b>
            <span class="small ${late ? 'neg' : 'muted'}">${gd}/${g.items.length} · ${ddmm(gs)}–${ddmm(ge)}</span></div>
          ${open ? items.map(t => `<div class="pg-t ${taskState(t, td)}">
              <button class="pg-ck" type="button" data-done="${t.id}" aria-label="${t.done ? 'Bỏ đánh dấu xong' : 'Đánh dấu xong'}">${t.done ? '✓' : ''}</button>
              <div class="grow tap" data-edit="${t.id}" style="min-width:0"><div class="pg-nm">${esc(t.name)}${t.chk ? ' <span class="badge blue">Nghiệm thu</span>' : ''}</div>
                <div class="small muted">${ddmm(t.start)}–${ddmm(taskEnd(t))} · ${taskDays(t)} ngày${(t.photos || []).length ? ` · 📷 ${t.photos.length}` : ''}${t.note ? ' · 📝' : ''}</div></div>
              ${STATE_BADGE(t, td)}</div>`).join('') + (undone > 1 ? `<div class="pg-gf"><button class="linkbtn" type="button" data-gdone="${esc(g.name)}">✓ Xong cả nhóm (${undone} mốc)</button></div>` : '') : ''}
        </div>`;
      }).join('') || '<p class="muted small">Không có mốc nào.</p>'}`;
    $p('#pgFoot').innerHTML = `<button class="btn" type="button" id="pgAdd">+ Thêm mốc</button><button class="btn" type="button" id="pgShift">Dời kế hoạch</button><button class="btn danger" type="button" id="pgReset">Xóa kế hoạch</button>`;
    $p('#pgAdd').onclick = () => drawEdit(null);
    $p('#pgShift').onclick = () => {
      const v = prompt('Dời tất cả các mốc CHƯA XONG thêm bao nhiêu ngày?\n(Nhập số âm để kéo sớm lại, VD: 5 hoặc -3)', '3');
      const n = Math.round(+String(v || '').replace(',', '.'));
      if (!n) return;
      tasksOf(pid).filter(t => !t.done).forEach(t => { t.start = addDays(t.start, n); });
      commit(); toast(`Đã dời ${n > 0 ? 'thêm' : 'sớm'} ${Math.abs(n)} ngày`); draw();
    };
    $p('#pgReset').onclick = () => {
      if (!confirm('Xóa toàn bộ kế hoạch tiến độ của công trình này (cả ảnh của các mốc)?')) return;
      tasksOf(pid).forEach(t => (t.photos || []).forEach(ph => DB.del('photos', ph)));
      S.tasks = S.tasks.filter(t => t.projectId !== pid);
      openGroups = null; commit(); toast('Đã xóa kế hoạch tiến độ'); draw();
    };
  };

  // Đánh dấu xong: bắt buộc có ảnh
  const markDone = async ids => {
    const photos = await pickPhotos(true);
    if (!photos.length) return toast('Cần ít nhất 1 ảnh để đánh dấu xong');
    const list = ids.map(id => S.tasks.find(t => t.id === id)).filter(Boolean), td = today();
    // Ảnh gắn vào mốc cuối của nhóm; các mốc còn lại ghi chú đã xong cùng nhóm
    const last = list[list.length - 1];
    last.photos = [...(last.photos || []), ...photos];
    list.forEach(t => { t.done = true; t.doneDate = td; });
    commit(); toast(list.length > 1 ? `Đã xong ${list.length} mốc` : 'Đã đánh dấu xong'); draw();
  };

  // ---- Sửa / thêm mốc ----
  const drawEdit = id => {
    const orig = id ? S.tasks.find(t => t.id === id) : null;
    const list = tasksOf(pid), lastGroup = list.length ? list[list.length - 1].group : 'Khác';
    const t = orig ? JSON.parse(JSON.stringify(orig)) : { id: uid(), projectId: pid, group: lastGroup, name: '', start: today(), days: 1, done: false, doneDate: '', photos: [], note: '' };
    const added = [];
    const groups = [...new Set(list.map(x => x.group))];
    $p('#pgBody').innerHTML = `<div class="fields">
        <div class="full"><label for="pgN">Tên mốc / công việc</label><input id="pgN" value="${esc(t.name)}" placeholder="VD: Đổ bê tông sàn lầu 1"></div>
        <div class="full"><label for="pgG">Giai đoạn</label><input id="pgG" list="pgGL" value="${esc(t.group)}"><datalist id="pgGL">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div><label for="pgS">Ngày bắt đầu</label><input type="date" id="pgS" value="${esc(t.start)}"></div>
        <div><label for="pgD">Số ngày</label><input id="pgD" inputmode="numeric" value="${taskDays(t)}"></div>
        ${orig ? `<div class="full"><label class="chk"><input type="checkbox" id="pgShiftNext" checked> Đổi ngày thì dời các mốc chưa xong phía sau theo</label></div>` : ''}
        <div><label class="chk" style="margin-top:8px"><input type="checkbox" id="pgDone"${t.done ? ' checked' : ''}> Đã xong</label></div>
        <div><label for="pgDD">Ngày xong</label><input type="date" id="pgDD" value="${esc(t.doneDate || '')}"></div>
        <div class="full"><label for="pgNote">Ghi chú</label><textarea id="pgNote" rows="2">${esc(t.note || '')}</textarea></div>
        <div class="full"><label>Ảnh hiện trường (bắt buộc khi đã xong)</label><div class="thumbs" id="pgPh"></div><div class="mt"><button type="button" class="btn sm" id="pgAddPh">📷 Thêm ảnh</button></div></div>
      </div>`;
    const drawPh = () => {
      $p('#pgPh').innerHTML = t.photos.map(ph => `<div class="ph"><img data-ph="${ph}" data-act="viewPhoto" alt="Ảnh mốc"><button type="button" data-rmph="${ph}" aria-label="Bỏ ảnh">×</button></div>`).join('');
      hydratePhotos($p('#pgPh'));
    };
    drawPh();
    $p('#pgPh').onclick = e => { const ph = e.target.dataset.rmph; if (ph) { t.photos = t.photos.filter(x => x !== ph); drawPh(); } };
    $p('#pgAddPh').onclick = async () => { const ids = await pickPhotos(true); added.push(...ids); t.photos.push(...ids); drawPh(); };
    $p('#pgDone').onchange = e => { if (e.target.checked && !$p('#pgDD').value) $p('#pgDD').value = today(); };
    const back = () => { added.filter(ph => !t.photos.includes(ph) || !saved).forEach(ph => DB.del('photos', ph)); draw(); };
    let saved = false;
    $p('#pgFoot').innerHTML = `<button class="btn" type="button" id="pgBack">← Tiến độ</button>${orig ? '<button class="btn danger" type="button" id="pgDel">Xóa</button>' : ''}<button class="btn primary" type="button" id="pgSave">Lưu mốc</button>`;
    $p('#pgBack').onclick = back;
    if (orig) $p('#pgDel').onclick = () => {
      if (!confirm('Xóa mốc này?')) return;
      (orig.photos || []).forEach(ph => DB.del('photos', ph));
      S.tasks = S.tasks.filter(x => x.id !== orig.id); renumber(); commit(); toast('Đã xóa mốc'); draw();
    };
    $p('#pgSave').onclick = () => {
      const name = $p('#pgN').value.trim(), days = Math.max(1, Math.round(dec($p('#pgD').value) || 1)), start = $p('#pgS').value || today();
      const done = $p('#pgDone').checked;
      if (!name) { toast('Vui lòng nhập tên mốc'); return $p('#pgN').focus(); }
      if (done && !t.photos.length) return toast('Cần ít nhất 1 ảnh để đánh dấu xong');
      const oldEnd = orig ? taskEnd(orig) : null;
      Object.assign(t, { name, group: $p('#pgG').value.trim() || 'Khác', start, days, done, doneDate: done ? ($p('#pgDD').value || today()) : '', note: $p('#pgNote').value.trim() });
      added.filter(ph => !t.photos.includes(ph)).forEach(ph => DB.del('photos', ph));
      if (orig) {
        (orig.photos || []).filter(ph => !t.photos.includes(ph)).forEach(ph => DB.del('photos', ph));
        const delta = diffDays(taskEnd(t), oldEnd);
        if (delta && $p('#pgShiftNext')?.checked) tasksOf(pid).filter(x => x.order > orig.order && !x.done).forEach(x => { x.start = addDays(x.start, delta); });
        Object.assign(orig, t);
      } else {
        // Thêm vào cuối giai đoạn đã chọn (hoặc cuối danh sách nếu là giai đoạn mới)
        const inGroup = tasksOf(pid).filter(x => x.group === t.group);
        t.order = (inGroup.length ? inGroup[inGroup.length - 1].order : tasksOf(pid).length) + 0.5;
        S.tasks.push(t); renumber();
      }
      saved = true; commit(); toast('Đã lưu mốc'); draw();
    };
    $p('#pgN').focus();
  };

  const draw = () => { $p('#pgBody').onchange = null; const list = tasksOf(pid); if (list.length) drawPlan(list); else drawSetup(); };
  el.addEventListener('click', e => {
    const x = e.target.closest('[data-pf],[data-gt],[data-done],[data-gdone],[data-edit]');
    if (!x) return;
    if (x.dataset.pf) { filter = x.dataset.pf; draw(); }
    else if (x.dataset.gt !== undefined) { const g = x.dataset.gt; openGroups.has(g) ? openGroups.delete(g) : openGroups.add(g); draw(); }
    else if (x.dataset.gdone !== undefined) markDone(tasksOf(pid).filter(t => t.group === x.dataset.gdone && !t.done).map(t => t.id));
    else if (x.dataset.done) {
      const t = S.tasks.find(y => y.id === x.dataset.done);
      if (!t) return;
      if (t.done) { if (confirm('Bỏ đánh dấu xong mốc này? (Ảnh vẫn được giữ)')) { t.done = false; t.doneDate = ''; commit(); draw(); } }
      else markDone([t.id]);
    } else if (x.dataset.edit) drawEdit(x.dataset.edit);
  });
  draw();
}
