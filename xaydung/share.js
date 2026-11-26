'use strict';
/* Tiến độ đợt 4: báo cáo tuần cho chủ nhà và link chỉ xem (tiến độ + ảnh, không có tiền).
   Link = một bản chụp dữ liệu (data.json + ảnh thu nhỏ) đặt trong kho công khai "share" của Supabase,
   ở thư mục có mã ngẫu nhiên khó đoán. Tắt link thì xóa thư mục đó. */

// % hoàn thành tính theo số ngày công của các mốc đã xong tới ngày d
function pctAt(list, d) {
  const total = list.reduce((a, t) => a + taskDays(t), 0);
  const done = list.filter(t => t.done && t.doneDate && t.doneDate <= d).reduce((a, t) => a + taskDays(t), 0);
  return total ? Math.round(done / total * 100) : 0;
}
const weekStartOf = iso => { const d = toDate(iso), wd = (d.getDay() + 6) % 7; return addDays(iso, -wd); };

// Số liệu một tuần (thứ Hai → Chủ nhật)
function weekReport(pid, from) {
  const p = proj(pid) || {}, list = tasksOf(pid), to = addDays(from, 6), td = today(), ref = to < td ? to : td;
  const inWeek = d => d && d >= from && d <= to;
  const st = planStats(list);
  const done = list.filter(t => t.done && inWeek(t.doneDate));
  const doing = list.filter(t => !t.done && t.start <= ref);
  const nextFrom = addDays(to, 1), nextTo = addDays(to, 7);
  const next = list.filter(t => !t.done && !(t.start <= ref) && t.start <= nextTo);
  const accs = list.filter(t => t.acc && inWeek(t.acc.date));
  const changes = (S.changes || []).filter(c => c.projectId === pid && c.status !== 'draft' && (inWeek(c.date) || inWeek(c.approvedDate)));
  const logs = S.logs.filter(l => l.projectId === pid && inWeek(l.date)).sort((a, b) => a.date.localeCompare(b.date));
  const photos = [...done.flatMap(t => t.photos || []), ...logs.flatMap(l => l.photos || [])];
  const late = doing.filter(t => taskEnd(t) < ref);
  return {
    p, from, to, nextFrom, nextTo, total: list.length,
    pctStart: pctAt(list, addDays(from, -1)), pctEnd: pctAt(list, to), finish: st.finish,
    late, lateDays: late.reduce((m, t) => Math.max(m, diffDays(ref, taskEnd(t))), 0),
    done, doing, next, accs, changes, logs, photos: [...new Set(photos)],
  };
}

