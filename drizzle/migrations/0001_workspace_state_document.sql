-- Estado do aplicativo por workspace (documento JSONB)
create table if not exists public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.workspace_state enable row level security;

grant select, insert, update, delete on public.workspace_state to authenticated;
grant all on public.workspace_state to service_role;

drop policy if exists workspace_state_member_all on public.workspace_state;
create policy workspace_state_member_all on public.workspace_state for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

-- updated_at automático
create or replace function app.set_workspace_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_workspace_state_updated_at on public.workspace_state;
create trigger trg_workspace_state_updated_at
before insert or update on public.workspace_state
for each row execute function app.set_workspace_state_updated_at();
