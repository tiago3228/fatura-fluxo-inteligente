-- Fatura Flow Studio — schema compartilhado para Supabase
--
-- Modelo de acesso:
-- 1. Cada pessoa usa sua própria conta no Supabase Auth.
-- 2. A primeira pessoa autenticada recebe um workspace privado.
-- 3. Somente membros explicitamente associados compartilham seus dados.
-- 4. A aplicação salva o documento financeiro em workspace_state com revisão CAS.
--
-- Segurança:
-- - Nenhuma tabela fica acessível anonimamente.
-- - Todas as tabelas têm RLS habilitado.
-- - Um usuário só enxerga dados de workspaces dos quais é membro.
-- - O modelo já suporta contas individuais no futuro, sem refazer as tabelas.
-- Para bancos existentes que aplicaram a migration 0003, aplique a migration Drizzle 0005
-- como upgrade; ela arquiva associações automáticas antigas e isola as contas sem apagar dados.

begin;

create extension if not exists pgcrypto;

create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Funções auxiliares
-- -----------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Núcleo do workspace e usuários
-- -----------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  reference_month text not null default to_char(current_date, 'YYYY-MM')
    check (reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  warn_pct numeric(5,2) not null default 80 check (warn_pct >= 1 and warn_pct <= 100),
  compact boolean not null default false,
  csv_separator text not null default ';' check (csv_separator in (';', ',')),
  duplicate_check boolean not null default true,
  persist boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Documento financeiro sincronizado pelo cliente com revisão otimista.
create table if not exists public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.workspace_state replica identity full;
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

-- -----------------------------------------------------------------------------
-- Pessoas e cartões
-- -----------------------------------------------------------------------------

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  monthly_limit numeric(14,2) not null default 0 check (monthly_limit >= 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id)
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  issuer text not null check (char_length(trim(issuer)) between 1 and 120),
  brand text,
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id)
);

alter table public.cards
  add column if not exists credit_limit numeric(14,2) check (credit_limit is null or credit_limit > 0);

create table if not exists public.person_cards (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  primary key (person_id, card_id)
);

-- -----------------------------------------------------------------------------
-- Faturas e lançamentos
-- -----------------------------------------------------------------------------

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete restrict,
  reference_month text not null check (reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  due_date date not null,
  official_total numeric(14,2) not null check (official_total >= 0),
  status text not null default 'em_revisao' check (status in ('conferida', 'em_revisao', 'inconsistente')),
  payments jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array'),
  source text not null default 'pdf' check (source in ('demo', 'pdf', 'pdf_demo', 'planilha')),
  original_filename text,
  imported_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  transaction_date date not null,
  description text not null check (char_length(trim(description)) between 1 and 300),
  amount numeric(14,2) not null,
  transaction_type text not null check (transaction_type in ('compra', 'parcela', 'pagamento', 'credito', 'estorno', 'tarifa', 'ajuste')),
  plan_id uuid,
  installment_number integer check (installment_number is null or installment_number >= 1),
  installment_total integer check (installment_total is null or installment_total >= 1),
  adjustment_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id)
);

create table if not exists public.transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  amount numeric(14,2) not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (transaction_id, person_id)
);

-- -----------------------------------------------------------------------------
-- Parcelamentos
-- -----------------------------------------------------------------------------

create table if not exists public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 1 and 300),
  card_id uuid not null references public.cards(id) on delete restrict,
  purchase_date date not null,
  total numeric(14,2) not null check (total > 0),
  installment_amounts jsonb not null default '[]'::jsonb,
  first_month text not null check (first_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  check (jsonb_typeof(installment_amounts) = 'array')
);

create table if not exists public.installment_plan_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.installment_plans(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  percentage numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  unique (plan_id, person_id)
);

alter table public.transactions
  drop constraint if exists transactions_plan_id_fkey;

alter table public.transactions
  add constraint transactions_plan_id_fkey
  foreign key (plan_id) references public.installment_plans(id) on delete set null;

-- SECURITY DEFINER evita a recursão de RLS ao consultar workspace_members.
create or replace function app.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

