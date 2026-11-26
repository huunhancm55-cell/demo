'use strict';
/* Tiến độ đợt 3: nghiệm thu công việc (bảng kiểm + biên bản) và phiếu phát sinh.
   Nghiệm thu lưu ngay trong mốc tiến độ (t.acc); phiếu phát sinh là loại bản ghi riêng (S.changes) để đồng bộ. */

// Bảng kiểm theo loại công việc (mốc có t.chk do mẫu tiến độ gắn sẵn)
const CHECKLISTS = {
  coc: ['Vị trí, số lượng cọc đúng bản vẽ định vị', 'Chủng loại, kích thước cọc đúng thiết kế', 'Lực ép dừng đạt yêu cầu (theo nhật ký ép cọc)', 'Độ nghiêng, cao độ đầu cọc trong giới hạn cho phép', 'Mối nối cọc hàn đủ, đúng quy cách'],
  daomong: ['Kích thước, cao độ đáy hố móng đúng thiết kế', 'Đáy móng phẳng, sạch, không đọng nước', 'Đất nền đúng như khảo sát / thiết kế', 'Vách hố đào ổn định, an toàn cho nhà lân cận'],
  thep: ['Chủng loại, đường kính, số lượng thép đúng bản vẽ', 'Khoảng cách thép chịu lực, thép đai đúng thiết kế', 'Chiều dài nối, neo thép đạt yêu cầu', 'Con kê đủ, bảo đảm lớp bê tông bảo vệ', 'Cốp pha kín khít, đúng kích thước, chống đỡ chắc chắn', 'Vệ sinh sạch cốp pha, cốt thép trước khi đổ bê tông'],
  diennuoc: ['Đường ống, dây điện đi đúng bản vẽ', 'Ống luồn dây, hộp nối đúng chủng loại', 'Thử áp lực ống cấp nước đạt, không rò rỉ', 'Ống thoát nước đủ độ dốc, thông suốt', 'Vị trí ổ cắm, công tắc, đầu chờ thiết bị đúng'],
  chongtham: ['Bề mặt sạch, cổ ống và góc tường được xử lý trước', 'Vật liệu chống thấm đúng chủng loại, đủ số lớp', 'Ngâm nước thử 48 giờ không thấm', 'Độ dốc thoát nước sàn đạt, không đọng nước'],
  thietbi: ['Thiết bị đúng chủng loại, mẫu mã đã chọn', 'Lắp đặt chắc chắn, thẳng, kín nước', 'Đèn, công tắc, ổ cắm hoạt động tốt', 'Chạy thử nước 2 giờ không rò rỉ, thoát nước tốt', 'Aptomat, chống giật hoạt động đúng'],
  khac: ['Đúng hồ sơ thiết kế về vị trí, kích thước', 'Đạt chất lượng, mỹ quan', 'Khu vực thi công được vệ sinh'],
};
const checklistFor = t => CHECKLISTS[t.chk] || CHECKLISTS.khac;

// Trạng thái nghiệm thu của một mốc: '' (không cần) · todo (chưa làm) · wait (xong, chờ nghiệm thu) · pass · fail
function accState(t) {
  if (t.acc) return t.acc.result === 'pass' ? 'pass' : 'fail';
  if (!t.chk) return '';
  return t.done ? 'wait' : 'todo';
}
const ACC_BADGE = t => {
  const s = accState(t);
  if (s === 'pass') return `<span class="badge green">Đã NT ${ddmm(t.acc.date)}</span>`;
  if (s === 'fail') return '<span class="badge red">NT không đạt</span>';
  if (s === 'wait') return '<span class="badge orange">Chờ nghiệm thu</span>';
  if (s === 'todo') return '<span class="badge blue">Nghiệm thu</span>';
  return '';
};
const accWaiting = pid => tasksOf(pid).filter(t => ['wait', 'fail'].includes(accState(t)));
const nextAccNo = pid => tasksOf(pid).reduce((m, t) => Math.max(m, +(t.acc && t.acc.no) || 0), 0) + 1;
const accCode = n => 'NT-' + pad(n);

function partyLines(p) {
  const s = S.settings, q = contractFor(p.id), b = q && q.ct && q.ct.bMode === 'person' ? q.ct.b || {} : null;
  return { aDef: p.client || (q && q.ct && q.ct.aName) || '', bDef: S.settings.lastAccB || (b ? b.name : s.rep) || '', company: b ? '' : s.company || '' };
}

