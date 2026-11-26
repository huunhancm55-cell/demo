'use strict';
/* Trang chủ nhà xem tiến độ: chỉ đọc bản chụp data.json trong kho công khai, không có số tiền, không đăng nhập. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fdate = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const ddmm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
  const params = new URLSearchParams(location.hash.slice(1).replace(/^([a-z0-9]+)(&|$)/, 'k=$1$2'));
  const token = params.get('k') || '';
  // Máy chủ: theo cấu hình của app; chỉ nhận máy chủ khác nếu là Supabase hoặc máy thử nghiệm
  let server = ((window.QLXD_CONFIG || {}).supabaseUrl || '').replace(/\/+$/, '');
  const alt = params.get('s') || '';
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(alt) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(alt)) server = alt;
  const base = `${server}/storage/v1/object/public/share/${token}/`;
  const img = id => `${base}${encodeURIComponent(id)}.jpg`;
  const ST = { done: ['Đã xong', 'green'], doing: ['Đang làm', 'orange'], late: ['Đang trễ', 'red'], todo: ['Sắp tới', ''] };
  const ACC = { pass: ['Đã nghiệm thu', 'green'], fail: ['Nghiệm thu chưa đạt – đang sửa', 'red'], wait: ['Chờ nghiệm thu', 'orange'] };
  const badge = ([t, c]) => `<span class="badge ${c}">${t}</span>`;
  const thumbs = (ids, cls = 'xv-ths') => (ids && ids.length ? `<div class="${cls}">${ids.map(id => `<img loading="lazy" src="${img(id)}" alt="Ảnh công trình" data-full>`).join('')}</div>` : '');

  function render(d) {
    const s = d.stats, p = d.project, w = d.week || {};
    document.title = `${p.name} – Tiến độ`;
    const groups = [];
    for (const t of d.tasks) { let g = groups.find(x => x.name === t.g); if (!g) groups.push(g = { name: t.g, items: [] }); g.items.push(t); }
    const cur = groups.find(g => g.items.some(t => t.st !== 'done'));
    $('#xv').innerHTML = `<div class="xv-top"><img src="logo.png" alt="Hữu Nhân"><div><div class="co">${esc(d.company.name)}</div>${d.company.phone ? `<div class="ph">Hotline/Zalo: <a href="tel:${esc(d.company.phone.replace(/\s/g, ''))}">${esc(d.company.phone)}</a></div>` : ''}</div></div>
      ${p.cover ? `<img class="xv-cover" src="${img(p.cover)}" alt="Phối cảnh công trình" data-full>` : ''}
      <h1>${esc(p.name)}</h1><p class="small muted">${esc(p.address)}${p.start ? ` · Khởi công ${fdate(p.start)}` : ''}</p>
      <div class="card mt"><div class="row between wrap" style="gap:8px"><div><div class="small muted">Đã hoàn thành</div><div class="xv-pct">${s.pct}%</div></div>
        ${s.late ? badge([`Trễ ${s.lateDays} ngày`, 'red']) : badge(['Đúng tiến độ', 'green'])}</div>
        <div class="bar xv-bar"><i class="ok" style="width:${s.pct}%"></i></div>
        <div class="xv-kv"><div><small>Mốc đã xong</small><b>${s.done}/${s.total}</b></div><div><small>Dự kiến bàn giao</small><b>${fdate(s.finish) || '—'}</b></div><div><small>Đang thi công</small><b>${esc(cur ? cur.name : 'Đã hoàn thành')}</b></div></div></div>
      ${w.from ? `<h2>Tuần này (${ddmm(w.from)} – ${ddmm(w.to)})</h2><div class="card">
        ${w.done.length ? `<div class="bold small">Đã xong</div><ul class="small">${w.done.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="small muted">Chưa có mốc nào hoàn thành trong tuần.</p>'}
        ${w.next.length ? `<div class="bold small mt">Sắp làm</div><ul class="small">${w.next.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      ${d.photos.length ? `<h2>Hình ảnh mới nhất</h2>${thumbs(d.photos.filter(id => id !== p.cover).slice(0, 12), 'xv-gal')}` : ''}
      <h2>Các giai đoạn thi công</h2>
      ${groups.map(g => {
        const done = g.items.filter(t => t.st === 'done').length, late = g.items.some(t => t.st === 'late');
        const st = done === g.items.length ? 'done' : late ? 'late' : g.items.some(t => t.st !== 'todo') ? 'doing' : 'todo';
        return `<details class="xv-g"${g === cur ? ' open' : ''}><summary><span class="dot ${st}"></span><span class="grow">${esc(g.name)}</span><span class="small muted">${done}/${g.items.length} · ${ddmm(g.items[0].s)}–${ddmm(g.items.reduce((m, t) => (t.e > m ? t.e : m), ''))}</span></summary>
          ${g.items.map(t => `<div class="xv-t"><div class="row"><span class="dot ${t.st}"></span><div class="grow"><div>${esc(t.n)}</div>
            <div class="small muted">${t.st === 'done' ? `Xong ${fdate(t.dd)}` : `Kế hoạch ${ddmm(t.s)} – ${ddmm(t.e)}`}</div></div>
            <div style="text-align:right">${badge(ST[t.st] || ST.todo)}${ACC[t.acc] ? `<div class="mt">${badge(ACC[t.acc])}</div>` : ''}</div></div>${thumbs(t.ph)}</div>`).join('')}</details>`;
      }).join('')}
      ${d.changes.length ? `<h2>Thay đổi / phát sinh</h2><div class="card">${d.changes.map(c => `<div class="row between small" style="padding:4px 0"><span><b>${esc(c.no)}</b> ${esc(c.title)}${c.days ? ` · ${c.days > 0 ? '+' : ''}${c.days} ngày` : ''}</span>${badge([esc(c.status), /duyệt$/.test(c.status) && !/Chờ|Không/.test(c.status) ? 'green' : /Chờ/.test(c.status) ? 'orange' : ''])}</div>`).join('')}</div>` : ''}
      ${d.logs.length ? `<h2>Nhật ký công trường</h2><div class="card">${d.logs.map(l => `<div class="xv-log"><div class="small"><b>${fdate(l.date)}</b>${l.weather ? ` · ${esc(l.weather)}` : ''}${l.workers ? ` · ${l.workers} người` : ''}</div><div class="xv-pre small mt">${esc(l.content)}</div>${thumbs(l.ph)}</div>`).join('')}</div>` : ''}
      <p class="xv-foot">Cập nhật lúc ${new Date(d.updated).toLocaleString('vi-VN')}<br>Trang chỉ để xem, do ${esc(d.company.name || 'nhà thầu')} gửi.</p>`;
  }
  function fail(msg) { $('#xv').innerHTML = `<div class="card"><b>Không mở được trang tiến độ</b><p class="small muted mt">${msg}</p></div>`; }

  document.addEventListener('click', e => {
    const im = e.target.closest('img[data-full]');
    if (im) { $('#lb img').src = im.src; $('#lb').hidden = false; }
    else if (e.target.closest('#lb')) $('#lb').hidden = true;
  });
  if (!/^[a-z0-9]{12,}$/.test(token) || !server) return fail('Link không đúng. Vui lòng hỏi lại nhà thầu link mới.');
  fetch(base + 'data.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(() => fail('Link đã tắt hoặc chưa có dữ liệu. Vui lòng liên hệ nhà thầu.'));
})();