revoke all on function app.is_workspace_member(uuid) from public;
grant execute on function app.is_workspace_member(uuid) to authenticated;

-- Cria o workspace e associa o usuário autenticado como owner.
-- Execute pelo cliente autenticado ou no SQL Editor substituindo auth.uid()
-- somente para testes. No aplicativo, use supabase.rpc('create_workspace', ...).
create or replace function public.create_workspace(p_name text)
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

  if nullif(trim(p_name), '') is null then
    raise exception 'Nome do workspace é obrigatório';
  end if;

  insert into public.workspaces (name, created_by)
  values (trim(p_name), auth.uid())
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, auth.uid(), 'owner');

  insert into public.workspace_settings (workspace_id)
  values (v_workspace_id);

  return v_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

-- Retorna membership existente; contas sem vínculo recebem workspace privado.
create or replace function public.ensure_user_workspace()
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text), 0);
  select wm.workspace_id into v_workspace_id
    from public.workspace_members wm
   where wm.user_id = auth.uid()
   order by wm.created_at asc
   limit 1;
  if v_workspace_id is not null then return v_workspace_id; end if;
  return public.create_workspace('Fatura da família');
end;
$$;
revoke all on function public.ensure_user_workspace() from public, anon;
grant execute on function public.ensure_user_workspace() to authenticated;

-- Compatibilidade com clientes antigos: nunca adiciona uma conta nova a um workspace global.
create or replace function public.join_family_workspace()
returns uuid
language sql
security definer
set search_path = public, app
as $$ select public.ensure_user_workspace(); $$;
revoke all on function public.join_family_workspace() from public, anon;
grant execute on function public.join_family_workspace() to authenticated;

-- Gravação atômica: divergências de revisão retornam o estado remoto para resolução explícita.
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
  if auth.uid() is null then raise exception 'Usuário não autenticado'; end if;
  if p_expected_revision < 0 or p_data is null then raise exception 'Revisão ou estado inválido'; end if;
  insert into public.workspace_state (workspace_id, data, revision)
  values (p_workspace_id, p_data, 1)
  on conflict (workspace_id) do nothing;
  if found then
    if p_expected_revision <> 0 then raise exception 'Revisão inicial inválida'; end if;
    return query select true, 1::bigint, p_data;
    return;
  end if;
  select ws.revision, ws.data into v_revision, v_data
    from public.workspace_state ws
   where ws.workspace_id = p_workspace_id
   for update;
  if not found then raise exception 'Workspace inexistente ou sem permissão'; end if;
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


-- -----------------------------------------------------------------------------
-- Índices para sincronização e consultas do aplicativo
-- -----------------------------------------------------------------------------

create index if not exists idx_workspace_members_user on public.workspace_members(user_id);
create index if not exists idx_people_workspace on public.people(workspace_id);
create index if not exists idx_cards_workspace on public.cards(workspace_id);
alter table public.invoices add column if not exists payments jsonb not null default '[]'::jsonb;

create index if not exists idx_invoices_workspace_month on public.invoices(workspace_id, reference_month desc);
create index if not exists idx_transactions_invoice_date on public.transactions(invoice_id, transaction_date);
create index if not exists idx_transactions_workspace on public.transactions(workspace_id);
create index if not exists idx_allocations_transaction on public.transaction_allocations(transaction_id);
create index if not exists idx_plans_workspace on public.installment_plans(workspace_id);
create index if not exists idx_plan_shares_plan on public.installment_plan_shares(plan_id);

create table if not exists public.minigame_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  score integer not null,
  correct_answers integer not null default 0 check (correct_answers >= 0),
  wrong_answers integer not null default 0 check (wrong_answers >= 0),
  timed_mode boolean not null default false,
  mode text not null default 'free' check (mode in ('free', 'timed', 'challenge')),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null default now()
);
create index if not exists minigame_scores_ranking_idx
  on public.minigame_scores(score desc, created_at asc);

