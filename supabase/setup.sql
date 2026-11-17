-- Hữu Nhân – Quản lý công trình: dựng máy chủ đồng bộ trên Supabase
-- Cách dùng: Supabase → SQL Editor → New query → dán toàn bộ file này
--            → SỬA email ở dòng cuối thành email đăng nhập của bạn → Run.
-- Chạy lại nhiều lần không sao (không xóa dữ liệu đã có).

-- 1. Danh sách thành viên được xem / sửa dữ liệu công ty
create table if not exists public.members (
  email text primary key
);

-- 2. Dữ liệu: mỗi dự án / báo giá / nhật ký / thu chi / hồ sơ là một dòng
create table if not exists public.records (
  id         text primary key,
  kind       text not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists records_updated_at_idx on public.records (updated_at);

-- Máy chủ tự ghi thời điểm và người sửa, không tin đồng hồ của thiết bị
create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- 3. Phân quyền: chỉ tài khoản có email trong bảng members mới đọc / ghi được
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

alter table public.records enable row level security;
alter table public.members enable row level security;

drop policy if exists "members read write records" on public.records;
create policy "members read write records" on public.records
  for all to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists "members see members" on public.members;
create policy "members see members" on public.members
  for select to authenticated using (public.is_member());

-- Cập nhật tức thì giữa các máy
do $$
begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null;
end $$;

-- 4. Kho lưu ảnh nhật ký và tệp hồ sơ (riêng tư, tối đa 30 MB mỗi tệp)
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 31457280)
on conflict (id) do nothing;

drop policy if exists "members files" on storage.objects;
create policy "members files" on storage.objects
  for all to authenticated
  using (bucket_id = 'files' and public.is_member())
  with check (bucket_id = 'files' and public.is_member());

-- 5. THÊM THÀNH VIÊN: thay email dưới đây bằng email đăng nhập của bạn.
--    Muốn thêm người khác thì thêm dòng tương tự với email của họ.
insert into public.members (email) values ('EMAIL_CUA_BAN@gmail.com') on conflict do nothing;
