-- ===========================================================
-- Fee Tier 1: extra components + dashboard stats + defaulters list
-- Run in Supabase SQL Editor AFTER fee_structure_v1.sql and fee_payments_v1.sql
-- Requires: public.is_admin(), students, teachers, fee_*, academic_years
-- ===========================================================

-- ---------------------------------------------------------------------------
-- 1) Additional fee components (transport, hostel, activity)
-- ---------------------------------------------------------------------------
insert into public.fee_components (code, name, description, is_optional, sort_order) values
  ('TRANSPORT', 'Transport', 'Bus / transport charges', true, 5),
  ('HOSTEL', 'Hostel', 'Residential / hostel charges', true, 6),
  ('ACTIVITY', 'Activity fees', 'Sports, clubs, and activity charges', true, 7)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_optional = excluded.is_optional,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2) Collection summary for staff dashboard (IST calendar for today / month)
-- ---------------------------------------------------------------------------
create or replace function public.admin_fee_dashboard_stats(p_academic_year_id uuid)
returns table (
  collected_today_inr numeric,
  collected_month_inr numeric,
  collected_session_inr numeric,
  payments_today bigint,
  payments_month bigint,
  payments_session bigint,
  by_mode_session jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_month_start date;
  v_month_end date;
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin only';
  end if;

  v_today := (current_timestamp at time zone 'Asia/Kolkata')::date;
  v_month_start := date_trunc('month', (current_timestamp at time zone 'Asia/Kolkata'))::date;
  v_month_end := (date_trunc('month', (current_timestamp at time zone 'Asia/Kolkata')) + interval '1 month')::date;

  return query
  select
    coalesce((
      select sum(fp.amount_inr)
      from public.fee_payments fp
      where fp.academic_year_id = p_academic_year_id
        and fp.payment_date = v_today
    ), 0::numeric),
    coalesce((
      select sum(fp.amount_inr)
      from public.fee_payments fp
      where fp.academic_year_id = p_academic_year_id
        and fp.payment_date >= v_month_start
        and fp.payment_date < v_month_end
    ), 0::numeric),
    coalesce((
      select sum(fp.amount_inr)
      from public.fee_payments fp
      where fp.academic_year_id = p_academic_year_id
    ), 0::numeric),
    coalesce((
      select count(*)::bigint
      from public.fee_payments fp
      where fp.academic_year_id = p_academic_year_id
        and fp.payment_date = v_today
    ), 0::bigint),
    coalesce((
      select count(*)::bigint
      from public.fee_payments fp
      where fp.academic_year_id = p_academic_year_id
        and fp.payment_date >= v_month_start
        and fp.payment_date < v_month_end
    ), 0::bigint),
    coalesce((
      select count(*)::bigint
      from public.fee_payments fp
      where fp.academic_year_id = p_academic_year_id
    ), 0::bigint),
    coalesce((
      select jsonb_object_agg(x.mode, x.total)
      from (
        select fp.payment_mode as mode, sum(fp.amount_inr) as total
        from public.fee_payments fp
        where fp.academic_year_id = p_academic_year_id
        group by fp.payment_mode
      ) x
    ), '{}'::jsonb);
end;
$$;

revoke all on function public.admin_fee_dashboard_stats(uuid) from public;
grant execute on function public.admin_fee_dashboard_stats(uuid) to authenticated;

comment on function public.admin_fee_dashboard_stats(uuid) is
  'Admin only: fee collection today (IST), this calendar month (IST), full session, and per-mode session totals.';

-- ---------------------------------------------------------------------------
-- 3) Defaulters: expected (class_fee_lines) minus payments for the year
--    Section rule: match student section row if present, else class-wide (section null).
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_fee_defaulters(
  p_academic_year_id uuid,
  p_min_outstanding numeric default 1,
  p_class_name text default null
)
returns table (
  student_id uuid,
  full_name text,
  class_name text,
  section text,
  roll_no text,
  expected_inr numeric,
  paid_inr numeric,
  outstanding_inr numeric,
  last_payment_date date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin only';
  end if;

  return query
  with st as (
    select
      s.id,
      s.full_name,
      s.class_name,
      s.section,
      s.roll_no,
      nullif(trim(s.section::text), '') as sec_norm
    from public.students s
    where s.is_active = true
      and (p_class_name is null or trim(p_class_name) = '' or s.class_name = trim(p_class_name))
  ),
  line_pick as (
    select
      st.id as sid,
      fc.id as fid,
      coalesce(
        (
          select cfl.amount_inr
          from public.class_fee_lines cfl
          where cfl.academic_year_id = p_academic_year_id
            and cfl.class_name = st.class_name
            and cfl.fee_component_id = fc.id
            and cfl.section is not distinct from st.sec_norm
          limit 1
        ),
        (
          select cfl.amount_inr
          from public.class_fee_lines cfl
          where cfl.academic_year_id = p_academic_year_id
            and cfl.class_name = st.class_name
            and cfl.fee_component_id = fc.id
            and cfl.section is null
          limit 1
        ),
        0::numeric
      ) as line_amt
    from st
    cross join public.fee_components fc
    where fc.is_active = true
  ),
  expected as (
    select lp.sid as student_id, sum(lp.line_amt) as expected_inr
    from line_pick lp
    group by lp.sid
  ),
  paid as (
    select
      fp.student_id,
      coalesce(sum(fp.amount_inr), 0::numeric) as paid_inr,
      max(fp.payment_date) as last_payment_date
    from public.fee_payments fp
    where fp.academic_year_id = p_academic_year_id
    group by fp.student_id
  )
  select
    st.id,
    st.full_name::text,
    st.class_name::text,
    coalesce(st.section::text, '')::text as section,
    coalesce(st.roll_no::text, '')::text as roll_no,
    e.expected_inr,
    coalesce(p.paid_inr, 0::numeric),
    (e.expected_inr - coalesce(p.paid_inr, 0::numeric))::numeric,
    p.last_payment_date::date
  from st
  inner join expected e on e.student_id = st.id
  left join paid p on p.student_id = st.id
  where (e.expected_inr - coalesce(p.paid_inr, 0::numeric)) >= p_min_outstanding
  order by (e.expected_inr - coalesce(p.paid_inr, 0::numeric)) desc;
end;
$$;

revoke all on function public.admin_list_fee_defaulters(uuid, numeric, text) from public;
grant execute on function public.admin_list_fee_defaulters(uuid, numeric, text) to authenticated;

comment on function public.admin_list_fee_defaulters(uuid, numeric, text) is
  'Admin only: students with total class fee lines (per section resolution) minus session payments >= p_min_outstanding.';
