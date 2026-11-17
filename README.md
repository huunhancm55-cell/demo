# Hữu Nhân – Quản lý công trình

Ứng dụng quản lý dự án xây dựng gọn nhẹ, nằm trong thư mục [`xaydung/`](xaydung/):

- **Dự án** – tổng quan hợp đồng, đã thu, đã chi, lãi tạm tính, tiến độ ngân sách.
- **Báo giá** – lập nhanh từ mẫu hạng mục, tự tính giảm giá/VAT, đọc số tiền bằng chữ, in / lưu PDF, xuất Excel (CSV).
- **Nhật ký thi công** – thời tiết, nhân công, công việc, vướng mắc, ảnh hiện trường; in báo cáo.
- **Chi phí** – ghi thu chi theo nhóm (vật tư, nhân công, thầu phụ…), cơ cấu chi phí, xuất Excel.
- **Sao lưu / khôi phục** bằng file JSON để chuyển dữ liệu giữa các thiết bị.

Đây là PWA (HTML/CSS/JS thuần, không cần build): chạy offline, dữ liệu lưu trên thiết bị.

## Chạy thử

```bash
cd xaydung && python3 -m http.server 8000   # mở http://localhost:8000
```

## Cài lên thiết bị

Đưa thư mục `xaydung/` lên một địa chỉ HTTPS (ví dụ GitHub Pages), rồi:

- **iPhone / iPad:** mở bằng Safari → Chia sẻ → *Thêm vào Màn hình chính*.
- **Windows:** mở bằng Edge/Chrome → biểu tượng cài đặt trên thanh địa chỉ → *Cài đặt ứng dụng*.
