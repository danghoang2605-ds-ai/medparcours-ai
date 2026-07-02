-- MedParcours: bật tự đăng ký tài khoản bác sĩ cho bản demo.
-- Chạy file này SAU schema gốc và supabase_security_patch.sql.
--
-- Flow:
--   Frontend supabase.auth.signUp()
--     -> tạo auth.users
--     -> trigger on_auth_user_created
--     -> tạo public.bac_si và gán bệnh viện demo
--
-- LƯU Ý: bản production không nên cho mọi tài khoản tự gia nhập một bệnh viện.
-- Nên thay bằng invitation code, phê duyệt quản trị viên hoặc SSO của bệnh viện.

-- 1) Bệnh viện mặc định cho các tài khoản tự đăng ký trong demo.
insert into public.benh_vien (ten_benh_vien, ma)
values ('MedParcours Demo Hospital', 'MEDPARCOURS_DEMO')
on conflict (ma) do update
set ten_benh_vien = excluded.ten_benh_vien;

-- 2) Khi Supabase Auth tạo user, tự tạo hồ sơ bác sĩ tương ứng.
--    Họ tên và khoa được nhận từ options.data trong supabase.auth.signUp().
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_benh_vien_id uuid;
begin
  select id
  into v_benh_vien_id
  from public.benh_vien
  where ma = 'MEDPARCOURS_DEMO'
  limit 1;

  if v_benh_vien_id is null then
    raise exception 'Chưa có bệnh viện mặc định MEDPARCOURS_DEMO';
  end if;

  insert into public.bac_si (
    id,
    email,
    ho_ten,
    khoa,
    benh_vien_id
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'ho_ten', ''),
    nullif(new.raw_user_meta_data->>'khoa', ''),
    v_benh_vien_id
  )
  on conflict (id) do update
  set
    email = excluded.email,
    ho_ten = excluded.ho_ten,
    khoa = excluded.khoa,
    benh_vien_id = coalesce(public.bac_si.benh_vien_id, excluded.benh_vien_id);

  return new;
end;
$$;

-- 3) Tạo lại trigger để chắc chắn trigger dùng phiên bản hàm mới.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) Kiểm tra nhanh sau khi tạo tài khoản trên giao diện:
-- select id, email, ho_ten, khoa, benh_vien_id, created_at
-- from public.bac_si
-- order by created_at desc;