const WR_H = (n, x) => `<h2><i>${n}</i>${x}</h2>`;
function weekReportHTML(r, withPhotos = true) {
  const s = S.settings, delta = r.pctEnd - r.pctStart;
  const li = a => `<ul>${a.join('')}</ul>`;
  const tline = t => `<li><b>${esc(t.name)}</b> <span class="mu">· ${esc(t.group)}</span></li>`;
  let n = 0, h = `<div class="wr">${HN_LOGO}<h1>BÁO CÁO TIẾN ĐỘ TUẦN</h1><div class="sub">${esc(r.p.name || '')}${r.p.address ? ' · ' + esc(r.p.address) : ''}</div><div class="sub no">Tuần ${fdate(r.from)} – ${fdate(r.to)}</div>`;
  h += `<div class="wr-stats"><div><small>Hoàn thành</small><b>${r.pctEnd}%</b><span>${delta > 0 ? `+${delta}% trong tuần` : 'không đổi trong tuần'}</span></div>
    <div><small>Dự kiến bàn giao</small><b>${fdate(r.finish) || '—'}</b><span>${r.total} mốc công việc</span></div>
    <div><small>Tình trạng</small><b class="${r.late.length ? 'bad' : 'good'}">${r.late.length ? `Trễ ${r.lateDays} ngày` : 'Đúng tiến độ'}</b><span>${r.late.length ? `${r.late.length} mốc quá hạn` : 'không có mốc quá hạn'}</span></div></div>
    <div class="wr-bar"><i style="width:${r.pctEnd}%"></i></div>`;
  h += WR_H(++n, 'ĐÃ HOÀN THÀNH TRONG TUẦN') + (r.done.length ? li(r.done.map(t => `<li>✓ <b>${esc(t.name)}</b> <span class="mu">· xong ${ddmm(t.doneDate)}${t.acc && t.acc.result === 'pass' ? ' · đã nghiệm thu' : ''}</span></li>`)) : '<p class="mu">Chưa có mốc nào hoàn thành trong tuần.</p>');
  if (r.doing.length) h += WR_H(++n, 'ĐANG THI CÔNG') + li(r.doing.map(t => `<li><b>${esc(t.name)}</b> <span class="mu">· ${ddmm(t.start)}–${ddmm(taskEnd(t))}</span>${taskEnd(t) < (r.to < today() ? r.to : today()) ? ' <span class="bad">⚠ trễ</span>' : ''}</li>`));
  h += WR_H(++n, `KẾ HOẠCH TUẦN TỚI (${ddmm(r.nextFrom)} – ${ddmm(r.nextTo)})`) + (r.next.length ? li(r.next.map(tline)) : '<p class="mu">Tiếp tục các công việc đang thi công.</p>');
  if (r.accs.length) h += WR_H(++n, 'NGHIỆM THU') + li(r.accs.map(t => `<li>${t.acc.result === 'pass' ? '✓' : '✗'} ${accCode(t.acc.no)} – <b>${esc(t.name)}</b> <span class="mu">· ${fdate(t.acc.date)} · ${t.acc.result === 'pass' ? 'Đạt' : 'Không đạt, yêu cầu sửa: ' + esc(t.acc.fix || '')}</span></li>`));
  if (r.changes.length) h += WR_H(++n, 'THAY ĐỔI / PHÁT SINH') + li(r.changes.map(c => `<li>${esc(c.no)} – <b>${esc(c.title || '')}</b> <span class="mu">· ${(CH_STATUS[c.status] || CH_STATUS.draft)[0]}${+c.days ? ` · ${c.days > 0 ? '+' : ''}${c.days} ngày` : ''}</span></li>`));
  if (r.logs.length) h += WR_H(++n, 'NHẬT KÝ CÔNG TRƯỜNG') + `<table class="t"><tr><th>Ngày</th><th>Thời tiết</th><th>Nội dung</th></tr>${r.logs.map(l => `<tr><td class="nw">${ddmm(l.date)}</td><td class="nw">${esc(l.weather || '')}${+l.workers ? `<br><span class="mu">${fmt(l.workers)} người</span>` : ''}</td><td class="pre">${esc(l.content || '')}</td></tr>`).join('')}</table>`;
  const ph = withPhotos ? r.photos.slice(-9).map(id => photoCache.get(id)).filter(Boolean) : [];
  if (ph.length) h += WR_H(++n, 'HÌNH ẢNH TRONG TUẦN') + `<div class="wr-ph">${ph.map(src => `<img src="${src}" alt="">`).join('')}</div>`;
  h += `<div class="foot"><div><small>Hotline/Zalo</small><div class="ph">${esc(s.phone || '')}</div></div><div class="ad">${esc(s.company || '')}<br><span>${esc(s.address || '')}</span></div></div></div>`;
  return h;
}
// Tin nhắn gửi chủ nhà qua Zalo
function weekReportText(r, link) {
  const L = [`📊 BÁO CÁO TIẾN ĐỘ TUẦN ${ddmm(r.from)} – ${fdate(r.to)}`, `🏠 ${r.p.name || ''}`, '',
    `✅ Hoàn thành: ${r.pctEnd}%${r.pctEnd > r.pctStart ? ` (+${r.pctEnd - r.pctStart}% trong tuần)` : ''}`,
    `🗓 Dự kiến bàn giao: ${fdate(r.finish) || '—'}`, r.late.length ? `⚠️ Đang trễ ${r.lateDays} ngày (${r.late.length} mốc)` : '👍 Đúng tiến độ'];
  const sec = (title, a) => { if (a.length) L.push('', title, ...a.map(x => '• ' + x)); };
  sec('Đã xong trong tuần:', r.done.map(t => `${t.name} (${ddmm(t.doneDate)})${t.acc && t.acc.result === 'pass' ? ' – đã nghiệm thu' : ''}`));
  sec('Đang thi công:', r.doing.map(t => t.name));
  sec(`Tuần tới (${ddmm(r.nextFrom)} – ${ddmm(r.nextTo)}):`, r.next.map(t => t.name));
  sec('Phát sinh:', r.changes.map(c => `${c.no} ${c.title || ''} – ${(CH_STATUS[c.status] || CH_STATUS.draft)[0]}`));
  if (link) L.push('', '📷 Xem ảnh và tiến độ chi tiết:', link);
  if (S.settings.company) L.push('', S.settings.company + (S.settings.phone ? ' – ' + S.settings.phone : ''));
  return L.join('\n');
}

