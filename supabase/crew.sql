-- Tài khoản đội thợ (chạy MỘT LẦN trong Supabase → SQL Editor → New query → Run; chạy lại không sao).
-- Chủ thầu (role = 'owner', mặc định cho các thành viên đang có) vẫn toàn quyền như cũ.
-- Cai thợ / đội thợ (role = 'crew') và giám sát (role = 'supervisor') chỉ thấy các công trình được giao: tên, địa chỉ, tiến độ, nhật ký, ảnh.
-- Không thấy báo giá, chi phí, hợp đồng, hồ sơ, phát sinh, giá trị công trình. Máy chủ chặn, không chỉ ẩn trên app.

-- 1. Thêm vai trò, tên và danh sách công trình được giao
alter table public.members add column if not exists role text not null default 'owner';
alter table public.members add column if not exists name text;
alter table public.members add column if not exists projects text[] not null default '{}';

-- 2. Hàm kiểm tra quyền
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'owner'
  );
$$;
create or replace function public.is_crew() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and role in ('crew', 'supervisor')
  );
$$;
create or replace function public.crew_projects() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((
    select projects from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and role in ('crew', 'supervisor')
  ), '{}'::text[]);
$$;
revoke all on function public.is_crew() from public, anon;
revoke all on function public.crew_projects() from public, anon;
grant execute on function public.is_crew() to authenticated;
grant execute on function public.crew_projects() to authenticated;

-- 3. Đội thợ đọc / ghi mốc tiến độ và nhật ký của công trình được giao (xóa được nhật ký của các công trình đó)
drop policy if exists "crew read" on public.records;
create policy "crew read" on public.records for select to authenticated
  using (kind in ('tasks', 'logs') and (data ->> 'projectId' = any (public.crew_projects()) or (deleted and data is null and public.is_crew())));
drop policy if exists "crew insert" on public.records;
create policy "crew insert" on public.records for insert to authenticated
  with check (kind in ('tasks', 'logs') and (data ->> 'projectId' = any (public.crew_projects()) or (deleted and data is null and public.is_crew())));
drop policy if exists "crew update" on public.records;
create policy "crew update" on public.records for update to authenticated
  using (kind in ('tasks', 'logs') and data ->> 'projectId' = any (public.crew_projects()))
  with check (kind in ('tasks', 'logs') and (data ->> 'projectId' = any (public.crew_projects()) or (deleted and data is null)));

-- 4. Đội thợ xem công trình được giao qua bản rút gọn (không có giá trị hợp đồng, ngân sách, ghi chú, link chủ nhà)
create or replace view public.crew_projects_v as
select id, kind,
  case when deleted or data is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', data -> 'id', 'name', data -> 'name', 'client', data -> 'client', 'address', data -> 'address',
    'start', data -> 'start', 'end', data -> 'end', 'status', data -> 'status', 'photos', data -> 'photos', 'plan', data -> 'plan')) end as data,
  deleted, updated_at
from public.records
where kind = 'projects' and id = any (public.crew_projects());
revoke all on public.crew_projects_v from anon;
grant select on public.crew_projects_v to authenticated;

-- 5. Danh sách thành viên: chủ thầu quản lý; đội thợ chỉ xem dòng của mình
drop policy if exists "members see members" on public.members;
drop policy if exists "owners manage members" on public.members;
create policy "owners manage members" on public.members
  for all to authenticated using (public.is_member()) with check (public.is_member());
drop policy if exists "see self" on public.members;
create policy "see self" on public.members
  for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 6. Ảnh: đội thợ xem và tải lên ảnh (thư mục p/), không xóa được, không thấy tệp hồ sơ (thư mục f/)
drop policy if exists "crew photos read" on storage.objects;
create policy "crew photos read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and name like 'p/%' and public.is_crew());
drop policy if exists "crew photos add" on storage.objects;
create policy "crew photos add" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and name like 'p/%' and public.is_crew());
drop policy if exists "crew photos update" on storage.objects;
create policy "crew photos update" on storage.objects for update to authenticated
  using (bucket_id = 'files' and name like 'p/%' and public.is_crew())
  with check (bucket_id = 'files' and name like 'p/%' and public.is_crew());
