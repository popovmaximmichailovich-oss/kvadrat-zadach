create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active','paused','archived')),
  owner text,
  customer text,
  stage text,
  start_date date,
  due_date date,
  result text,
  next_action text,
  description text,
  note text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.projects add column if not exists customer text;
alter table public.projects add column if not exists stage text;
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists due_date date;
alter table public.projects add column if not exists result text;
alter table public.projects add column if not exists next_action text;
alter table public.projects add column if not exists color text;

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
  project_id uuid references public.projects(id) on delete set null,
  project text,
  due_date date,
  plan_date date,
  status text not null default 'inbox' check (status in ('inbox','planned','doing','delegated','deferred','done')),
  priority text not null default 'C' check (priority in ('A','B','C','D','E')),
  importance text not null default 'low' check (importance in ('high','low')),
  urgency text not null default 'low' check (urgency in ('high','low')),
  note text,
  day_bucket text not null default 'none' check (day_bucket in ('none','one','three','five')),
  order_index bigint default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.work_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  work_date date not null,
  project_id uuid references public.projects(id) on delete set null,
  project text,
  hours numeric(5,2) not null default 8,
  mark text not null default 'Я' check (mark in ('Я','В','Б','ОТ','НН')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.project_members (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  role text not null default 'Участник',
  email text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.promises (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  direction text not null default 'to_me' check (direction in ('to_me','me_to')),
  who text,
  text text not null,
  promised_date date,
  check_date date,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.decisions (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  project_id uuid references public.projects(id) on delete set null,
  decision_date date,
  title text not null,
  text text,
  owner text,
  impact text,
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.task_templates (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  title text,
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'inbox',
  priority text not null default 'C',
  importance text not null default 'low',
  urgency text not null default 'low',
  day_bucket text not null default 'none',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Migrations for existing installations
alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks add column if not exists archived_at timestamptz;
alter table public.work_logs add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks alter column order_index type bigint using order_index::bigint;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.promises enable row level security;
alter table public.decisions enable row level security;
alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.work_logs enable row level security;

drop policy if exists "Users can select own projects" on public.projects;
drop policy if exists "Users can insert own projects" on public.projects;
drop policy if exists "Users can update own projects" on public.projects;
drop policy if exists "Users can delete own projects" on public.projects;
drop policy if exists "Users can select own project members" on public.project_members;
drop policy if exists "Users can insert own project members" on public.project_members;
drop policy if exists "Users can update own project members" on public.project_members;
drop policy if exists "Users can delete own project members" on public.project_members;
drop policy if exists "Users can select own promises" on public.promises;
drop policy if exists "Users can insert own promises" on public.promises;
drop policy if exists "Users can update own promises" on public.promises;
drop policy if exists "Users can delete own promises" on public.promises;
drop policy if exists "Users can select own decisions" on public.decisions;
drop policy if exists "Users can insert own decisions" on public.decisions;
drop policy if exists "Users can update own decisions" on public.decisions;
drop policy if exists "Users can delete own decisions" on public.decisions;
drop policy if exists "Users can select own task templates" on public.task_templates;
drop policy if exists "Users can insert own task templates" on public.task_templates;
drop policy if exists "Users can update own task templates" on public.task_templates;
drop policy if exists "Users can delete own task templates" on public.task_templates;
drop policy if exists "Users can select own tasks" on public.tasks;
drop policy if exists "Users can insert own tasks" on public.tasks;
drop policy if exists "Users can update own tasks" on public.tasks;
drop policy if exists "Users can delete own tasks" on public.tasks;
drop policy if exists "Users can select own work logs" on public.work_logs;
drop policy if exists "Users can insert own work logs" on public.work_logs;
drop policy if exists "Users can update own work logs" on public.work_logs;
drop policy if exists "Users can delete own work logs" on public.work_logs;

create policy "Users can select own projects" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own projects" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own projects" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own projects" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own project members" on public.project_members for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own project members" on public.project_members for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own project members" on public.project_members for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own project members" on public.project_members for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own promises" on public.promises for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own promises" on public.promises for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own promises" on public.promises for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own promises" on public.promises for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own decisions" on public.decisions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own decisions" on public.decisions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own decisions" on public.decisions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own decisions" on public.decisions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own task templates" on public.task_templates for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own task templates" on public.task_templates for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own task templates" on public.task_templates for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own task templates" on public.task_templates for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own tasks" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own tasks" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own tasks" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own tasks" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own work logs" on public.work_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own work logs" on public.work_logs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own work logs" on public.work_logs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own work logs" on public.work_logs for delete to authenticated using ((select auth.uid()) = user_id);

NOTIFY pgrst, 'reload schema';


-- v3.1.0 Architecture Reset: tags and task metadata
alter table public.tasks add column if not exists tags jsonb default '[]'::jsonb;

create table if not exists public.tags (
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  color text,
  order_index bigint default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.task_tags (
  task_id uuid references public.tasks(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key(task_id, tag_id)
);

alter table public.tags enable row level security;
alter table public.task_tags enable row level security;

drop policy if exists "Users can select own tags" on public.tags;
drop policy if exists "Users can insert own tags" on public.tags;
drop policy if exists "Users can update own tags" on public.tags;
drop policy if exists "Users can delete own tags" on public.tags;
drop policy if exists "Users can select own task_tags" on public.task_tags;
drop policy if exists "Users can insert own task_tags" on public.task_tags;
drop policy if exists "Users can update own task_tags" on public.task_tags;
drop policy if exists "Users can delete own task_tags" on public.task_tags;

create policy "Users can select own tags" on public.tags for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own tags" on public.tags for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own tags" on public.tags for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own tags" on public.tags for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can select own task_tags" on public.task_tags for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own task_tags" on public.task_tags for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own task_tags" on public.task_tags for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own task_tags" on public.task_tags for delete to authenticated using ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.tags;
alter publication supabase_realtime add table public.task_tags;
NOTIFY pgrst, 'reload schema';
