-- Chạy SAU schema trong PDF. Script này có thể chạy lại nhiều lần.
-- Thay YOUR_HOSPITAL_NAME / YOUR_HOSPITAL_CODE / doctor@example.com ở cuối file.

create extension if not exists pgcrypto;

-- Trigger tạo bac_si an toàn hơn: cố định search_path và tránh lỗi nếu hồ sơ đã có.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bac_si (id, email, ho_ten)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'ho_ten', '')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.my_benh_vien_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select benh_vien_id
  from public.bac_si
  where id = auth.uid();
$$;

alter table public.benh_vien enable row level security;
alter table public.bac_si enable row level security;
alter table public.benh_nhan enable row level security;
alter table public.phan_tich enable row level security;
alter table public.nhat_ky_truy_cap enable row level security;

-- Xóa policy cũ trong PDF để tránh policy trùng tên hoặc quyền rộng hơn dự kiến.
drop policy if exists bv_select on public.benh_vien;
drop policy if exists bs_select on public.bac_si;
drop policy if exists bs_update_self on public.bac_si;
drop policy if exists bn_all on public.benh_nhan;
drop policy if exists pt_all on public.phan_tich;
drop policy if exists nk_select on public.nhat_ky_truy_cap;
drop policy if exists nk_insert on public.nhat_ky_truy_cap;

drop policy if exists bn_select_same_hospital on public.benh_nhan;
drop policy if exists bn_insert_same_hospital on public.benh_nhan;
drop policy if exists bn_update_same_hospital on public.benh_nhan;
drop policy if exists bn_delete_same_hospital on public.benh_nhan;
drop policy if exists pt_select_same_hospital on public.phan_tich;
drop policy if exists pt_insert_self on public.phan_tich;
drop policy if exists pt_delete_own on public.phan_tich;

create policy bv_select
on public.benh_vien
for select
to authenticated
using (id = public.my_benh_vien_id());

create policy bs_select
on public.bac_si
for select
to authenticated
using (
  id = auth.uid()
  or benh_vien_id = public.my_benh_vien_id()
);

create policy bs_update_self
on public.bac_si
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy bn_select_same_hospital
on public.benh_nhan
for select
to authenticated
using (benh_vien_id = public.my_benh_vien_id());

create policy bn_insert_same_hospital
on public.benh_nhan
for insert
to authenticated
with check (benh_vien_id = public.my_benh_vien_id());

create policy bn_update_same_hospital
on public.benh_nhan
for update
to authenticated
using (benh_vien_id = public.my_benh_vien_id())
with check (benh_vien_id = public.my_benh_vien_id());

create policy bn_delete_same_hospital
on public.benh_nhan
for delete
to authenticated
using (benh_vien_id = public.my_benh_vien_id());

create policy pt_select_same_hospital
on public.phan_tich
for select
to authenticated
using (benh_vien_id = public.my_benh_vien_id());

create policy pt_insert_self
on public.phan_tich
for insert
to authenticated
with check (
  benh_vien_id = public.my_benh_vien_id()
  and bac_si_id = auth.uid()
);

-- Chỉ người tạo bản phân tích được xóa trong bản MVP.
create policy pt_delete_own
on public.phan_tich
for delete
to authenticated
using (
  benh_vien_id = public.my_benh_vien_id()
  and bac_si_id = auth.uid()
);

create policy nk_select
on public.nhat_ky_truy_cap
for select
to authenticated
using (bac_si_id = auth.uid());

create policy nk_insert
on public.nhat_ky_truy_cap
for insert
to authenticated
with check (bac_si_id = auth.uid());

-- RLS chỉ có hiệu lực khi role authenticated cũng có quyền SQL cơ bản.
grant usage on schema public to authenticated;
grant select on public.benh_vien to authenticated;
grant select, update on public.bac_si to authenticated;
grant select, insert, update, delete on public.benh_nhan to authenticated;
grant select, insert, delete on public.phan_tich to authenticated;
grant select, insert on public.nhat_ky_truy_cap to authenticated;
grant execute on function public.my_benh_vien_id() to authenticated;

-- Tạo bệnh viện mẫu và gán bác sĩ. Sửa ba giá trị bên dưới trước khi chạy.
-- insert into public.benh_vien (ten_benh_vien, ma)
-- values ('YOUR_HOSPITAL_NAME', 'YOUR_HOSPITAL_CODE')
-- on conflict (ma) do update set ten_benh_vien = excluded.ten_benh_vien;
--
-- update public.bac_si
-- set benh_vien_id = (select id from public.benh_vien where ma = 'YOUR_HOSPITAL_CODE')
-- where email = 'doctor@example.com';
