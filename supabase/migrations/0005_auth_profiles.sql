-- Real accounts: a profiles table (role: 'user' | 'admin') alongside
-- Supabase's built-in auth.users, a nullable owner column on sessions (for
-- the future "start anonymous, claim on signup" flow), and an RLS fix.
--
-- RLS was disabled on every public table — harmless while only the
-- service-role client (lib/supabase-server.ts) ever touched them, but a real
-- exposure once a browser Supabase client ships the anon/publishable key.
-- Enabling it with zero policies blocks the anon/authenticated roles
-- entirely; the service-role client bypasses RLS regardless, so none of the
-- existing server code changes behavior.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  display_name text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row for every new auth user (magic-link sign-up
-- included) so `role` always has somewhere to live.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Inert until the user-facing claim flow (a later change) starts writing to
-- it; added now so the schema change and the RLS fix ship together.
alter table sessions add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table sessions enable row level security;
alter table session_turns enable row level security;
alter table session_evaluations enable row level security;
alter table session_turn_evaluations enable row level security;
alter table profiles enable row level security;
