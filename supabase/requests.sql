-- Yêu cầu truy cập + email báo chủ thầu (chạy MỘT LẦN trong Supabase → SQL Editor → New query → Run; chạy lại không sao).
-- Ai đăng nhập (VD bằng Google) mà chưa có trong danh sách thành viên: app ghi một yêu cầu, chủ thầu duyệt trong app.
-- Mỗi yêu cầu mới gửi 1 email báo chủ thầu qua Resend (cần lưu khóa Resend và email nhận – xem cuối file).

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
