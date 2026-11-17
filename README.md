# Hữu Nhân – Quản lý công trình

Ứng dụng quản lý dự án xây dựng gọn nhẹ, nằm trong thư mục [`xaydung/`](xaydung/):

- **Dự án** – tổng quan hợp đồng, đã thu, đã chi, lãi tạm tính, tiến độ ngân sách.
- **Báo giá** – lập nhanh từ mẫu hạng mục, tự tính giảm giá/VAT, đọc số tiền bằng chữ, in / lưu PDF, xuất Excel (CSV).
- **Nhật ký thi công** – thời tiết, nhân công, công việc, vướng mắc, ảnh hiện trường; in báo cáo.
- **Chi phí** – ghi thu chi theo nhóm (vật tư, nhân công, thầu phụ…), cơ cấu chi phí, xuất Excel.
- **Hồ sơ** – lưu ảnh chụp / file hợp đồng, phiếu đề nghị cấp vật tư, biên bản nghiệm thu, giấy tạm ứng, giấy ủy quyền theo từng dự án.
- **Sao lưu / khôi phục** bằng file JSON để chuyển dữ liệu giữa các thiết bị.

Đây là PWA (HTML/CSS/JS thuần, không cần build): chạy offline, dữ liệu lưu trên thiết bị và có thể **đồng bộ giữa điện thoại và máy tính** qua Supabase.

## Chạy thử

```bash
cd xaydung && python3 -m http.server 8000   # mở http://localhost:8000
```

## Cài lên thiết bị

Đưa thư mục `xaydung/` lên một địa chỉ HTTPS (ví dụ GitHub Pages), rồi:

- **iPhone / iPad:** mở bằng Safari → Chia sẻ → *Thêm vào Màn hình chính*.
- **Windows:** mở bằng Edge/Chrome → biểu tượng cài đặt trên thanh địa chỉ → *Cài đặt ứng dụng*.

## Đồng bộ giữa các thiết bị (Supabase)

Mỗi máy vẫn giữ đủ dữ liệu để chạy khi mất mạng; khi có mạng, thay đổi được đẩy lên máy chủ và kéo về các máy khác (gần như tức thì, và kiểm tra lại mỗi 30 giây).

1. Tạo tài khoản và một dự án miễn phí tại https://supabase.com (chọn vùng Singapore cho nhanh).
2. **SQL Editor → New query**: dán nội dung [`supabase/setup.sql`](supabase/setup.sql), sửa email ở dòng cuối thành email đăng nhập của bạn, bấm **Run**.
3. **Authentication → Users → Add user → Create new user**: nhập email đó và mật khẩu, tick **Auto Confirm User**.
4. **Authentication → Sign In / Providers**: tắt *Allow new users to sign up* (không bắt buộc — người không có trong bảng `members` vẫn không xem được dữ liệu).
5. **Project Settings → API**: chép *Project URL* và khóa *anon / publishable*, điền vào [`xaydung/config.js`](xaydung/config.js) (hoặc nhập trong mục Cài đặt của ứng dụng trên từng máy).
6. Mở ứng dụng → **Cài đặt → Đồng bộ giữa các thiết bị** → đăng nhập. Làm như vậy trên mỗi máy.

Lần đăng nhập đầu tiên trên một máy, dữ liệu sẵn có trên máy đó được **gộp** vào dữ liệu chung (không xóa gì).

**Thêm nhân viên:** tạo tài khoản cho họ ở bước 3, rồi chạy trong SQL Editor:
`insert into public.members (email) values ('email-nhan-vien@gmail.com');`

**Lưu ý:**
- Khóa *anon* được thiết kế để nằm công khai trong ứng dụng; dữ liệu được bảo vệ bởi đăng nhập và danh sách `members`. Không bao giờ đưa khóa *service_role* vào ứng dụng.
- Gói miễn phí của Supabase có 500 MB cơ sở dữ liệu và 1 GB tệp; dự án tạm dừng nếu không có ai dùng trong 7 ngày (mở lại trên trang Supabase).
- Hai người sửa cùng một mục cùng lúc thì bản lưu sau cùng được giữ.
