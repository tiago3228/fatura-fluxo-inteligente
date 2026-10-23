import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { forecast, monthInvoices, planAmountAt, planFutureCommitted, planNextMonth, planNumberAt, planRemainingCount, planStatusAt, totalFutureCommitted } from "@/lib/finance/calc";
import { fmtBRL, fmtMonth, fmtMonthLong, round2 } from "@/lib/finance/format";
import type { InstallmentPlan } from "@/lib/finance/types";
import { EmptyState, KpiCard, PageHeader, Panel } from "@/components/app/common";
import { PlanStatusBadge } from "@/components/app/badges";
import { PlanDialog } from "@/components/app/PlanDialog";
import { FilterSelect } from "@/components/app/FilterSelect";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/parcelamentos")({
  head: () => ({
    meta: [
      { title: "Parcelamentos — Fatura em Dia" },
      { name: "description", content: "Compras parceladas, parcelas restantes e previsão de valores futuros comprometidos." },
      { property: "og:title", content: "Parcelamentos — Fatura em Dia" },
      { property: "og:description", content: "Controle de compras parceladas no cartão." },
    ],
  }),
  component: Parcelamentos,
});

function Parcelamentos() {
  const { state, dispatch } = useFinance();
  const m = state.settings.month;
  const [edit, setEdit] = useState<InstallmentPlan | "new" | null>(null);
  const [f, setF] = useState<{ person?: string; card?: string; status?: string }>({});
  const list = state.plans.filter((p) => (!f.card || p.cardId === f.card) && (!f.person || p.shares.some((s) => s.personId === f.person)) && (!f.status || planStatusAt(p, m) === f.status));
  const monthIds = new Set(monthInvoices(state, m).map((i) => i.id));
  const inInvoice = round2(state.transactions.filter((t) => t.type === "parcela" && monthIds.has(t.invoiceId)).reduce((s, t) => s + t.amount, 0));
  const fc = forecast(state, m, 6);
  const maxFc = Math.max(...fc.map((x) => x.value), 1);

  return (
    <>
      <PageHeader title="Parcelamentos" description="Cada compra parcelada é um único compromisso, rastreado mês a mês" showMonth actions={<Button onClick={() => setEdit("new")}><Plus className="size-4" /> Registrar parcelamento</Button>} />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="1. Parcelas na fatura atual" value={fmtBRL(inInvoice)} hint={`Já incluídas no total de ${fmtMonth(m)}`} />
        <KpiCard label="2. Previstas no próximo mês" value={fmtBRL(fc[0]?.value ?? 0)} hint={fmtMonthLong(fc[0]?.month ?? m)} />
        <KpiCard label="3. Total ainda comprometido" value={fmtBRL(totalFutureCommitted(state, m))} hint="Faturas futuras — não somar à atual" />
      </div>

      <Panel className="mt-6">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <FilterSelect label="Pessoa" value={f.person} onChange={(v) => setF({ ...f, person: v })} options={state.people.map((p) => [p.id, p.name])} />
          <FilterSelect label="Cartão" value={f.card} onChange={(v) => setF({ ...f, card: v })} options={state.cards.map((c) => [c.id, `${c.name} •••• ${c.last4}`])} />
          <FilterSelect label="Status" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[["ativo", "Ativo"], ["finalizado", "Finalizado"], ["futuro", "A iniciar"]]} />
          {Object.values(f).some(Boolean) && <Button variant="ghost" size="sm" onClick={() => setF({})}><X className="size-4" /> Limpar</Button>}
        </div>
        {list.length === 0 ? <EmptyState title="Nenhum parcelamento encontrado" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="[&_th]:px-3 [&_th]:py-2.5"><th>Compra</th><th>Cartão</th><th>Responsáveis</th><th className="text-right">Total</th><th className="text-right">Parcela</th><th>Atual</th><th className="text-right">Restantes</th><th>Próximo</th><th className="text-right">Futuro comprometido</th><th>Status</th><th /></tr>
              </thead>
              <tbody className="divide-y">
                {list.map((p) => {
                  const c = state.cards.find((x) => x.id === p.cardId);
                  const n = planNumberAt(p, m);
                  const st = planStatusAt(p, m);
                  const uniform = p.amounts.every((a) => a === p.amounts[0]);
                  const next = planNextMonth(p, m);
                  return (
                    <tr key={p.id} className="hover:bg-muted/40 [&_td]:px-3 [&_td]:py-3">
                      <td className="font-semibold">{p.description}</td>
                      <td className="num text-muted-foreground">•••• {c?.last4}</td>
                      <td>{p.shares.map((s) => `${state.people.find((x) => x.id === s.personId)?.name.split(" ")[0] ?? "?"}${p.shares.length > 1 ? ` ${s.pct}%` : ""}`).join(", ") || "—"}</td>
                      <td className="num text-right">{fmtBRL(p.total)}</td>
                      <td className="num text-right">{st === "ativo" ? fmtBRL(planAmountAt(p, m)) : fmtBRL(p.amounts[0])}{!uniform && <div className="text-xs text-muted-foreground">valores variam</div>}</td>
                      <td className="num">{st === "ativo" ? `${n}/${p.amounts.length}` : st === "futuro" ? `— /${p.amounts.length}` : `${p.amounts.length}/${p.amounts.length}`}</td>
                      <td className="num text-right">{planRemainingCount(p, m)}</td>
                      <td>{next ? fmtMonth(next) : "—"}</td>
                      <td className="num text-right font-semibold">{fmtBRL(planFutureCommitted(p, m))}</td>
                      <td><PlanStatusBadge status={st} /></td>
                      <td>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações para ${p.description}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEdit(p)}><Pencil className="size-4" /> Editar</DropdownMenuItem>
                            <DropdownMenuItem className="text-danger" onSelect={() => { dispatch({ type: "deletePlan", planId: p.id }); toast.success("Parcelamento removido", { description: "Os lançamentos das faturas foram mantidos." }); }}><Trash2 className="size-4" /> Excluir</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="mt-6" title="Previsão mensal de parcelas" description="Valores previstos nas próximas faturas">
        <div className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-6">
          {fc.map((x) => (
            <div key={x.month} className="flex flex-col items-center gap-1">
              <span className="num text-xs font-semibold">{fmtBRL(x.value)}</span>
              <div className="flex h-24 w-full items-end"><div className="w-full rounded-t bg-chart-1" style={{ height: `${(x.value / maxFc) * 100}%` }} /></div>
              <span className="text-xs text-muted-foreground">{fmtMonth(x.month)}</span>
            </div>
          ))}
        </div>
      </Panel>

      {edit && <PlanDialog plan={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
