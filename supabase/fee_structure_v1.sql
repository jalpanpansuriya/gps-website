-- ===========================================================
-- Fee structure v1: academic years + component catalog + per-class amounts
-- Run in Supabase SQL Editor AFTER phase2 (needs public.is_admin()).
-- Office/admin only: all policies require role = 'admin' in public.teachers.
-- ===========================================================

-- ---------------------------------------------------------------------------
-- 1) Academic years (labels like 2025-26, 2024-25)
-- ---------------------------------------------------------------------------
create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint academic_years_label_unique unique (label),
  constraint academic_years_date_order check (ends_on >= starts_on)
);

comment on table public.academic_years is 'School session; label format e.g. 2025-26';
comment on column public.academic_years.is_current is 'At most one row should be true; optional convenience for UI.';

-- Only one "current" year at a time
create unique index if not exists academic_years_one_is_current
  on public.academic_years (is_current)
  where is_current = true;

-- ---------------------------------------------------------------------------
-- 2) Fee component catalog (global names; amounts live in class_fee_lines)
-- ---------------------------------------------------------------------------
create table if not exists public.fee_components (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_optional boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint fee_components_code_unique unique (code)
);

comment on table public.fee_components is 'Line items: Tuition, Other fees, Admission fee, Term fees, etc.';
comment on column public.fee_components.code is 'Stable machine code: TUITION, TERM, OTHER, ADMISSION';

-- ---------------------------------------------------------------------------
-- 3) Amounts per class/section, per year, per component
-- ---------------------------------------------------------------------------
create table if not exists public.class_fee_lines (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  class_name text not null,
  section text,
  fee_component_id uuid not null references public.fee_components (id) on delete restrict,
  amount_inr numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_fee_lines_amount_non_negative check (amount_inr >= 0)
);

comment on table public.class_fee_lines is 'structure: section null = all sections in that class; else applies only to that section';
comment on column public.class_fee_lines.section is 'Null means fee applies to every section of class_name.';

create index if not exists class_fee_lines_year_class_idx
  on public.class_fee_lines (academic_year_id, class_name);

-- coalesce so "section null = all" cannot be duplicated; matches students.class_name + coalesce(students.section,'')
create unique index if not exists class_fee_lines_unique_per_scope
  on public.class_fee_lines (academic_year_id, class_name, (coalesce(section, '')), fee_component_id);

-- updated_at touch
create or replace function public.set_class_fee_lines_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_class_fee_lines_updated_at on public.class_fee_lines;
create trigger trg_class_fee_lines_updated_at
  before update on public.class_fee_lines
  for each row
  execute function public.set_class_fee_lines_updated_at();

-- ---------------------------------------------------------------------------
-- 4) RLS — admin only (office); non-admin authenticated users have no access
-- ---------------------------------------------------------------------------
alter table public.academic_years enable row level security;
alter table public.fee_components enable row level security;
alter table public.class_fee_lines enable row level security;

drop policy if exists "admin manage academic_years" on public.academic_years;
create policy "admin manage academic_years"
on public.academic_years
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admin manage fee_components" on public.fee_components;
create policy "admin manage fee_components"
on public.fee_components
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admin manage class_fee_lines" on public.class_fee_lines;
create policy "admin manage class_fee_lines"
on public.class_fee_lines
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5) Seed: four components + one academic year (idempotent)
--    Adjust 2025-26 dates to match your school''s session if different.
-- ---------------------------------------------------------------------------
insert into public.fee_components (code, name, description, is_optional, sort_order) values
  ('TUITION', 'Tuition', null, false, 1),
  ('TERM', 'Term fees', null, false, 2),
  ('OTHER', 'Other fees', 'Misc / activity / other charges as defined by school', true, 3),
  ('ADMISSION', 'Admission fee', 'Typically one-time for new admission', false, 4)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_optional = excluded.is_optional,
  sort_order = excluded.sort_order;

insert into public.academic_years (label, starts_on, ends_on, is_current) values
  ('2025-26', date '2025-04-01', date '2026-03-31', true)
on conflict (label) do nothing;

-- If you re-run the script, optionally ensure only 2025-26 is current (manual in SQL or app):
-- update public.academic_years set is_current = (label = '2025-26') where label in ('2025-26', '2024-25');

-- Example: Class 5, all sections, tuition 15000 (uncomment; align class_name with public.students)
-- insert into public.class_fee_lines (academic_year_id, class_name, section, fee_component_id, amount_inr)
-- select y.id, '5', null, c.id, 15000.00
-- from public.academic_years y
-- join public.fee_components c on c.code = 'TUITION'
-- where y.label = '2025-26'
-- on conflict (academic_year_id, class_name, (coalesce(section, '')), fee_component_id) do update
-- set amount_inr = excluded.amount_inr, updated_at = now();
