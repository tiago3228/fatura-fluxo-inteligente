create or replace function public.join_family_workspace()
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_ws uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;
  select id into v_ws from public.workspaces order by created_at asc limit 1;
  if v_ws is null then
    insert into public.workspaces (name, created_by) values ('Fatura da família', auth.uid()) returning id into v_ws;
    insert into public.workspace_settings (workspace_id) values (v_ws) on conflict do nothing;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, auth.uid(), 'owner')
  on conflict do nothing;
  return v_ws;
end;
$$;

revoke all on function public.join_family_workspace() from public;
grant execute on function public.join_family_workspace() to authenticated;

-- Todos os usuários existentes passam a compartilhar o primeiro espaço
insert into public.workspace_members (workspace_id, user_id, role)
select (select id from public.workspaces order by created_at asc limit 1), u.id, 'owner'
from auth.users u
where exists (select 1 from public.workspaces)
on conflict do nothing;

alter table public.workspace_state replica identity full;
alter publication supabase_realtime add table public.workspace_state;