// Biên bản nghiệm thu công việc xây dựng (mẫu chuẩn app soạn)
function acceptanceHTML(t, withPhotos = true) {
  const p = proj(t.projectId) || {}, a = t.acc || {}, q = contractFor(t.projectId), s = S.settings;
  const f = (v, w = '……………………') => (v != null && String(v).trim() !== '' ? esc(v) : w);
  const items = a.items || checklistFor(t).map(x => ({ t: x, ok: null }));
  const pass = a.result === 'pass';
  const photos = withPhotos ? (t.photos || []).slice(-6).map(id => photoCache.get(id)).filter(Boolean) : [];
  const { company } = partyLines(p);
  return `<p class="c"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><b><u>Độc lập – Tự do – Hạnh phúc</u></b></p>
<h1>BIÊN BẢN NGHIỆM THU CÔNG VIỆC XÂY DỰNG</h1><p class="c">Số: ${a.no ? accCode(a.no) : '……'}${p.name ? ' / ' + esc(p.name) : ''}</p>
<p><b>1. Công trình:</b> ${f(p.name)}</p>
<p><b>Địa điểm xây dựng:</b> ${f(p.address)}</p>
<p><b>2. Công việc được nghiệm thu:</b> ${esc(t.name)} <i>(${esc(t.group)})</i></p>
<p><b>3. Thành phần trực tiếp nghiệm thu:</b></p>
<ul><li>Đại diện Bên A (chủ đầu tư): Ông/Bà <b>${f(a.a)}</b></li><li>Đại diện Bên B (nhà thầu thi công${company ? ' – ' + esc(company) : ''}): Ông/Bà <b>${f(a.b)}</b></li></ul>
<p><b>4. Thời gian nghiệm thu:</b> ${a.date ? dateLong(a.date) : 'ngày …… tháng …… năm ……'}, tại công trình.</p>
<p><b>5. Đánh giá công việc đã thực hiện:</b></p>
<p>a) Căn cứ nghiệm thu: hồ sơ thiết kế đã được hai bên thống nhất${q && q.ct ? `; hợp đồng số ${f(q.ct.no)}` : ''}; tiêu chuẩn, quy chuẩn kỹ thuật hiện hành; nhật ký thi công và kết quả kiểm tra tại hiện trường.</p>
<p>b) Thời gian thi công: từ ${fdate(t.start)} đến ${t.doneDate ? fdate(t.doneDate) : '……'}.</p>
<p>c) Kết quả kiểm tra:</p>
<table><tr><th bgcolor="#eeeeee" style="background-color:#eeeeee" class="c">STT</th><th bgcolor="#eeeeee" style="background-color:#eeeeee">Nội dung kiểm tra</th><th bgcolor="#eeeeee" style="background-color:#eeeeee" class="c">Đạt</th><th bgcolor="#eeeeee" style="background-color:#eeeeee" class="c">Không đạt</th><th bgcolor="#eeeeee" style="background-color:#eeeeee">Ghi chú</th></tr>
${items.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.t)}</td><td class="c">${x.ok === true ? '✓' : ''}</td><td class="c">${x.ok === false ? '✗' : ''}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</table>
${a.note ? `<p>d) Ý kiến khác: ${esc(a.note)}</p>` : ''}
<p><b>6. Kết luận:</b> ${a.result ? (pass ? '<b>Chấp nhận nghiệm thu</b>, đồng ý cho triển khai công việc tiếp theo.' : `<b>Không chấp nhận nghiệm thu.</b> Bên B sửa chữa các nội dung không đạt${a.fix ? ': ' + esc(a.fix) : ''} và mời nghiệm thu lại${a.due ? ' trước ngày ' + fdate(a.due) : ''}.`) : 'Chấp nhận / không chấp nhận nghiệm thu (gạch phần không phù hợp).'}</p>
${photos.length ? `<p><b>Ảnh hiện trường kèm theo:</b></p><div class="pimgs">${photos.map(src => `<img src="${src}" alt="">`).join('')}</div>` : ''}
<table class="nb signs"><tr><td class="c"><b>ĐẠI DIỆN BÊN A</b><br><i>(Ký, ghi rõ họ tên)</i><br><br><br><br><br><b>${esc(a.a || '')}</b></td><td class="c"><b>ĐẠI DIỆN BÊN B</b><br><i>(Ký, ghi rõ họ tên)</i><br><br><br><br><br><b>${esc(a.b || '')}</b></td></tr></table>
<p class="small"><i>Biên bản lập thành 2 bản, mỗi bên giữ 1 bản. ${esc(s.company || '')}</i></p>`;
}

// ---------- Phiếu phát sinh ----------
const CH_STATUS = { draft: ['Nháp', ''], sent: ['Chờ chủ nhà duyệt', 'orange'], approved: ['Đã duyệt', 'green'], rejected: ['Không duyệt', 'red'] };
const CH_REASONS = ['Chủ nhà yêu cầu thay đổi', 'Thay đổi thiết kế', 'Phát sinh do điều kiện hiện trường', 'Giảm bớt hạng mục'];
const changesOf = pid => S.changes.filter(c => c.projectId === pid).sort((a, b) => String(a.no).localeCompare(String(b.no), 'vi', { numeric: true }));
const changeTotal = c => (c.sign === 'sub' ? -1 : 1) * Math.round((c.items || []).reduce((a, x) => a + dec(x.qty) * (+x.price || 0), 0));
const nextChangeNo = pid => 'PS-' + pad(S.changes.filter(c => c.projectId === pid).reduce((m, c) => Math.max(m, +String(c.no || '').replace(/\D/g, '') || 0), 0) + 1);
function changeSummary(pid) {
  const list = changesOf(pid), ok = list.filter(c => c.status === 'approved');
  return { list, approved: ok.reduce((a, c) => a + changeTotal(c), 0), days: ok.reduce((a, c) => a + (+c.days || 0), 0), pending: list.filter(c => c.status === 'sent' || c.status === 'draft').length, unpaid: ok.filter(c => !c.paid && changeTotal(c) > 0) };
}

