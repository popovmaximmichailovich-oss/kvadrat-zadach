create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
  project text,
  due_date date,
  plan_date date,
  status text not null default 'inbox' check (status in ('inbox','planned','doing','delegated','deferred','done')),
  priority text not null default 'C' check (priority in ('A','B','C','D','E')),
  importance text not null default 'low' check (importance in ('high','low')),
  urgency text not null default 'low' check (urgency in ('high','low')),
  note text,
  day_bucket text not null default 'none' check (day_bucket in ('none','one','three','five')),
  order_index integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.work_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  work_date date not null,
  project text not null,
  hours numeric(5,2) not null default 8,
  mark text not null default 'Я' check (mark in ('Я','В','Б','ОТ','НН')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.tasks enable row level security;
alter table public.work_logs enable row level security;

drop policy if exists "Users can select own tasks" on public.tasks;
drop policy if exists "Users can insert own tasks" on public.tasks;
drop policy if exists "Users can update own tasks" on public.tasks;
drop policy if exists "Users can delete own tasks" on public.tasks;
drop policy if exists "Users can select own work logs" on public.work_logs;
drop policy if exists "Users can insert own work logs" on public.work_logs;
drop policy if exists "Users can update own work logs" on public.work_logs;
drop policy if exists "Users can delete own work logs" on public.work_logs;

create policy "Users can select own tasks" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own tasks" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own tasks" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own tasks" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own work logs" on public.work_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own work logs" on public.work_logs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own work logs" on public.work_logs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own work logs" on public.work_logs for delete to authenticated using ((select auth.uid()) = user_id);
