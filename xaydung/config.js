// Cấu hình máy chủ đồng bộ (Supabase) dùng chung cho mọi thiết bị.
// Lấy ở trang Supabase: Project Settings → API (Project URL và anon / publishable key).
// Khóa anon được thiết kế để nằm công khai trong ứng dụng; dữ liệu được bảo vệ bằng
// đăng nhập và danh sách thành viên (xem supabase/setup.sql).
// Để trống thì có thể nhập trực tiếp trong mục Cài đặt của ứng dụng.
window.QLXD_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