function changeHTML(c, withPhotos = true) {
  const p = proj(c.projectId) || {}, q = contractFor(c.projectId), s = S.settings, tot = changeTotal(c), sub = c.sign === 'sub';
  const f = (v, w = '……………………') => (v != null && String(v).trim() !== '' ? esc(v) : w);
  const th = x => `<th bgcolor="#eeeeee" style="background-color:#eeeeee"${/STT|ĐVT/.test(x) ? ' class="c"' : /KL|Đơn|Thành/.test(x) ? ' class="r"' : ''}>${x}</th>`;
  const rows = (c.items || []).filter(x => x.name || +x.price).map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.name)}</td><td class="c">${esc(x.unit || '')}</td><td class="r">${fmt(dec(x.qty))}</td><td class="r">${fmt(+x.price || 0)}</td><td class="r">${fmt(Math.round(dec(x.qty) * (+x.price || 0)))}</td></tr>`).join('');
  const photos = withPhotos ? (c.photos || []).slice(0, 6).map(id => photoCache.get(id)).filter(Boolean) : [];
  const { aDef, bDef } = partyLines(p);
  return `<p class="c"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><b><u>Độc lập – Tự do – Hạnh phúc</u></b></p>
<h1>PHIẾU ${sub ? 'GIẢM TRỪ' : 'PHÁT SINH'} KHỐI LƯỢNG</h1><p class="c">Số: ${f(c.no)} · Ngày ${fdate(c.date)}</p>
<p><b>Công trình:</b> ${f(p.name)} – ${f(p.address)}</p>
${q && q.ct ? `<p><b>Thuộc hợp đồng:</b> số ${f(q.ct.no)} ký ngày ${fdate(q.ct.date)}</p>` : ''}
<p><b>Nội dung:</b> ${f(c.title)}</p>
<p><b>Lý do:</b> ${f(c.reason)}</p>
<table><tr>${['STT', 'Nội dung công việc', 'ĐVT', 'KL', 'Đơn giá (đ)', 'Thành tiền (đ)'].map(th).join('')}</tr>${rows}
<tr><td></td><td colspan="4"><b>Tổng giá trị ${sub ? 'giảm trừ' : 'phát sinh'}</b></td><td class="r"><b>${fmt(Math.abs(tot))}</b></td></tr></table>
<p>Bằng chữ: <i>${docSo(Math.abs(tot))}</i>.</p>
<p><b>Ảnh hưởng tiến độ:</b> ${+c.days ? `${sub ? 'rút ngắn' : 'kéo dài thêm'} ${fmt(Math.abs(+c.days))} ngày` : 'không ảnh hưởng thời gian thi công'}.</p>
<p><b>Thanh toán:</b> ${sub ? 'giá trị giảm trừ được trừ vào đợt thanh toán cuối.' : esc(c.payNote || 'thanh toán cùng đợt thanh toán kế tiếp theo hợp đồng.')}</p>
${c.note ? `<p><b>Ghi chú:</b> ${esc(c.note)}</p>` : ''}
<p><i>Đơn giá áp dụng theo đơn giá trong hợp đồng; hạng mục chưa có đơn giá do hai bên thỏa thuận. Bên B chỉ thi công sau khi Bên A ký (hoặc xác nhận qua Zalo) phiếu này.</i></p>
${photos.length ? `<p><b>Ảnh hiện trạng kèm theo:</b></p><div class="pimgs">${photos.map(src => `<img src="${src}" alt="">`).join('')}</div>` : ''}
<table class="nb signs"><tr><td class="c"><b>BÊN A ĐỒNG Ý</b><br><i>(Ký, ghi rõ họ tên)</i><br><br><br><br><br><b>${esc(aDef)}</b></td><td class="c"><b>BÊN B LẬP PHIẾU</b><br><i>(Ký, ghi rõ họ tên)</i><br><br><br><br><br><b>${esc(bDef)}</b></td></tr></table>
<p class="small"><i>${esc(s.company || '')}</i></p>`;
}

// Lưu bản Word vào Hồ sơ dự án
async function saveDocFile({ pid, type, title, no, date, party, amount, note, html, name }) {
  const blob = new Blob(['﻿' + wordDoc(title, html)], { type: 'application/msword' }), fid = uid();
  try { await DB.set('files', fid, blob); } catch (err) { toast('Không lưu được tệp — bộ nhớ đầy?'); return false; }
  S.docs.push({ id: uid(), projectId: pid, type, title, no, date, party, amount, note, files: [{ id: fid, name: safeName(name) + '.doc', type: 'application/msword', size: blob.size }] });
  save(); return true;
}
async function printWithPhotos(ids, make) {
  for (const id of ids || []) await getPhoto(id);
  printHTML(`<div class="ct">${make()}</div>`);
}
