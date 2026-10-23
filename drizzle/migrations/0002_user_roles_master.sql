create type public.app_role as enum ('master', 'admin', 'user');

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

revoke all on function public.has_role(uuid, public.app_role) from public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

-- Attribution automatique du rôle master au compte tiago3228@yahoo.com.br à son inscription
create or replace function app.assign_master_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) = 'tiago3228@yahoo.com.br' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'master')
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_master_on_signup on auth.users;
create trigger trg_assign_master_on_signup
after insert on auth.users
for each row execute function app.assign_master_on_signup();
