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
    <div class="row between wrap small mt" style="gap:6px"><span class="clip grow">${st.next ? `Tiếp theo: <b>${esc(st.next.name)}</b> · ${ddmm(st.next.start)}–${ddmm(taskEnd(st.next))}` : '<b class="pos">Đã xong tất cả các mốc</b>'}</span>${st.late ? `<span class="badge red">Trễ ${st.lateDays} ngày · ${st.late} mốc</span>` : ''}</div>
    ${(() => { const due = [...dueStages(p.id).map(s => `đợt ${s.i + 1} · ${short(s.amount)}`), ...changeSummary(p.id).unpaid.map(c => `${c.no} · ${short(changeTotal(c))}`)]; return due.length ? `<div class="small mt warn">💰 Đến hạn thu: ${due.join(', ')}</div>` : ''; })()}
    ${(() => { const w = accWaiting(p.id); return w.length ? `<div class="small mt warn">📋 Chờ nghiệm thu: ${w.length} mốc (${esc(w[0].name)}${w.length > 1 ? '…' : ''})</div>` : ''; })()}</div>`;
}
function progressLinkLabel(p) { const l = tasksOf(p.id); return l.length ? `Tiến độ (${planStats(l).pct}%)` : 'Lập tiến độ'; }

// ---------- Thanh toán theo tiến độ (đợt 2) ----------
// Hợp đồng thi công của dự án = báo giá hình thức Nhân công / Trọn gói thô đã soạn hợp đồng (ưu tiên báo giá đã duyệt, mới nhất)
function contractFor(pid) {
  const qs = S.quotes.filter(q => q.projectId === pid && (q.form === 'labor' || q.form === 'rough') && q.ct && q.ct.form === q.form && Array.isArray(q.ct.pay) && q.ct.pay.length);
  qs.sort((a, b) => (b.status === 'approved') - (a.status === 'approved') || String(b.date || '').localeCompare(String(a.date || '')));
  return qs[0] || null;
}
// Tự nhận mốc theo chữ trong "Thời điểm" của đợt: "Khi xong bê tông móng" → mốc đổ bê tông móng…
const PAY_RULES = [['sign', /ký hợp đồng|tạm ứng/i], ['bangiao', /bàn giao|quyết toán/i], ['pct', /(\d+)\s*%\s*(khối lượng|tiến độ)/i], ['mong', /móng/i], ['san2', /sàn (tầng 2|lầu 1)/i], ['mai', /mái/i], ['xayto', /xây tô|tô trát/i], ['cua', /cửa|thiết bị|granite/i]];
function autoLink(label) {
  for (const [k, re] of PAY_RULES) { const m = re.exec(label || ''); if (m) return k === 'pct' ? 'pct:' + m[1] : k; }
  return '';
}
function payStages(pid) {
  const q = contractFor(pid);
  if (!q) return null;
  const list = tasksOf(pid), st = planStats(list), value = contractValue(q, q.ct).value, am = payAmounts(value, q.ct.pay);
  const stages = q.ct.pay.map((x, i) => {
    const link = x.link || autoLink(x.label);
    let task = null, due = false, dueDate = '', when = '';
    if (link === 'sign') { due = true; dueDate = q.ct.date || ''; when = 'khi ký hợp đồng'; }
    else if (link.startsWith('pct:')) { const need = +link.slice(4); due = list.length > 0 && st.pct >= need; when = `khi đạt ${need}% tiến độ (hiện ${st.pct}%)`; }
    else if (link) {
      task = list.find(t => t.id === link) || list.find(t => t.pay === link) || null;
      if (task) { due = !!task.done; dueDate = task.doneDate || ''; when = `khi xong "${task.name}"`; }
    }
    return { i, label: x.label, pct: +x.pct || 0, amount: am[i], link: task || link === 'sign' || link.startsWith('pct:') ? link : '', task, when, dueDate, paid: x.paid || null, state: x.paid ? 'paid' : due ? 'due' : 'wait' };
  });
  return { q, value, stages };
}
const dueStages = pid => { const ps = payStages(pid); return ps ? ps.stages.filter(s => s.state === 'due') : []; };
// Nhắc trên đầu trang Dự án: mọi đợt đến hạn thu chưa thu
function dueBannerHTML() {
  const rows = S.projects.flatMap(p => [
    ...dueStages(p.id).map(s => ({ p, text: `đợt ${s.i + 1} (${fmt(s.pct)}%) ${s.label}`, amount: s.amount })),
    ...changeSummary(p.id).unpaid.map(c => ({ p, text: `phát sinh ${c.no} ${c.title || ''}`, amount: changeTotal(c) })),
  ]);
  if (!rows.length) return '';
  return `<div class="card mb due-card"><div class="row between wrap" style="gap:6px"><b>💰 Đến hạn thu tiền · ${rows.length} khoản</b><b class="num">${money(rows.reduce((a, r) => a + r.amount, 0))}</b></div>
    ${rows.map(r => `<div class="row between small mt tap" data-act="openProgress" data-id="${r.p.id}"><span class="grow clip">${esc(r.p.name)} – ${esc(r.text)}</span><b class="num">${short(r.amount)}</b></div>`).join('')}</div>`;
}
function payCardHTML(pid, detailsOpen) {
  const ps = payStages(pid);
  if (!ps) return `<div class="card mb small muted">💰 Chưa có hợp đồng thi công cho công trình này. Soạn hợp đồng từ báo giá hình thức <b>Nhân công</b> hoặc <b>Trọn gói thô</b> thì app sẽ nhắc thu tiền khi xong mốc.</div>`;
  const list = tasksOf(pid), paid = ps.stages.filter(s => s.state === 'paid').reduce((a, s) => a + s.amount, 0);
  const opts = s => [['', `Tự động${s.link ? '' : ' (chưa nhận ra)'}`], ['sign', 'Khi ký hợp đồng'], ['pct:50', 'Khi đạt 50% tiến độ'], ['pct:70', 'Khi đạt 70% tiến độ'], ...list.map(t => [t.id, `${t.group} › ${t.name}`])]
    .map(([v, l]) => `<option value="${esc(v)}"${(ps.q.ct.pay[s.i].link || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="card mb pay-card"><div class="row between wrap" style="gap:6px"><b>💰 Thanh toán theo tiến độ</b><span class="small muted">HĐ ${esc(ps.q.ct.no || ps.q.no)} · ${short(ps.value)} · đã thu ${short(paid)}</span></div>
    ${ps.stages.map(s => `<div class="pay-row ${s.state}"><div class="grow" style="min-width:0"><div><b>Đợt ${s.i + 1}</b> · ${fmt(s.pct)}% · ${esc(s.label)}</div>
      <div class="small ${s.state === 'due' ? 'warn' : 'muted'}">${s.state === 'paid' ? `✓ Đã thu ${fdate(s.paid.date)}`
        : s.state === 'due' ? `⚠ Đến hạn thu${s.task ? ` – đã xong "${esc(s.task.name)}"${s.dueDate ? ' ngày ' + ddmm(s.dueDate) : ''}` : ''}`
        : s.link ? `Chưa đến – ${esc(s.when)}${s.task ? ` · dự kiến ${fdate(taskEnd(s.task))}` : ''}` : 'Chưa gắn mốc – chọn ở mục bên dưới'}</div></div>
      <b class="num">${fmt(s.amount)}</b>${s.state === 'due' ? `<button class="btn sm primary" type="button" data-paid="${s.i}">Đã thu</button>` : s.state === 'paid' ? `<button class="linkbtn" type="button" data-unpaid="${s.i}">Bỏ</button>` : ''}</div>`).join('')}
    <details class="mt"${detailsOpen ? ' open' : ''}><summary class="small" data-pdet>Gắn đợt thanh toán với mốc tiến độ</summary>
      ${ps.stages.map(s => `<div class="kvrow plink"><span class="small">Đợt ${s.i + 1} · ${esc(s.label)}</span><select data-plink="${s.i}" aria-label="Mốc cho đợt ${s.i + 1}">${opts(s)}</select></div>`).join('')}
    </details>${(() => { const cs = changeSummary(pid); return cs.list.length ? `<div class="row between wrap small mt tap" data-gotab="chg" style="gap:6px"><span>➕ Phát sinh đã duyệt: <b>${cs.approved > 0 ? '+' : ''}${fmt(cs.approved)}</b>${cs.pending ? ` · ${cs.pending} phiếu chờ duyệt` : ''}</span>${cs.unpaid.length ? `<span class="warn">Chưa thu ${short(cs.unpaid.reduce((a, c) => a + changeTotal(c), 0))}</span>` : ''}</div>` : ''; })()}</div>`;
}

// ---------- Biểu đồ thời gian: kế hoạch (thanh xám) và thực tế (thanh màu theo trạng thái) ----------
function chartHTML(pid, list, show, width) {
  const td = today(), rows = list.filter(show);
  if (!rows.length) return '<p class="muted small">Không có mốc nào.</p>';
  const NAME = width < 640 ? 132 : 250;
  let start = rows.reduce((m, t) => (t.start < m ? t.start : m), rows[0].start);
  let end = rows.reduce((m, t) => [taskEnd(t), t.doneDate || '', m].reduce((a, b) => (b > a ? b : a)), td);
  start = addDays(start, -2); end = addDays(end, 4);
  // Máy tính: thu nhỏ tỉ lệ để thấy trọn kế hoạch; điện thoại: giữ tối thiểu 6px/ngày và cho cuộn ngang
  const days = diffDays(end, start) + 1, ppd = Math.max(width >= 800 ? 2 : 6, Math.min(28, (width - NAME - 4) / days)), W = Math.ceil(days * ppd);
  const x = iso => Math.round(diffDays(iso, start) * ppd);
  const step = 7 * ppd >= 46 ? 7 : 14;
  let firstMon = start;
  while (toDate(firstMon).getDay() !== 1) firstMon = addDays(firstMon, 1);
  const ticks = [];
  for (let d = firstMon; d <= end; d = addDays(d, step)) ticks.push(`<span style="left:${x(d)}px">${ddmm(d)}</span>`);
  const pays = {};
  (payStages(pid) || { stages: [] }).stages.forEach(s => { if (s.task) pays[s.task.id] = s; });
  const bar = (a, b, cls, glyph) => {
    const l = x(a), w = Math.max(ppd, x(addDays(b, 1)) - l);
    return `<i class="gt-act ${cls}" style="left:${l}px;width:${w}px"></i>${glyph ? `<b class="gt-g ${cls}" style="left:${l + w + 3}px">${glyph}</b>` : ''}`;
  };
  let html = '', group = null;
  for (const t of rows) {
    if (t.group !== group) {
      group = t.group;
      const g = list.filter(y => y.group === group), gs = g.reduce((m, y) => (y.start < m ? y.start : m), g[0].start), ge = g.reduce((m, y) => (taskEnd(y) > m ? taskEnd(y) : m), '');
      html += `<div class="gt-row g"><div class="gt-name" style="width:${NAME}px">${esc(group)}</div><div class="gt-track" style="width:${W}px"><i class="gt-plan" style="left:${x(gs)}px;width:${Math.max(ppd, x(addDays(ge, 1)) - x(gs))}px"></i></div></div>`;
    }
    const s = taskState(t, td), late = s === 'done' ? diffDays(t.doneDate, taskEnd(t)) : diffDays(td, taskEnd(t));
    const status = s === 'done' ? `✓ Xong ${fdate(t.doneDate)}${late > 0 ? ` – trễ ${late} ngày` : late < 0 ? ` – sớm ${-late} ngày` : ' – đúng hạn'}`
      : s === 'late' ? `⚠ Trễ ${late} ngày (chưa xong)` : s === 'doing' ? 'Đang làm' : 'Chưa tới';
    const pay = pays[t.id];
    const tip = `${t.name}\nKế hoạch: ${fdate(t.start)} – ${fdate(taskEnd(t))} (${taskDays(t)} ngày)\n${status}${pay ? `\n💰 Đợt ${pay.i + 1}: ${fmt(pay.amount)} đ${pay.state === 'paid' ? ' (đã thu)' : pay.state === 'due' ? ' (đến hạn thu)' : ''}` : ''}`;
    const act = s === 'done' ? bar(t.doneDate < t.start ? t.doneDate : t.start, t.doneDate, 'done', '✓') : (s === 'doing' || s === 'late') ? bar(t.start, td, s, s === 'late' ? '⚠' : '') : '';
    const pe = x(addDays(taskEnd(t), 1));
    html += `<div class="gt-row" data-edit="${t.id}" data-tip="${esc(tip)}"><div class="gt-name" style="width:${NAME}px">${esc(t.name)}</div><div class="gt-track" style="width:${W}px"><i class="gt-plan" style="left:${x(t.start)}px;width:${Math.max(ppd, pe - x(t.start))}px"></i>${act}${pay ? `<b class="gt-pay" style="left:${Math.max(pe, act ? x(addDays(s === 'done' ? t.doneDate : td, 1)) + 16 : pe) + 4}px">💰</b>` : ''}</div></div>`;
  }
  return `<div class="gt-legend small"><span><i class="sw plan"></i>Kế hoạch</span><span><i class="sw done"></i>✓ Đã xong</span><span><i class="sw doing"></i>Đang làm</span><span><i class="sw late"></i>⚠ Trễ</span><span><i class="sw today"></i>Hôm nay</span><span>💰 Đợt thanh toán</span></div>
    <div class="gantt"><div class="gt-in" style="--wk:${7 * ppd}px;--off:${x(firstMon)}px">
      <div class="gt-row gt-head"><div class="gt-name small muted" style="width:${NAME}px">Mốc / công việc</div><div class="gt-track" style="width:${W}px">${ticks.join('')}</div></div>
      ${html}
      <div class="gt-today" style="left:${NAME + x(td) + Math.round(ppd / 2)}px"><span>Hôm nay ${ddmm(td)}</span></div>
    </div></div>`;
}

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
  el.classList.add('xwide');
  const $p = s => $(s, el);
  let filter = 'all', openGroups = null, payOpen = false, tab = 'plan';
  const tabsHTML = () => {
    const w = accWaiting(pid).length, n = changesOf(pid).length;
    return `<div class="pg-tabs" role="tablist">${[['plan', '📅 Tiến độ'], ['acc', `📋 Nghiệm thu${w ? ` <span class="badge orange">${w}</span>` : ''}`], ['chg', `➕ Phát sinh${n ? ` <span class="badge">${n}</span>` : ''}`]]
      .map(([k, v]) => `<button class="${tab === k ? 'on' : ''}" type="button" role="tab" aria-selected="${tab === k}" data-tab="${k}">${v}</button>`).join('')}</div>`;
  };
  if (!S.ui.pgView) S.ui.pgView = innerWidth >= 900 ? 'chart' : 'list';

  const commit = () => { save(); render(); };
  const renumber = () => tasksOf(pid).forEach((t, i) => { if (t.order !== i) t.order = i; });

  // ---- Lập kế hoạch ----
  const drawSetup = () => {
    const o = p.plan || { floors: 1, roof: 'btct', tum: false, pile: true };
    $p('#pgBody').innerHTML = tabsHTML() + `<p class="small muted mb">App tạo sẵn các mốc theo quy trình công ty, chia theo từng tầng; ngày dự kiến tự tính từ ngày khởi công. Sau khi tạo vẫn sửa, thêm, xóa và đổi ngày từng mốc được.</p>
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
    $p('#pgBody').innerHTML = tabsHTML() + `<div class="stats three">
        <div class="stat"><div class="k">Hoàn thành</div><div class="v">${st.pct}% <span class="small muted">· ${st.done}/${list.length} mốc</span></div><div class="bar mt"><i class="ok" style="width:${st.pct}%"></i></div></div>
        <div class="stat"><div class="k">Dự kiến xong</div><div class="v">${fdate(st.finish)}</div></div>
        <div class="stat"><div class="k">Trễ</div><div class="v ${st.late ? 'neg' : 'pos'}">${st.late ? `${st.late} mốc · ${st.lateDays} ngày` : 'Đúng tiến độ'}</div></div>
      </div>
      ${payCardHTML(pid, payOpen)}
      <div class="row between wrap" style="gap:8px;margin-bottom:12px">
        <div class="chips" style="margin:0">${[['all', 'Tất cả'], ['todo', 'Chưa xong'], ['late', `Trễ (${st.late})`]].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" type="button" data-pf="${k}">${v}</button>`).join('')}</div>
        <div class="chips" style="margin:0">${[['list', '☰ Danh sách'], ['chart', '▤ Biểu đồ']].map(([k, v]) => `<button class="chip ${S.ui.pgView === k ? 'on' : ''}" type="button" data-view="${k}">${v}</button>`).join('')}</div>
      </div>
      ${S.ui.pgView === 'chart' ? '<div id="pgChart"></div>' : groups.map(g => {
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
              <div class="grow tap" data-edit="${t.id}" style="min-width:0"><div class="pg-nm">${esc(t.name)} ${ACC_BADGE(t)}</div>
                <div class="small muted">${ddmm(t.start)}–${ddmm(taskEnd(t))} · ${taskDays(t)} ngày${(t.photos || []).length ? ` · 📷 ${t.photos.length}` : ''}${t.note ? ' · 📝' : ''}</div></div>
              ${STATE_BADGE(t, td)}</div>`).join('') + (undone > 1 ? `<div class="pg-gf"><button class="linkbtn" type="button" data-gdone="${esc(g.name)}">✓ Xong cả nhóm (${undone} mốc)</button></div>` : '') : ''}
        </div>`;
      }).join('') || '<p class="muted small">Không có mốc nào.</p>'}`;
    if (S.ui.pgView === 'chart') $p('#pgChart').innerHTML = chartHTML(pid, list, show, $p('#pgBody').clientWidth - 28);
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
    const dueBefore = new Set(dueStages(pid).map(s => s.i));
    last.photos = [...(last.photos || []), ...photos];
    list.forEach(t => { t.done = true; t.doneDate = td; });
    commit(); draw();
    // Xong mốc gắn đợt thanh toán → nhắc thu tiền
    const newDue = dueStages(pid).filter(s => !dueBefore.has(s.i));
    toast(newDue.length ? `💰 Đến hạn thu đợt ${newDue.map(s => `${s.i + 1}: ${money(s.amount)}`).join(', ')} — bấm "Đã thu" khi nhận tiền` : list.length > 1 ? `Đã xong ${list.length} mốc` : 'Đã đánh dấu xong');
    // Mốc cần nghiệm thu công việc khuất: mở ngay phiếu nghiệm thu
    if (list.length === 1 && accState(last) === 'wait') drawAcc(last.id, true);
  };

  // ---- Nghiệm thu ----
  const drawAccList = () => {
    const list = tasksOf(pid).filter(t => accState(t));
    const order = { fail: 0, wait: 1, todo: 2, pass: 3 };
    const rows = [...list].sort((a, b) => order[accState(a)] - order[accState(b)] || a.order - b.order);
    const pass = list.filter(t => accState(t) === 'pass').length, wait = accWaiting(pid).length;
    $p('#pgBody').innerHTML = tabsHTML() + (list.length ? `<div class="stats three">
        <div class="stat"><div class="k">Đã nghiệm thu</div><div class="v pos">${pass}/${list.length}</div></div>
        <div class="stat"><div class="k">Chờ nghiệm thu</div><div class="v ${wait ? 'warn' : ''}">${wait}</div></div>
        <div class="stat"><div class="k">Sắp tới</div><div class="v">${list.filter(t => accState(t) === 'todo').length}</div></div></div>
      <p class="small muted mb">Các mốc công việc khuất (cọc, móng, cốt thép, điện nước âm, chống thấm, thiết bị) phải nghiệm thu trước khi làm tiếp. Bấm một mốc để đánh giá theo bảng kiểm và in biên bản.</p>
      ${rows.map(t => `<div class="pg-t acc-${accState(t)} tap" data-acc="${t.id}"><div class="grow" style="min-width:0"><div class="pg-nm">${esc(t.name)}</div>
          <div class="small muted">${esc(t.group)} · ${t.acc ? `${accCode(t.acc.no)} · ${fdate(t.acc.date)}` : t.done ? `xong ${fdate(t.doneDate)}` : `dự kiến ${ddmm(taskEnd(t))}`}${accState(t) === 'fail' && t.acc.fix ? ` · Sửa: ${esc(t.acc.fix)}` : ''}</div></div>
          ${ACC_BADGE(t)}</div>`).join('')}`
      : `<p class="muted">${tasksOf(pid).length ? 'Kế hoạch chưa có mốc cần nghiệm thu.' : 'Lập kế hoạch tiến độ trước — các mốc cần nghiệm thu được đánh dấu sẵn theo quy trình.'}</p>`);
    $p('#pgFoot').innerHTML = '';
  };

  // Phiếu nghiệm thu một mốc: bảng kiểm Đạt / Không đạt, kết luận, ảnh, in biên bản
  const drawAcc = (id, fromDone) => {
    const t = S.tasks.find(x => x.id === id);
    if (!t) return draw();
    const p = proj(pid), { aDef, bDef } = partyLines(p);
    const a = t.acc ? JSON.parse(JSON.stringify(t.acc)) : { date: today(), a: aDef, b: bDef, items: checklistFor(t).map(x => ({ t: x, ok: null, note: '' })), note: '', fix: '', due: '' };
    const photos = [...(t.photos || [])], added = [];
    const result = () => (a.items.some(x => x.ok === false) ? 'fail' : a.items.every(x => x.ok === true) ? 'pass' : '');
    const drawItems = () => {
      $p('#acItems').innerHTML = a.items.map((x, i) => `<div class="ac-row"><div class="grow" style="min-width:0">${i + 1}. ${esc(x.t)}<input class="ac-note" data-an="${i}" value="${esc(x.note || '')}" placeholder="Ghi chú (nếu có)" aria-label="Ghi chú mục ${i + 1}"></div>
        <div class="seg"><button type="button" class="${x.ok === true ? 'on ok' : ''}" data-ok="${i}" aria-pressed="${x.ok === true}">✓ Đạt</button><button type="button" class="${x.ok === false ? 'on no' : ''}" data-no="${i}" aria-pressed="${x.ok === false}">✗ Không</button></div></div>`).join('');
      const r = result();
      $p('#acResult').innerHTML = r === 'pass' ? '<b class="pos">✓ Đạt – chấp nhận nghiệm thu, cho làm tiếp</b>'
        : r === 'fail' ? '<b class="neg">✗ Không đạt – yêu cầu sửa và nghiệm thu lại</b>' : `<span class="muted">Còn ${a.items.filter(x => x.ok === null).length} mục chưa đánh giá</span>`;
      $p('#acFix').hidden = r !== 'fail';
    };
    const drawPh = () => { $p('#acPh').innerHTML = photos.map(ph => `<div class="ph"><img data-ph="${ph}" data-act="viewPhoto" alt="Ảnh mốc"><button type="button" data-rmph="${ph}" aria-label="Bỏ ảnh">×</button></div>`).join(''); hydratePhotos($p('#acPh')); };
    $p('#pgBody').innerHTML = `${fromDone ? '<div class="card mb due-card small">📋 Mốc này là công việc khuất, cần nghiệm thu với chủ nhà trước khi làm tiếp. Có thể nghiệm thu ngay, hoặc bấm "← Tiến độ" để làm sau (mốc nằm ở thẻ Nghiệm thu).</div>' : ''}
      <h3 class="mb">${esc(t.name)}</h3><p class="small muted mb">${esc(t.group)} · ${fdate(t.start)} – ${t.doneDate ? 'xong ' + fdate(t.doneDate) : 'chưa xong'}${t.acc ? ' · ' + accCode(t.acc.no) : ''}</p>
      <div class="fields">
        <div><label for="acDate">Ngày nghiệm thu</label><input type="date" id="acDate" value="${esc(a.date)}"></div><div></div>
        <div><label for="acA">Đại diện Bên A (chủ nhà)</label><input id="acA" value="${esc(a.a)}"></div>
        <div><label for="acB">Đại diện Bên B (nhà thầu)</label><input id="acB" value="${esc(a.b)}"></div>
      </div>
      <div class="row between mt mb"><b>Bảng kiểm</b><button class="linkbtn" type="button" id="acAll">✓ Đạt tất cả</button></div>
      <div id="acItems"></div>
      <div class="card mt" id="acResult"></div>
      <div class="fields mt" id="acFix" hidden>
        <div class="full"><label for="acFixT">Nội dung yêu cầu sửa</label><input id="acFixT" value="${esc(a.fix || '')}" placeholder="VD: bổ sung con kê, chỉnh khoảng cách thép đai dầm D3"></div>
        <div><label for="acDue">Hạn sửa xong</label><input type="date" id="acDue" value="${esc(a.due || '')}"></div>
      </div>
      <div class="fields mt"><div class="full"><label for="acNote">Ý kiến khác</label><textarea id="acNote" rows="2">${esc(a.note || '')}</textarea></div>
        <div class="full"><label>Ảnh hiện trường (in kèm biên bản, bắt buộc khi đạt)</label><div class="thumbs" id="acPh"></div><div class="mt"><button type="button" class="btn sm" id="acAddPh">📷 Thêm ảnh</button></div></div>
        <div class="full"><label class="chk"><input type="checkbox" id="acDoc" checked> Lưu biên bản (Word) vào Hồ sơ dự án</label></div></div>`;
    drawItems(); drawPh();
    const read = () => { a.date = $p('#acDate').value || today(); a.a = $p('#acA').value.trim(); a.b = $p('#acB').value.trim(); a.note = $p('#acNote').value.trim(); a.fix = $p('#acFixT').value.trim(); a.due = $p('#acDue').value; a.result = result(); };
    $p('#pgBody').oninput = e => { const i = e.target.dataset.an; if (i !== undefined) a.items[+i].note = e.target.value; };
    $p('#pgBody').onclick = async e => {
      const b = e.target.closest('[data-ok],[data-no],[data-rmph],#acAll,#acAddPh');
      if (!b) return;
      if (b.id === 'acAll') { a.items.forEach(x => { x.ok = true; }); drawItems(); }
      else if (b.id === 'acAddPh') { const ids = await pickPhotos(true); added.push(...ids); photos.push(...ids); drawPh(); }
      else if (b.dataset.rmph) { photos.splice(photos.indexOf(b.dataset.rmph), 1); drawPh(); }
      else { const i = +(b.dataset.ok ?? b.dataset.no), v = b.dataset.ok !== undefined; a.items[i].ok = a.items[i].ok === v ? null : v; drawItems(); }
    };
    const cleanup = keep => added.filter(ph => !keep || !photos.includes(ph)).forEach(ph => DB.del('photos', ph));
    $p('#pgFoot').innerHTML = `<button class="btn" type="button" id="acBack">← ${fromDone ? 'Tiến độ' : 'Nghiệm thu'}</button><button class="btn" type="button" id="acPrint">🖨 In biên bản</button><button class="btn primary" type="button" id="acSave">Lưu nghiệm thu</button>`;
    $p('#acBack').onclick = () => { cleanup(false); tab = fromDone ? 'plan' : 'acc'; draw(); };
    $p('#acPrint').onclick = () => { read(); printWithPhotos(photos, () => acceptanceHTML({ ...t, photos, acc: { ...a, no: a.no || nextAccNo(pid) } })); };
    $p('#acSave').onclick = async () => {
      read();
      const left = a.items.filter(x => x.ok === null).length;
      if (left) return toast(`Còn ${left} mục chưa đánh giá Đạt / Không đạt`);
      if (!a.a || !a.b) return toast('Nhập tên đại diện hai bên');
      if (a.result === 'pass' && !photos.length) return toast('Cần ít nhất 1 ảnh hiện trường khi nghiệm thu đạt');
      if (a.result === 'fail' && !a.fix) { toast('Ghi nội dung yêu cầu sửa'); return $p('#acFixT').focus(); }
      if (a.result === 'fail' && t.done && !confirm('Không đạt: mốc này sẽ chuyển lại "chưa xong" cho tới khi sửa và nghiệm thu lại. Tiếp tục?')) return;
      const dueBefore = new Set(dueStages(pid).map(s => s.i));
      if (!a.no) a.no = nextAccNo(pid);
      (t.photos || []).filter(ph => !photos.includes(ph)).forEach(ph => DB.del('photos', ph));
      cleanup(true);
      t.photos = photos; t.acc = a;
      if (a.result === 'pass' && !t.done) { t.done = true; t.doneDate = a.date; }
      if (a.result === 'fail') { t.done = false; t.doneDate = ''; }
      S.settings.lastAccB = a.b;
      if ($p('#acDoc').checked) {
        await saveDocFile({ pid, type: 'Biên bản nghiệm thu', title: `Biên bản nghiệm thu – ${t.name}`, no: accCode(a.no), date: a.date, party: a.a, amount: 0,
          note: a.result === 'pass' ? 'Đạt' : 'Không đạt: ' + a.fix, html: acceptanceHTML(t, false), name: `Bien ban nghiem thu ${accCode(a.no)} - ${t.name}` });
      }
      commit(); tab = 'acc'; draw();
      const newDue = dueStages(pid).filter(s => !dueBefore.has(s.i));
      toast(a.result === 'pass' ? `Đã nghiệm thu đạt ${accCode(a.no)}${newDue.length ? ` · 💰 Đến hạn thu đợt ${newDue.map(s => s.i + 1).join(', ')}` : ''}` : `Đã lưu ${accCode(a.no)}: không đạt, chờ sửa`);
    };
  };

  // ---- Phiếu phát sinh ----
  const drawChanges = () => {
    const cs = changeSummary(pid);
    $p('#pgBody').innerHTML = tabsHTML() + `<div class="stats three">
        <div class="stat"><div class="k">Đã duyệt</div><div class="v ${cs.approved < 0 ? 'neg' : ''}">${cs.approved > 0 ? '+' : ''}${short(cs.approved)}</div></div>
        <div class="stat"><div class="k">Thêm thời gian</div><div class="v">${cs.days ? `${cs.days > 0 ? '+' : ''}${cs.days} ngày` : '0'}</div></div>
        <div class="stat"><div class="k">Chờ duyệt</div><div class="v ${cs.pending ? 'warn' : ''}">${cs.pending}</div></div></div>
      <p class="small muted mb">Mọi thay đổi so với hợp đồng phải lập phiếu, chủ nhà ký hoặc xác nhận qua Zalo trước khi thi công. Phiếu đã duyệt được cộng vào tiền cần thu.</p>
      ${cs.list.length ? cs.list.map(c => {
        const tot = changeTotal(c), st = CH_STATUS[c.status] || CH_STATUS.draft;
        return `<div class="pg-t tap ch-row" data-chg="${c.id}"><div class="grow" style="min-width:0"><div class="pg-nm"><b>${esc(c.no)}</b> · ${esc(c.title || '(chưa có nội dung)')}</div>
          <div class="small muted">${fdate(c.date)}${+c.days ? ` · ${+c.days > 0 ? '+' : ''}${c.days} ngày` : ''}${c.paid ? ` · ✓ đã thu ${fdate(c.paid.date)}` : ''}</div></div>
          <div class="r"><b class="num ${tot < 0 ? 'neg' : ''}">${tot > 0 ? '+' : ''}${fmt(tot)}</b><div class="mt">${badge(st)}</div></div>
          ${c.status === 'approved' && tot > 0 ? (c.paid ? `<button class="linkbtn" type="button" data-chunpaid="${c.id}">Bỏ</button>` : `<button class="btn sm primary" type="button" data-chpaid="${c.id}">Đã thu</button>`) : ''}</div>`;
      }).join('') : '<p class="muted">Chưa có phiếu phát sinh.</p>'}`;
    $p('#pgFoot').innerHTML = '<button class="btn primary" type="button" id="chAdd">+ Lập phiếu phát sinh</button>';
    $p('#chAdd').onclick = () => drawChange(null);
  };
  const setChangePaid = (id, on) => {
    const c = S.changes.find(x => x.id === id);
    if (!c) return;
    const tot = changeTotal(c);
    if (on) {
      if (!confirm(`Ghi nhận đã thu phát sinh ${c.no}: ${money(tot)}?\nKhoản thu sẽ được ghi vào mục Chi phí.`)) return;
      const costId = uid();
      S.costs.push({ id: costId, projectId: pid, date: today(), type: 'thu', cat: '', amount: tot, desc: `Thu phát sinh ${c.no} – ${c.title || ''}`.trim(), vendor: '' });
      c.paid = { date: today(), costId }; toast(`Đã ghi khoản thu ${money(tot)}`);
    } else {
      if (!confirm(`Bỏ đánh dấu đã thu ${c.no}? Khoản thu đã ghi trong Chi phí cũng bị xóa.`)) return;
      S.costs = S.costs.filter(x => x.id !== c.paid.costId); delete c.paid;
    }
    commit(); draw();
  };
  const drawChange = id => {
    const orig = id ? S.changes.find(c => c.id === id) : null;
    const c = orig ? JSON.parse(JSON.stringify(orig)) : { id: uid(), projectId: pid, no: nextChangeNo(pid), date: today(), sign: 'add', title: '', reason: CH_REASONS[0], items: [{ name: '', unit: '', qty: '', price: 0 }], days: 0, status: 'draft', note: '', photos: [] };
    const q = contractFor(pid) || S.quotes.find(x => x.projectId === pid);
    const lib = q ? q.items.filter(i => !i.head && i.name) : [];
    const added = [];
    const drawItems = () => {
      $p('#chItems').innerHTML = c.items.map((x, i) => `<div class="ch-it" data-i="${i}">
          <input data-k="name" list="chLib" value="${esc(x.name)}" placeholder="Nội dung công việc" aria-label="Nội dung dòng ${i + 1}">
          <input data-k="unit" value="${esc(x.unit || '')}" placeholder="ĐVT" aria-label="Đơn vị tính">
          <input data-k="qty" inputmode="decimal" class="right" value="${esc(String(x.qty ?? ''))}" placeholder="KL" aria-label="Khối lượng">
          <input data-k="price" data-money inputmode="numeric" class="right" value="${+x.price ? fmt(x.price) : ''}" placeholder="Đơn giá" aria-label="Đơn giá">
          <b class="num right" data-line>${fmt(Math.round(dec(x.qty) * (+x.price || 0)))}</b>
          <button type="button" class="del" data-rm="${i}" aria-label="Xóa dòng">×</button></div>`).join('');
      sum();
    };
    const sum = () => { const t = changeTotal(c); $p('#chSum').innerHTML = `Tổng ${c.sign === 'sub' ? 'giảm trừ' : 'phát sinh'}: <b class="${t < 0 ? 'neg' : ''}">${t > 0 ? '+' : ''}${money(t)}</b>`; };
    const drawPh = () => { $p('#chPh').innerHTML = c.photos.map(ph => `<div class="ph"><img data-ph="${ph}" data-act="viewPhoto" alt="Ảnh"><button type="button" data-rmph="${ph}" aria-label="Bỏ ảnh">×</button></div>`).join(''); hydratePhotos($p('#chPh')); };
    $p('#pgBody').innerHTML = `<div class="fields">
        <div><label for="chNo">Số phiếu</label><input id="chNo" value="${esc(c.no)}"></div>
        <div><label for="chDate">Ngày lập</label><input type="date" id="chDate" value="${esc(c.date)}"></div>
        <div><label for="chSign">Loại</label><select id="chSign"><option value="add"${c.sign !== 'sub' ? ' selected' : ''}>Phát sinh tăng</option><option value="sub"${c.sign === 'sub' ? ' selected' : ''}>Giảm trừ</option></select></div>
        <div><label for="chSt">Trạng thái</label><select id="chSt">${Object.entries(CH_STATUS).map(([k, v]) => `<option value="${k}"${c.status === k ? ' selected' : ''}>${v[0]}</option>`).join('')}</select></div>
        <div class="full"><label for="chTitle">Nội dung phát sinh</label><input id="chTitle" value="${esc(c.title)}" placeholder="VD: Nâng nền tầng trệt thêm 20 cm"></div>
        <div class="full"><label for="chReason">Lý do</label><input id="chReason" list="chRs" value="${esc(c.reason)}"><datalist id="chRs">${CH_REASONS.map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>
      </div>
      <div class="mt"><b>Khối lượng – đơn giá</b></div>${lib.length ? '<p class="small muted mb">Gõ tên để chọn hạng mục từ báo giá hợp đồng (tự điền ĐVT, đơn giá).</p>' : '<div class="mb"></div>'}
      <datalist id="chLib">${lib.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>
      <div id="chItems"></div><button class="linkbtn" type="button" id="chAddIt">+ Thêm dòng</button>
      <p class="mt" id="chSum"></p>
      <div class="fields mt">
        <div><label for="chDays">Ảnh hưởng tiến độ (ngày)</label><input id="chDays" inputmode="numeric" value="${+c.days || ''}" placeholder="0"></div><div></div>
        <div class="full"><label for="chNote">Ghi chú</label><textarea id="chNote" rows="2">${esc(c.note || '')}</textarea></div>
        <div class="full"><label>Ảnh hiện trạng / bản vẽ thay đổi</label><div class="thumbs" id="chPh"></div><div class="mt"><button type="button" class="btn sm" id="chAddPh">📷 Thêm ảnh</button></div></div>
        <div class="full btns"><button class="btn sm" type="button" id="chDoc">📁 Lưu phiếu vào Hồ sơ (Word)</button>${orig ? '<button class="btn sm danger" type="button" id="chDel">Xóa phiếu</button>' : ''}</div>
      </div>`;
    drawItems(); drawPh();
    $p('#pgBody').oninput = e => {
      const r = e.target.closest('.ch-it');
      if (r) {
        const x = c.items[+r.dataset.i], k = e.target.dataset.k;
        x[k] = k === 'price' ? num(e.target.value) : e.target.value;
        if (k === 'name') { const m = lib.find(i => i.name === x.name); if (m) { x.unit = m.unit || ''; x.price = +m.price || 0; $('[data-k=unit]', r).value = x.unit; $('[data-k=price]', r).value = x.price ? fmt(x.price) : ''; } }
        $('[data-line]', r).textContent = fmt(Math.round(dec(x.qty) * (+x.price || 0)));
        sum();
      } else if (e.target.id === 'chSign') { c.sign = e.target.value; sum(); }
    };
    $p('#pgBody').onclick = async e => {
      const b = e.target.closest('[data-rm],[data-rmph],#chAddIt,#chAddPh');
      if (!b) return;
      if (b.id === 'chAddIt') { c.items.push({ name: '', unit: '', qty: '', price: 0 }); drawItems(); $p(`.ch-it[data-i="${c.items.length - 1}"] input`).focus(); }
      else if (b.id === 'chAddPh') { const ids = await pickPhotos(true); added.push(...ids); c.photos.push(...ids); drawPh(); }
      else if (b.dataset.rmph) { c.photos = c.photos.filter(x => x !== b.dataset.rmph); drawPh(); }
      else { c.items.splice(+b.dataset.rm, 1); if (!c.items.length) c.items.push({ name: '', unit: '', qty: '', price: 0 }); drawItems(); }
    };
    const read = () => Object.assign(c, { no: $p('#chNo').value.trim() || nextChangeNo(pid), date: $p('#chDate').value || today(), sign: $p('#chSign').value, status: $p('#chSt').value, title: $p('#chTitle').value.trim(), reason: $p('#chReason').value.trim(), days: Math.round(dec($p('#chDays').value)), note: $p('#chNote').value.trim() });
    const cleanup = keep => added.filter(ph => !keep || !c.photos.includes(ph)).forEach(ph => DB.del('photos', ph));
    $p('#pgFoot').innerHTML = `<button class="btn" type="button" id="chBack">← Phát sinh</button><button class="btn" type="button" id="chPrint">🖨 In phiếu</button><button class="btn primary" type="button" id="chSave">Lưu phiếu</button>`;
    $p('#chBack').onclick = () => { cleanup(false); draw(); };
    $p('#chPrint').onclick = () => { read(); printWithPhotos(c.photos, () => changeHTML(c)); };
    if (orig) $p('#chDel').onclick = () => {
      if (!confirm(`Xóa phiếu ${orig.no}?${orig.paid ? ' Khoản thu đã ghi trong Chi phí cũng bị xóa.' : ''}`)) return;
      cleanup(false); (orig.photos || []).forEach(ph => DB.del('photos', ph));
      if (orig.paid) S.costs = S.costs.filter(x => x.id !== orig.paid.costId);
      S.changes = S.changes.filter(x => x.id !== orig.id); commit(); toast('Đã xóa phiếu'); draw();
    };
    const store = () => {
      read();
      c.items = c.items.filter(x => (x.name || '').trim() || +x.price || dec(x.qty));
      if (!c.title) { toast('Nhập nội dung phát sinh'); $p('#chTitle').focus(); return false; }
      if (!c.items.length) { c.items.push({ name: '', unit: '', qty: '', price: 0 }); drawItems(); toast('Nhập ít nhất một dòng khối lượng'); return false; }
      if (S.changes.some(x => x.id !== c.id && x.projectId === pid && x.no === c.no)) { toast(`Số phiếu ${c.no} đã có`); return false; }
      const wasApproved = orig && orig.status === 'approved';
      if (c.status === 'approved' && !wasApproved) c.approvedDate = today();
      if (c.status !== 'approved' && c.paid) { S.costs = S.costs.filter(x => x.id !== c.paid.costId); delete c.paid; }
      (orig ? orig.photos || [] : []).filter(ph => !c.photos.includes(ph)).forEach(ph => DB.del('photos', ph));
      cleanup(true);
      // Duyệt phiếu có ảnh hưởng tiến độ: hỏi dời các mốc chưa xong
      const shift = c.status === 'approved' && !wasApproved && +c.days && tasksOf(pid).some(t => !t.done)
        && confirm(`Phiếu được duyệt ${c.days > 0 ? 'thêm' : 'bớt'} ${Math.abs(c.days)} ngày. Dời các mốc tiến độ chưa xong ${c.days > 0 ? 'lùi' : 'sớm'} ${Math.abs(c.days)} ngày?`);
      if (shift) { tasksOf(pid).filter(t => !t.done).forEach(t => { t.start = addDays(t.start, c.days); }); c.shifted = true; }
      if (orig) Object.assign(orig, c); else S.changes.push(c);
      commit(); return true;
    };
    $p('#chSave').onclick = () => { if (store()) { toast(`Đã lưu phiếu ${c.no}`); draw(); } };
    $p('#chDoc').onclick = async () => {
      if (!store()) return;
      const t = changeTotal(c);
      if (await saveDocFile({ pid, type: 'Phiếu phát sinh', title: `Phiếu ${c.sign === 'sub' ? 'giảm trừ' : 'phát sinh'} ${c.no} – ${c.title}`, no: c.no, date: c.date, party: proj(pid).client || '', amount: t, note: CH_STATUS[c.status][0], html: changeHTML(c, false), name: `Phieu phat sinh ${c.no} - ${pname(pid)}` })) toast('Đã lưu phiếu vào Hồ sơ dự án');
      draw();
    };
    if (!orig) $p('#chTitle').focus();
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
        ${orig ? `<div class="full card row between wrap" style="gap:8px"><span class="small">📋 Nghiệm thu: ${ACC_BADGE(orig) || '<span class="muted">không bắt buộc</span>'}${orig.acc ? ` · ${accCode(orig.acc.no)}` : ''}</span><button type="button" class="btn sm" data-acc="${orig.id}">${orig.acc ? 'Xem / in biên bản' : 'Nghiệm thu mốc này'}</button></div>` : ''}
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

  const draw = () => {
    const b = $p('#pgBody'); b.onchange = b.oninput = b.onclick = null;
    if (tab === 'acc') return drawAccList();
    if (tab === 'chg') return drawChanges();
    const list = tasksOf(pid); if (list.length) drawPlan(list); else drawSetup();
  };
  // Đã thu / bỏ đã thu: ghi hoặc xóa khoản thu bên Chi phí
  const setPaid = (i, on) => {
    const ps = payStages(pid), s = ps && ps.stages[i], x = ps && ps.q.ct.pay[i];
    if (!s) return;
    if (on) {
      if (!confirm(`Ghi nhận đã thu đợt ${i + 1}: ${money(s.amount)}?\nKhoản thu sẽ được ghi vào mục Chi phí.`)) return;
      const costId = uid();
      S.costs.push({ id: costId, projectId: pid, date: today(), type: 'thu', cat: '', amount: s.amount, desc: `Thu đợt ${i + 1} (${fmt(s.pct)}%) – ${s.label}`, vendor: '' });
      x.paid = { date: today(), costId };
      commit(); toast(`Đã ghi khoản thu ${money(s.amount)}`);
    } else {
      if (!confirm(`Bỏ đánh dấu đã thu đợt ${i + 1}? Khoản thu đã ghi trong Chi phí cũng bị xóa.`)) return;
      S.costs = S.costs.filter(c => c.id !== x.paid.costId);
      delete x.paid;
      commit();
    }
    draw();
  };
  el.addEventListener('change', e => {
    const i = e.target.dataset.plink;
    if (i === undefined) return;
    const q = contractFor(pid);
    if (e.target.value) q.ct.pay[+i].link = e.target.value; else delete q.ct.pay[+i].link;
    commit(); draw();
  });
  // Gợi ý khi rê chuột lên biểu đồ
  const tip = document.createElement('div');
  tip.className = 'gt-tip'; tip.hidden = true; el.appendChild(tip);
  el.addEventListener('mousemove', e => {
    const r = e.target.closest('[data-tip]');
    if (!r) { tip.hidden = true; return; }
    tip.textContent = r.dataset.tip; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 16 + h > innerHeight ? e.clientY - h - 10 : e.clientY + 16) + 'px';
  });
  el.addEventListener('mouseleave', () => { tip.hidden = true; });
  el.addEventListener('click', e => {
    const x = e.target.closest('[data-pf],[data-gt],[data-done],[data-gdone],[data-edit],[data-view],[data-paid],[data-unpaid],[data-pdet],[data-tab],[data-acc],[data-chg],[data-chpaid],[data-chunpaid],[data-gotab]');
    if (!x) return;
    if (x.dataset.tab || x.dataset.gotab) { tab = x.dataset.tab || x.dataset.gotab; tip.hidden = true; draw(); $p('#pgBody').scrollTop = 0; return; }
    if (x.dataset.chpaid) return setChangePaid(x.dataset.chpaid, true);
    if (x.dataset.chunpaid) return setChangePaid(x.dataset.chunpaid, false);
    if (x.dataset.acc) return drawAcc(x.dataset.acc);
    if (x.dataset.chg) return drawChange(x.dataset.chg);
    if (x.dataset.pdet !== undefined) { payOpen = !x.parentElement.open; return; }
    if (x.dataset.view) { S.ui.pgView = x.dataset.view; save(); tip.hidden = true; draw(); return; }
    if (x.dataset.paid !== undefined) return setPaid(+x.dataset.paid, true);
    if (x.dataset.unpaid !== undefined) return setPaid(+x.dataset.unpaid, false);
    if (x.dataset.pf) { filter = x.dataset.pf; draw(); }
    else if (x.dataset.gt !== undefined) { const g = x.dataset.gt; openGroups.has(g) ? openGroups.delete(g) : openGroups.add(g); draw(); }
    else if (x.dataset.gdone !== undefined) markDone(tasksOf(pid).filter(t => t.group === x.dataset.gdone && !t.done).map(t => t.id));
    else if (x.dataset.done) {
      const t = S.tasks.find(y => y.id === x.dataset.done);
      if (!t) return;
      if (t.done) { if (confirm('Bỏ đánh dấu xong mốc này? (Ảnh vẫn được giữ)')) { t.done = false; t.doneDate = ''; commit(); draw(); } }
      else markDone([t.id]);
    } else if (x.dataset.edit) { tip.hidden = true; drawEdit(x.dataset.edit); }
  });
  draw();
}
