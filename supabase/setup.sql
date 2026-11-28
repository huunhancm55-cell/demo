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

-- 4b. Link chủ nhà xem tiến độ (công khai, chỉ đọc theo đường dẫn khó đoán; chỉ thành viên được ghi)
insert into storage.buckets (id, name, public, file_size_limit)
values ('share', 'share', true, 5242880)
on conflict (id) do update set public = true;

drop policy if exists "members share" on storage.objects;
create policy "members share" on storage.objects
  for all to authenticated
  using (bucket_id = 'share' and public.is_member())
  with check (bucket_id = 'share' and public.is_member());

-- 5. THÊM THÀNH VIÊN: thay email dưới đây bằng email đăng nhập của bạn.
--    Muốn thêm người khác thì thêm dòng tương tự với email của họ.
insert into public.members (email) values ('EMAIL_CUA_BAN@gmail.com') on conflict do nothing;

-- 6. TÀI KHOẢN ĐỘI THỢ (phân quyền theo công trình) — giống file crew.sql

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


-- 6b. Giám sát được lưu Biên bản nghiệm thu vào Hồ sơ công trình được giao (không xem / xóa hồ sơ khác)
create or replace function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'supervisor'
  );
$$;
revoke all on function public.is_supervisor() from public, anon;
grant execute on function public.is_supervisor() to authenticated;

drop policy if exists "supervisor minutes" on public.records;
create policy "supervisor minutes" on public.records for all to authenticated
  using (kind = 'docs' and data ->> 'type' = 'Biên bản nghiệm thu' and data ->> 'projectId' = any (public.crew_projects()) and public.is_supervisor())
  with check (kind = 'docs' and not deleted and data ->> 'type' = 'Biên bản nghiệm thu' and data ->> 'projectId' = any (public.crew_projects()) and public.is_supervisor());

-- Tệp biên bản (thư mục f/): giám sát chỉ được tải lên tệp mới, không đọc / sửa / xóa tệp có sẵn
drop policy if exists "supervisor files add" on storage.objects;
create policy "supervisor files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and name like 'f/%' and public.is_supervisor());

-- 7. YÊU CẦU TRUY CẬP + EMAIL BÁO CHỦ THẦU — giống file requests.sql
-- 1. Bảng yêu cầu truy cập
create table if not exists public.access_requests (
  email      text primary key,
  name       text,
  avatar     text,
  status     text not null default 'pending',   -- pending | rejected
  created_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;

drop policy if exists "request own" on public.access_requests;
create policy "request own" on public.access_requests for insert to authenticated
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and status = 'pending');
drop policy if exists "see own request" on public.access_requests;
create policy "see own request" on public.access_requests for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_member());
drop policy if exists "owners manage requests" on public.access_requests;
create policy "owners manage requests" on public.access_requests for update to authenticated
  using (public.is_member()) with check (public.is_member());
drop policy if exists "owners delete requests" on public.access_requests;
create policy "owners delete requests" on public.access_requests for delete to authenticated
  using (public.is_member());

-- 2. Gửi email khi có yêu cầu mới (pg_net gọi API Resend; khóa lấy từ Vault, không lộ ra app)
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'Không bật được pg_net: %', sqlerrm;
end $$;

create or replace function public.notify_access_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text; dest text;
  app text := 'https://huunhancm55-cell.github.io/demo/xaydung/';
begin
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'resend_api_key';
    select decrypted_secret into dest from vault.decrypted_secrets where name = 'notify_email';
  exception when others then return new;
  end;
  if k is null or dest is null then return new; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Hữu Nhân – Quản lý công trình <onboarding@resend.dev>',
      'to', jsonb_build_array(dest),
      'subject', 'Yêu cầu truy cập app: ' || coalesce(nullif(new.name, ''), new.email),
      'html', '<p>Có người vừa đăng nhập app <b>Quản lý công trình Hữu Nhân</b> và xin quyền truy cập:</p>'
        || '<p><b>' || coalesce(nullif(replace(replace(new.name, '<', '&lt;'), '>', '&gt;'), ''), '(chưa có tên)') || '</b><br>'
        || replace(replace(new.email, '<', '&lt;'), '>', '&gt;') || '</p>'
        || '<p>Mở app → <b>Cài đặt → Yêu cầu truy cập</b> để <b>Duyệt</b> (chọn vai trò, công trình) hoặc <b>Từ chối</b>.</p>'
        || '<p><a href="' || app || '">Mở app</a></p>'
        || '<p style="color:#888">Nếu không biết người này, cứ bấm Từ chối – họ không xem được dữ liệu nào khi chưa được duyệt.</p>'
    )
  );
  return new;
exception when others then
  return new; -- lỗi gửi mail không được chặn yêu cầu
end $$;

drop trigger if exists access_request_notify on public.access_requests;
create trigger access_request_notify after insert on public.access_requests
  for each row execute function public.notify_access_request();

-- 3. LƯU KHÓA GỬI MAIL (làm một lần, sau khi có khóa Resend):
--    Bỏ dấu -- ở 2 dòng dưới, thay khóa và email nhận, rồi Run riêng 2 dòng đó.
--    Email nhận phải là email anh dùng để đăng ký Resend (gói miễn phí chỉ gửi tới email đó).
-- select vault.create_secret('re_XXXXXXXXXXXXXXXX', 'resend_api_key');
-- select vault.create_secret('email_cua_anh@gmail.com', 'notify_email');
