import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Scissors,
  Search,
  SlidersHorizontal,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { TX_TYPE_LABEL, monthTxs, txCard, txStatus, availableMonths } from "@/lib/finance/calc";
import { fmtBRL, fmtMonthLong, round2 } from "@/lib/finance/format";
import type { TxType } from "@/lib/finance/types";
import { KpiCard, PageHeader, Panel } from "@/components/app/common";
import { TransactionTable } from "@/components/app/TransactionTable";
import { useTxActions } from "@/components/app/tx-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterSelect, ALL } from "@/components/app/FilterSelect";
import { PURCHASE_CATEGORIES } from "@/lib/finance/categories";

type Search = {
  status?: string;
  person?: string;
  card?: string;
  last4?: string;
  type?: string;
  category?: string;
  q?: string;
  month?: string;
  assignTo?: string;
};

export const Route = createFileRoute("/_authenticated/compras")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    status: typeof s["status"] === "string" ? s["status"] : undefined,
    person: typeof s["person"] === "string" ? s["person"] : undefined,
    card: typeof s["card"] === "string" ? s["card"] : undefined,
    last4: typeof s["last4"] === "string" ? s["last4"] : undefined,
    type: typeof s["type"] === "string" ? s["type"] : undefined,
    category: typeof s["category"] === "string" ? s["category"] : undefined,
    q: typeof s["q"] === "string" ? s["q"] : undefined,
    month: typeof s["month"] === "string" ? s["month"] : undefined,
    assignTo: typeof s["assignTo"] === "string" ? s["assignTo"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Compras — Fatura em Dia" },
      {
        name: "description",
        content:
          "Consulte, filtre e classifique as compras dos cartões, atribuindo ou dividindo entre pessoas.",
      },
      { property: "og:title", content: "Compras — Fatura em Dia" },
      { property: "og:description", content: "Classifique compras por pessoa em poucos cliques." },
    ],
  }),
  component: Compras,
});