// ---------- Link cho chủ nhà ----------
const shareToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
function shareLink(p) {
  if (!p.share || !p.share.on) return '';
  const base = new URL('xem.html', location.href).href.split('#')[0];
  const conf = (window.QLXD_CONFIG || {}).supabaseUrl || '', url = Sync.publicUrl('').replace(/\/storage\/v1\/object\/public\/share\/$/, '');
  return `${base}#${p.share.token}${url && url.replace(/\/+$/, '') !== conf.replace(/\/+$/, '') ? '&s=' + encodeURIComponent(url) : ''}`;
}
// Bản chụp chỉ gồm tiến độ, nghiệm thu, nhật ký, ảnh — không có số tiền
function shareSnapshot(pid) {
  const p = proj(pid), list = tasksOf(pid), st = planStats(list), td = today(), s = S.settings;
  const logs = S.logs.filter(l => l.projectId === pid).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  // Ảnh: mới nhất trước, tối đa 80 ảnh
  const dated = [...list.flatMap(t => (t.photos || []).map(id => [t.doneDate || t.start, id])), ...logs.flatMap(l => (l.photos || []).map(id => [l.date, id])), ...(p.photos || []).slice(0, 1).map(id => ['9999', id])];
  const photos = [...new Set(dated.sort((a, b) => b[0].localeCompare(a[0])).map(x => x[1]))].slice(0, 80);
  const keep = new Set(photos), ph = a => (a || []).filter(id => keep.has(id));
  const wk = weekReport(pid, weekStartOf(td));
  return {
    v: 1, company: { name: s.company || '', phone: s.phone || '' },
    project: { name: p.name, address: p.address || '', client: p.client || '', start: p.start || (list[0] && list[0].start) || '', cover: ph((p.photos || []).slice(0, 1))[0] || '' },
    stats: { pct: st.pct, done: st.done, total: list.length, late: st.late, lateDays: st.lateDays, finish: st.finish, today: td },
    week: { from: wk.from, to: wk.to, pctStart: wk.pctStart, done: wk.done.map(t => t.name), next: wk.next.map(t => t.name) },
    tasks: list.map(t => ({ g: t.group, n: t.name, s: t.start, e: taskEnd(t), d: taskDays(t), st: taskState(t, td), dd: t.doneDate || '', acc: accState(t), accDate: t.acc ? t.acc.date : '', ph: ph(t.photos) })),
    logs: logs.map(l => ({ date: l.date, weather: l.weather || '', workers: +l.workers || 0, content: l.content || '', ph: ph(l.photos) })),
    changes: (S.changes || []).filter(c => c.projectId === pid && c.status !== 'draft').map(c => ({ no: c.no, title: c.title || '', status: (CH_STATUS[c.status] || CH_STATUS.draft)[0], days: +c.days || 0, date: c.date })),
    photos,
  };
}
// Ảnh gửi lên link: thu nhỏ còn cạnh dài 1280px
async function shareImage(id) {
  const src = await getPhoto(id);
  if (!src) return null;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.75));
}
const Share = (() => {
  let timer = 0, busy = false;
  const hashOf = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
  async function publish(pid, force) {
    const p = proj(pid);
    if (!p || !p.share || !p.share.on) return false;
    if (!window.Sync || !Sync.signedIn()) throw new Error('Cần đăng nhập đồng bộ (Cài đặt) để cập nhật link');
    const snap = shareSnapshot(pid), body = JSON.stringify(snap), hash = hashOf(body.replace(/"today":"[^"]*"/, ''));
    if (!force && p.share.hash === hash) return false;
    const dir = p.share.token + '/', sent = new Set(p.share.sent || []);
    for (const id of snap.photos) {
      if (sent.has(id)) continue;
      const blob = await shareImage(id);
      if (blob) { await Sync.shareUpload(dir + id + '.jpg', blob, 'image/jpeg'); sent.add(id); }
    }
    await Sync.shareUpload(dir + 'data.json', new Blob([JSON.stringify({ ...snap, updated: new Date().toISOString() })], { type: 'application/json' }), 'application/json');
    // Ảnh không còn trong bản chụp thì xóa khỏi link
    const gone = [...sent].filter(id => !snap.photos.includes(id));
    if (gone.length) { await Sync.shareRemove(gone.map(id => dir + id + '.jpg')).catch(() => {}); gone.forEach(id => sent.delete(id)); }
    Object.assign(p.share, { hash, sent: [...sent], at: new Date().toISOString() });
    save();
    return true;
  }
  async function enable(pid) {
    const p = proj(pid);
    p.share = { on: true, token: (p.share && p.share.token) || shareToken(), sent: [], hash: '' };
    try { await publish(pid, true); return true; }
    catch (e) { p.share.on = false; save(); throw e; }
  }
  async function disable(pid) {
    const p = proj(pid);
    if (!p.share) return;
    const dir = p.share.token + '/';
    await Sync.shareRemove([dir + 'data.json', ...(p.share.sent || []).map(id => dir + id + '.jpg')]);
    p.share = { on: false };
    save();
  }
  // Tự cập nhật link khi dữ liệu thay đổi (chờ 20 giây sau lần sửa cuối)
  function touch() {
    if (!window.Sync || !Sync.signedIn() || !S.projects.some(p => p.share && p.share.on)) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (busy) return touch();
      busy = true;
      for (const p of S.projects.filter(x => x.share && x.share.on)) await publish(p.id).catch(() => {});
      busy = false;
    }, 20000);
  }
  return { publish, enable, disable, touch };
})();
window.Share = Share;