-- updated_at automático
 drop trigger if exists trg_workspaces_updated_at on public.workspaces;
 create trigger trg_workspaces_updated_at before update on public.workspaces for each row execute function app.set_updated_at();
 drop trigger if exists trg_workspace_settings_updated_at on public.workspace_settings;
 create trigger trg_workspace_settings_updated_at before update on public.workspace_settings for each row execute function app.set_updated_at();
 drop trigger if exists trg_people_updated_at on public.people;
 create trigger trg_people_updated_at before update on public.people for each row execute function app.set_updated_at();
 drop trigger if exists trg_cards_updated_at on public.cards;
 create trigger trg_cards_updated_at before update on public.cards for each row execute function app.set_updated_at();
 drop trigger if exists trg_invoices_updated_at on public.invoices;
 create trigger trg_invoices_updated_at before update on public.invoices for each row execute function app.set_updated_at();
 drop trigger if exists trg_transactions_updated_at on public.transactions;
 create trigger trg_transactions_updated_at before update on public.transactions for each row execute function app.set_updated_at();
 drop trigger if exists trg_installment_plans_updated_at on public.installment_plans;
 create trigger trg_installment_plans_updated_at before update on public.installment_plans for each row execute function app.set_updated_at();
 drop trigger if exists trg_workspace_state_updated_at on public.workspace_state;
 create trigger trg_workspace_state_updated_at before update on public.workspace_state for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS e políticas
-- -----------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.workspace_state enable row level security;
alter table public.people enable row level security;
alter table public.cards enable row level security;
alter table public.person_cards enable row level security;
alter table public.invoices enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_allocations enable row level security;
alter table public.installment_plans enable row level security;
alter table public.installment_plan_shares enable row level security;
alter table public.minigame_scores enable row level security;

-- O usuário só pode listar os workspaces dos quais participa.
drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces for select to authenticated
using (app.is_workspace_member(id));

-- A função create_workspace faz a criação inicial com SECURITY DEFINER.
drop policy if exists workspaces_update_member on public.workspaces;
create policy workspaces_update_member on public.workspaces for update to authenticated
using (app.is_workspace_member(id)) with check (app.is_workspace_member(id));

-- Cada usuário só lê seu próprio vínculo. A associação inicial é criada pela função.
drop policy if exists workspace_members_select_self on public.workspace_members;
create policy workspace_members_select_self on public.workspace_members for select to authenticated
using (user_id = auth.uid());

-- Settings: uma linha por workspace.
drop policy if exists workspace_settings_member_all on public.workspace_settings;
create policy workspace_settings_member_all on public.workspace_settings for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists workspace_state_member_all on public.workspace_state;
create policy workspace_state_member_all on public.workspace_state for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

-- Políticas CRUD idênticas nas entidades compartilhadas.
drop policy if exists people_member_all on public.people;
create policy people_member_all on public.people for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists cards_member_all on public.cards;
create policy cards_member_all on public.cards for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists person_cards_member_all on public.person_cards;
create policy person_cards_member_all on public.person_cards for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists invoices_member_all on public.invoices;
create policy invoices_member_all on public.invoices for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists transactions_member_all on public.transactions;
create policy transactions_member_all on public.transactions for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists allocations_member_all on public.transaction_allocations;
create policy allocations_member_all on public.transaction_allocations for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists plans_member_all on public.installment_plans;
create policy plans_member_all on public.installment_plans for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists plan_shares_member_all on public.installment_plan_shares;
create policy plan_shares_member_all on public.installment_plan_shares for all to authenticated
using (app.is_workspace_member(workspace_id))
with check (app.is_workspace_member(workspace_id));

drop policy if exists minigame_scores_select_authenticated on public.minigame_scores;
create policy minigame_scores_select_authenticated on public.minigame_scores for select to authenticated
using (true);

drop policy if exists minigame_scores_insert_own on public.minigame_scores;
create policy minigame_scores_insert_own on public.minigame_scores for insert to authenticated
with check (user_id = auth.uid());

-- Não exponha tabelas diretamente ao papel anon.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke update, delete on public.minigame_scores from authenticated;
grant usage on schema app to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- Teste pós-execução (rode após criar o usuário no Auth e fazer login):
-- select public.create_workspace('Fatura da família');
-- select * from public.workspaces;
-- -----------------------------------------------------------------------------