function Compras() {
  const { state, dispatch } = useFinance();
  const search = Route.useSearch();
  const assignPerson = search.assignTo
    ? state.people.find((p) => p.id === search.assignTo)
    : undefined;
  const navigate = useNavigate({ from: "/compras" });
  const { openAssign, openCreate, openSplit, unassign } = useTxActions();
  const [selected, setSelected] = useState<string[]>([]);
  const [showPersonTotals, setShowPersonTotals] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const month = search.month ?? state.settings.month;
  const set = (patch: Partial<Search>) =>
    navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });

  const base = month === ALL ? state.transactions : monthTxs(state, month);
  const q = (search.q ?? "").toLowerCase();
  const txs = base.filter((t) => {
    if (q && !t.description.toLowerCase().includes(q)) return false;
    if (search.status && txStatus(t) !== search.status) return false;
    if (search.person && !t.allocations.some((a) => a.personId === search.person)) return false;
    if (search.card && txCard(state, t)?.id !== search.card) return false;
    if (search.last4 && txCard(state, t)?.last4 !== search.last4) return false;
    if (search.type && t.type !== search.type) return false;
    if (search.category === "__none" && t.category) return false;
    if (search.category && search.category !== "__none" && t.category !== search.category)
      return false;
    return true;
  });
  const hasFilters = !!(
    search.q ||
    search.status ||
    search.person ||
    search.card ||
    search.last4 ||
    search.type ||
    search.category ||
    search.month
  );
  const activeFilterCount = [
    search.month,
    search.person,
    search.card,
    search.last4,
    search.status,
    search.type,
    search.category,
  ].filter(Boolean).length;
  const selValid = selected.filter((id) => txs.some((t) => t.id === id));
  const total = round2(
    txs.filter((t) => t.type !== "pagamento").reduce((sum, t) => sum + t.amount, 0),
  );
  const pending = txs.filter((t) => txStatus(t) === "pendente").length;
  const split = txs.filter((t) => txStatus(t) === "dividida").length;
  const personTotals = state.people
    .map((person) => ({
      person,
      total: round2(
        txs.reduce(
          (sum, tx) =>
            sum +
            tx.allocations
              .filter((a) => a.personId === person.id)
              .reduce((sub, a) => sub + a.amount, 0),
          0,
        ),
      ),
    }))
    .filter(({ total: value }) => value !== 0);

  return (
    <>
      <PageHeader
        title="Compras"
        description="Selecione lançamentos e direcione para a pessoa responsável"
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Nova compra
          </Button>
        }
      />

      <Panel>
        <div className="space-y-3 border-b p-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar descrição…"
                className="pl-9"
                value={search.q ?? ""}
                onChange={(e) => set({ q: e.target.value || undefined })}
                aria-label="Buscar por descrição"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="md:hidden"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-controls="mobile-purchase-filters"
            >
              <SlidersHorizontal className="size-4" /> Filtros
              {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
          </div>
          <div
            id="mobile-purchase-filters"
            className={filtersOpen ? "grid grid-cols-1 gap-2 sm:grid-cols-2 md:hidden" : "hidden"}
          >
            <FilterSelect
              label="Período"
              value={month}
              onChange={(v) => set({ month: v === state.settings.month ? undefined : v })}
              options={[
                [ALL, "Todos os meses"],
                ...availableMonths(state).map((m) => [m, fmtMonthLong(m)] as [string, string]),
              ]}
              noAll
            />
            <FilterSelect
              label="Pessoa"
              value={search.person}
              onChange={(v) => set({ person: v })}
              options={state.people.map((p) => [p.id, p.name])}
            />
            <FilterSelect
              label="Cartão"
              value={search.card}
              onChange={(v) => set({ card: v })}
              options={state.cards.map((c) => [c.id, `${c.name} •••• ${c.last4}`])}
            />
            <FilterSelect
              label="Final do cartão"
              value={search.last4}
              onChange={(v) => set({ last4: v })}
              options={state.cards.map((c) => [c.last4, `Final •••• ${c.last4}`])}
            />
            <FilterSelect
              label="Status"
              value={search.status}
              onChange={(v) => set({ status: v })}
              options={[
                ["pendente", "Pendentes de direcionamento"],
                ["atribuida", "Atribuída"],
                ["dividida", "Dividida"],
                ["nao_aplica", "Não se aplica"],
              ]}
            />
            <FilterSelect
              label="Tipo"
              value={search.type}
              onChange={(v) => set({ type: v })}
              options={(Object.keys(TX_TYPE_LABEL) as TxType[]).map((k) => [k, TX_TYPE_LABEL[k]])}
            />
            <FilterSelect
              label="Categoria"
              value={search.category}
              onChange={(v) => set({ category: v })}
              options={[
                ["__none", "Sem categoria"],
                ...PURCHASE_CATEGORIES.map((category) => [category, category] as [string, string]),
              ]}
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => navigate({ search: {}, replace: true })}
              >
                <X className="size-4" /> Limpar filtros
              </Button>
            )}
          </div>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <FilterSelect
              label="Período"
              value={month}
              onChange={(v) => set({ month: v === state.settings.month ? undefined : v })}
              options={[
                [ALL, "Todos os meses"],
                ...availableMonths(state).map((m) => [m, fmtMonthLong(m)] as [string, string]),
              ]}
              noAll
            />
            <FilterSelect
              label="Pessoa"
              value={search.person}
              onChange={(v) => set({ person: v })}
              options={state.people.map((p) => [p.id, p.name])}
            />
            <FilterSelect
              label="Cartão"
              value={search.card}
              onChange={(v) => set({ card: v })}
              options={state.cards.map((c) => [c.id, `${c.name} •••• ${c.last4}`])}
            />
            <FilterSelect
              label="Final do cartão"
              value={search.last4}
              onChange={(v) => set({ last4: v })}
              options={state.cards.map((c) => [c.last4, `Final •••• ${c.last4}`])}
            />
            <FilterSelect
              label="Status"
              value={search.status}
              onChange={(v) => set({ status: v })}
              options={[
                ["pendente", "Pendentes de direcionamento"],
                ["atribuida", "Atribuída"],
                ["dividida", "Dividida"],
                ["nao_aplica", "Não se aplica"],
              ]}
            />
            <FilterSelect
              label="Tipo"
              value={search.type}
              onChange={(v) => set({ type: v })}
              options={(Object.keys(TX_TYPE_LABEL) as TxType[]).map((k) => [k, TX_TYPE_LABEL[k]])}
            />
            <FilterSelect
              label="Categoria"
              value={search.category}
              onChange={(v) => set({ category: v })}
              options={[
                ["__none", "Sem categoria"],
                ...PURCHASE_CATEGORIES.map((category) => [category, category] as [string, string]),
              ]}
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ search: {}, replace: true })}
              >
                <X className="size-4" /> Limpar
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 border-b p-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total exibido"
            value={fmtBRL(total)}
            hint={`${txs.length} lançamento(s)`}
          />
          <KpiCard
            label="Pendentes"
            value={pending}
            hint="Aguardando direcionamento"
            tone={pending > 0 ? "warning" : "success"}
          />
          <KpiCard label="Divididas" value={split} hint="Compras compartilhadas" />
          <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setShowPersonTotals((visible) => !visible)}
              aria-expanded={showPersonTotals}
              aria-controls="person-totals-list"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Por pessoa
              </span>
              {showPersonTotals ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </button>
            {showPersonTotals ? (
              personTotals.length === 0 ? (
                <p id="person-totals-list" className="mt-2 text-sm text-muted-foreground">
                  Nenhum direcionamento no período.
                </p>
              ) : (
                <div
                  id="person-totals-list"
                  className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-1"
                >
                  {personTotals.map(({ person, total: value }) => (
                    <div
                      key={person.id}
                      className="flex min-w-0 items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-muted-foreground">
                        {person.name.split(" ")[0]}
                      </span>
                      <span className="num shrink-0 font-semibold">{fmtBRL(value)}</span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p className="mt-2 text-sm font-semibold">
                {personTotals.length ? `${personTotals.length} pessoa(s)` : "Nenhum direcionamento"}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Clique para {showPersonTotals ? "recolher" : "ver os totais"}
            </p>
          </div>
        </div>

        {assignPerson && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/10 px-3 py-2 text-sm">
            <UserCheck className="size-4 text-primary" />
            <span>
              Atribuindo compras para <strong>{assignPerson.name}</strong> — use os filtros, marque
              as compras e clique em “Atribuir a {assignPerson.name.split(" ")[0]}”.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => set({ assignTo: undefined })}
            >
              <X className="size-4" /> Sair do modo
            </Button>
          </div>
        )}

        {selValid.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-accent/60 px-3 py-2 text-sm fade-in-up">
            <span className="font-semibold">{selValid.length} selecionado(s)</span>
            {assignPerson && (
              <Button
                size="sm"
                onClick={() => {
                  dispatch({ type: "allocate", txIds: selValid, personId: assignPerson.id });
                  toast.success(`${selValid.length} compra(s) atribuída(s) a ${assignPerson.name}`);
                  setSelected([]);
                }}
              >
                <UserCheck className="size-4" /> Atribuir a {assignPerson.name.split(" ")[0]}
              </Button>
            )}
            <Button
              size="sm"
              variant={assignPerson ? "outline" : "default"}
              onClick={() => openAssign(selValid)}
            >
              <UserCheck className="size-4" /> Direcionar para pessoa
            </Button>
            {selValid.length === 1 && (
              <Button size="sm" variant="outline" onClick={() => openSplit(selValid[0] ?? "")}>
                <Scissors className="size-4" /> Dividir compra
              </Button>
            )}
            <Select
              onValueChange={(value) => {
                const category = value === "__none" ? undefined : value;
                dispatch({ type: "setTransactionCategory", txIds: selValid, category });
                toast.success(`${selValid.length} compra(s) categorizada(s)`, {
                  description: category ?? "As compras ficaram sem categoria.",
                });
                setSelected([]);
              }}
            >
              <SelectTrigger className="h-9 w-auto min-w-40" aria-label="Aplicar categoria">
                <SelectValue placeholder="Aplicar categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Sem categoria</SelectItem>
                {PURCHASE_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                unassign(selValid);
                setSelected([]);
              }}
            >
              <UserX className="size-4" /> Remover atribuição
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Limpar seleção
            </Button>
          </div>
        )}

        <TransactionTable
          txs={txs}
          selectable
          selected={selValid}
          onSelectedChange={setSelected}
          emptyTitle="Nenhuma compra encontrada"
          emptyDescription={
            hasFilters
              ? "Ajuste ou limpe os filtros para ver mais lançamentos."
              : "Importe uma fatura para começar."
          }
        />
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {txs.length} lançamento(s) · dica: clique com o botão direito em uma linha para ver as
          ações
        </p>
      </Panel>
    </>
  );
}
