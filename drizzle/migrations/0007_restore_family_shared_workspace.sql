create or replace function public.ensure_user_workspace()
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;
  perform pg_advisory_xact_lock(hashtext('family_workspace'), 0);
  select w.id into v_workspace_id from public.workspaces w order by w.created_at asc, w.id asc limit 1;
  if v_workspace_id is null then
    return public.create_workspace('Fatura da família');
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, auth.uid(), 'member')
  on conflict do nothing;
  return v_workspace_id;
end;
$$;
revoke all on function public.ensure_user_workspace() from public, anon;
grant execute on function public.ensure_user_workspace() to authenticated;

insert into public.workspace_members (workspace_id, user_id, role, created_at)
select l.workspace_id, l.user_id, l.role, l.created_at
  from app.legacy_workspace_memberships l
on conflict do nothing;