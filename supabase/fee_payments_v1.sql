-- ===========================================================
-- Fee payments v1: offline / manual payments + monotonic receipt numbers
-- Run in Supabase SQL Editor AFTER:
--   - phase2 (public.is_admin)
--   - fee_structure_v1 (academic_years)
-- Requires: public.students, public.teachers, public.academic_years
-- ===========================================================

-- ---------------------------------------------------------------------------
-- 1) Per–academic-year counter (touched only by create_fee_payment)
-- ---------------------------------------------------------------------------
create table if not exists public.fee_receipt_counters (
  academic_year_id uuid primary key references public.academic_years (id) on delete restrict,
  last_number int not null default 0
);

comment on table public.fee_receipt_counters is 'Monotonic serial per year for R-{label}-{n} receipt numbers.';

-- ---------------------------------------------------------------------------
-- 2) fee_payments — one row per amount received
-- ---------------------------------------------------------------------------
create table if not exists public.fee_payments (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  amount_inr numeric(12, 2) not null,
  payment_date date not null,
  payment_mode text not null,
  reference text,
  note text,
  receipt_number text not null,
  recorded_by uuid references public.teachers (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fee_payments_amount_positive check (amount_inr > 0),
  constraint fee_payments_mode_check check (
    payment_mode in (
      'CASH',
      'UPI',
      'BANK_TRANSFER',
      'CHEQUE',
      'CARD',
      'OTHER'
    )
  ),
  constraint fee_payments_receipt_number_unique unique (receipt_number)
);

comment on table public.fee_payments is 'Offline/recorded fee receipts; v1: single amount per row (not split by component).';
comment on column public.fee_payments.receipt_number is 'Human-facing unique id, e.g. R-2025-26-00001';

create index if not exists fee_payments_student_year_idx
  on public.fee_payments (student_id, academic_year_id);
create index if not exists fee_payments_payment_date_idx
  on public.fee_payments (payment_date);

-- ---------------------------------------------------------------------------
-- 3) Atomic insert + next receipt (security definer, admin only)
-- ---------------------------------------------------------------------------
create or replace function public.create_fee_payment(
  p_student_id uuid,
  p_academic_year_id uuid,
  p_amount_inr numeric,
  p_payment_date date,
  p_payment_mode text,
  p_reference text default null,
  p_note text default null
)
returns table (
  id uuid,
  receipt_number text,
  amount_inr numeric,
  payment_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_label text;
  v_receipt text;
  v_recorder uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin only';
  end if;

  if p_amount_inr is null or p_amount_inr <= 0 then
    raise exception 'Invalid amount: must be greater than 0';
  end if;

  if p_payment_mode is null
     or p_payment_mode not in (
       'CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'
     ) then
    raise exception 'Invalid payment_mode';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.is_active = true
  ) then
    raise exception 'Student not found or inactive';
  end if;

  select y.label
    into v_label
  from public.academic_years y
  where y.id = p_academic_year_id
  limit 1;

  if v_label is null then
    raise exception 'Academic year not found';
  end if;

  insert into public.fee_receipt_counters (academic_year_id, last_number)
  values (p_academic_year_id, 1)
  on conflict (academic_year_id) do update
  set last_number = public.fee_receipt_counters.last_number + 1
  returning last_number into v_n;

  v_receipt := format('R-%s-%s', v_label, lpad(v_n::text, 5, '0'));

  select t.id
    into v_recorder
  from public.teachers t
  where t.user_id = auth.uid()
  limit 1;

  return query
  insert into public.fee_payments (
    academic_year_id,
    student_id,
    amount_inr,
    payment_date,
    payment_mode,
    reference,
    note,
    receipt_number,
    recorded_by
  )
  values (
    p_academic_year_id,
    p_student_id,
    p_amount_inr,
    p_payment_date,
    p_payment_mode,
    nullif(trim(p_reference), ''),
    nullif(trim(p_note), ''),
    v_receipt,
    v_recorder
  )
  returning public.fee_payments.id, public.fee_payments.receipt_number,
    public.fee_payments.amount_inr, public.fee_payments.payment_date;
end;
$$;

revoke all on function public.create_fee_payment(
  uuid, uuid, numeric, date, text, text, text
) from public;
grant execute on function public.create_fee_payment(
  uuid, uuid, numeric, date, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------
alter table public.fee_receipt_counters enable row level security;
alter table public.fee_payments enable row level security;

-- Counters: no user-facing policies (only security definer function writes)
-- fee_payments: admin can read/insert via client if needed, or use RPC only.
-- v1: allow admin full access on fee_payments for listing/receipts; inserts prefer RPC.
drop policy if exists "admin manage fee_payments" on public.fee_payments;
create policy "admin manage fee_payments"
on public.fee_payments
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Optional read path later: e.g. parents read own child — not in v1.
