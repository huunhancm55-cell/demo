-- Bật "Link cho chủ nhà xem tiến độ" (chạy MỘT LẦN trong Supabase → SQL Editor → New query → Run).
-- Tạo kho ảnh công khai "share": ai có link mới xem được (đường dẫn chứa mã ngẫu nhiên),
-- chỉ thành viên đã đăng nhập trong app mới được tải lên / xóa. Không đụng tới dữ liệu đang có.
insert into storage.buckets (id, name, public, file_size_limit)
values ('share', 'share', true, 5242880)
on conflict (id) do update set public = true;

drop policy if exists "members share" on storage.objects;
create policy "members share" on storage.objects
  for all to authenticated
  using (bucket_id = 'share' and public.is_member())
  with check (bucket_id = 'share' and public.is_member());
