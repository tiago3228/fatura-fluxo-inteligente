-- Evita sobrescrita silenciosa de alterações concorrentes entre dispositivos.
alter table public.workspace_state
  add column if not exists revision bigint not null default 0 check (revision >= 0);
alter table public.workspace_state replica identity full;
-- RLS autoriza os membros; estes grants concedem apenas o privilégio SQL
-- necessário para a leitura e para a RPC invoker. A role anon segue bloqueada.
revoke all on table public.workspace_state from public, anon;
grant select, insert, update on table public.workspace_state to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'workspace_state'
     ) then
    alter publication supabase_realtime add table public.workspace_state;
  end if;
end;
$$;

-- A migration 0003 associou todas as contas ao workspace mais antigo.
-- Preserve a associação como trilha privada e retire acesso cruzado; o JSON financeiro
-- permanece intacto no workspace original, pertencente ao seu criador.
create schema if not exists app;
create table if not exists app.legacy_workspace_memberships (
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null,
  created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
revoke all on table app.legacy_workspace_memberships from public, anon, authenticated;

do $$
declare
  v_legacy_workspace_id uuid;
  v_owner_id uuid;
begin
  select w.id, w.created_by
    into v_legacy_workspace_id, v_owner_id
    from public.workspaces w
   order by w.created_at asc, w.id asc
   limit 1;

  if v_legacy_workspace_id is not null then
    insert into app.legacy_workspace_memberships
      (workspace_id, user_id, role, created_at)
    select wm.workspace_id, wm.user_id, wm.role, coalesce(wm.created_at, now())
      from public.workspace_members wm
     where wm.workspace_id = v_legacy_workspace_id
       and wm.user_id <> v_owner_id
    on conflict (workspace_id, user_id) do nothing;

    delete from public.workspace_members wm
     where wm.workspace_id = v_legacy_workspace_id
       and wm.user_id <> v_owner_id;
  end if;
end;
$$;

create or replace function public.save_workspace_state(
  p_workspace_id uuid,
  p_expected_revision bigint,
  p_data jsonb
)
returns table(saved boolean, revision bigint, data jsonb)
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_revision bigint;
  v_data jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;
  if p_expected_revision < 0 or p_data is null then
    raise exception 'Revisão ou estado inválido';
  end if;

  -- A primeira escrita cria a linha somente se ela ainda não existir.
  insert into public.workspace_state (workspace_id, data, revision)
  values (p_workspace_id, p_data, 1)
  on conflict (workspace_id) do nothing;
  if found then
    if p_expected_revision <> 0 then
      raise exception 'Revisão inicial inválida';
    end if;
    return query select true, 1::bigint, p_data;
    return;
  end if;

  select ws.revision, ws.data
    into v_revision, v_data
    from public.workspace_state ws
   where ws.workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'Workspace inexistente ou sem permissão';
  end if;

  if v_revision <> p_expected_revision then
    return query select false, v_revision, v_data;
    return;
  end if;

  update public.workspace_state ws
     set data = p_data, revision = v_revision + 1
   where ws.workspace_id = p_workspace_id;
  return query select true, v_revision + 1, p_data;
end;
$$;

revoke all on function public.save_workspace_state(uuid, bigint, jsonb) from public, anon;
grant execute on function public.save_workspace_state(uuid, bigint, jsonb) to authenticated;

-- Contas sem vínculo mantêm espaço próprio. Membros existentes continuam no mesmo workspace.
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

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text), 0);

  select wm.workspace_id
    into v_workspace_id
    from public.workspace_members wm
   where wm.user_id = auth.uid()
   order by wm.created_at asc
   limit 1;

  if v_workspace_id is not null then
    return v_workspace_id;
  end if;

  return public.create_workspace('Fatura da família');
end;
$$;

revoke all on function public.ensure_user_workspace() from public, anon;
grant execute on function public.ensure_user_workspace() to authenticated;

-- Atualiza também a RPC antiga para que clientes antigos deixem de associar contas novas globalmente.
create or replace function public.join_family_workspace()
returns uuid
language sql
security definer
set search_path = public, app
as $$
  select public.ensure_user_workspace();
$$;

revoke all on function public.join_family_workspace() from public, anon;
grant execute on function public.join_family_workspace() to authenticated;