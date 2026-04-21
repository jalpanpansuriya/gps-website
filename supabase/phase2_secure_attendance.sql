-- ===========================================================
-- Phase 2: Real-world secure attendance setup
-- Run this in Supabase SQL Editor
-- ===========================================================

create extension if not exists pgcrypto;

-- Ensure teacher auth mapping exists
alter table public.teachers
  alter column user_id set not null;

-- Helper functions
create or replace function public.current_teacher_id()
returns uuid
language sql
stable
as $$
  select t.id
  from public.teachers t
  where t.user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((
    select t.role = 'admin'
    from public.teachers t
    where t.user_id = auth.uid()
    limit 1
  ), false)
$$;

-- Enable RLS
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.attendance enable row level security;
alter table public.sms_logs enable row level security;

-- Remove dev/public write access policies if present
drop policy if exists "dev read students" on public.students;
drop policy if exists "dev read attendance" on public.attendance;
drop policy if exists "dev insert attendance" on public.attendance;
drop policy if exists "dev insert sms_logs" on public.sms_logs;
drop policy if exists "dev read sms_logs" on public.sms_logs;

-- Teachers table policies
drop policy if exists "teachers read own/admin all" on public.teachers;
create policy "teachers read own/admin all"
on public.teachers
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admin manage teachers" on public.teachers;
create policy "admin manage teachers"
on public.teachers
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Students policies
drop policy if exists "teachers can read active students" on public.students;
create policy "teachers can read active students"
on public.students
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists "admin manage students" on public.students;
create policy "admin manage students"
on public.students
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Attendance policies
drop policy if exists "teachers read attendance" on public.attendance;
create policy "teachers read attendance"
on public.attendance
for select
to authenticated
using (public.current_teacher_id() is not null);

drop policy if exists "admin update delete attendance" on public.attendance;
create policy "admin update delete attendance"
on public.attendance
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admin delete attendance" on public.attendance;
create policy "admin delete attendance"
on public.attendance
for delete
to authenticated
using (public.is_admin());

-- SMS logs policies
drop policy if exists "teachers read sms logs" on public.sms_logs;
create policy "teachers read sms logs"
on public.sms_logs
for select
to authenticated
using (public.current_teacher_id() is not null);

drop policy if exists "admin manage sms logs" on public.sms_logs;
create policy "admin manage sms logs"
on public.sms_logs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Secure RPC for attendance marking + SMS queue
create or replace function public.mark_attendance(
  p_student_id uuid,
  p_event_type attendance_type,
  p_note text default null
)
returns table (
  attendance_id uuid,
  attendance_date date,
  event_type attendance_type,
  sms_log_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
  v_attendance_id uuid;
  v_attendance_date date := (now() at time zone 'Asia/Kolkata')::date;
  v_phone text;
  v_student_name text;
  v_message text;
  v_sms_id uuid;
begin
  v_teacher_id := public.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'Not authorized: teacher profile not found';
  end if;

  select s.parent_phone, s.full_name
    into v_phone, v_student_name
  from public.students s
  where s.id = p_student_id and s.is_active = true
  for update;

  if v_phone is null then
    raise exception 'Student not found or inactive';
  end if;

  insert into public.attendance (
    student_id, attendance_date, event_type, marked_by, note
  )
  values (
    p_student_id, v_attendance_date, p_event_type, v_teacher_id, p_note
  )
  returning id into v_attendance_id;

  if p_event_type = 'IN' then
    v_message := format(
      'Dear Parent, %s has reached school safely on %s.',
      v_student_name,
      to_char(v_attendance_date, 'DD Mon YYYY')
    );
  else
    v_message := format(
      'Dear Parent, %s has left school on %s.',
      v_student_name,
      to_char(v_attendance_date, 'DD Mon YYYY')
    );
  end if;

  insert into public.sms_logs (
    attendance_id, student_id, phone, message_type, message_body, status
  )
  values (
    v_attendance_id, p_student_id, v_phone, p_event_type, v_message, 'QUEUED'
  )
  returning id into v_sms_id;

  return query
  select v_attendance_id, v_attendance_date, p_event_type, v_sms_id;
end;
$$;

revoke all on function public.mark_attendance(uuid, attendance_type, text) from public;
grant execute on function public.mark_attendance(uuid, attendance_type, text) to authenticated;

-- Seed admin/teacher mapping:
-- 1) Create the teacher user in Supabase Auth first
-- 2) Then run insert below with that auth user's UUID
--
-- insert into public.teachers (user_id, full_name, role)
-- values ('<auth_user_uuid>', 'School Admin', 'admin');

