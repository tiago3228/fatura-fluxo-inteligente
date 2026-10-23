import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { invoiceDiff, invoicePendingCount, invoiceTxs, nextOccurrence } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong, round2 } from "@/lib/finance/format";
import { EmptyState, KpiCard, Panel } from "@/components/app/common";
import { InvoiceStatusBadge } from "@/components/app/badges";
import { CardDialog } from "@/components/app/CardDialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/cartoes/$id")({
  head: () => ({
    meta: [
      { title: "Detalhes do cartão — Fatura em Dia" },
      { name: "description", content: "Fatura atual, faturas anteriores, pessoas e próximas datas estimadas do cartão." },
      { property: "og:title", content: "Detalhes do cartão — Fatura em Dia" },
      { property: "og:description", content: "Resumo do cartão de crédito." },
    ],
  }),
  component: CartaoDetalhe,
});

function CartaoDetalhe() {
  const { id } = Route.useParams();
  const { state } = useFinance();
  const [edit, setEdit] = useState(false);
  const c = state.cards.find((x) => x.id === id);
  if (!c) return <EmptyState title="Cartão não encontrado" action={<Button asChild variant="outline"><Link to="/cartoes">Voltar</Link></Button>} />;
  const invs = state.invoices.filter((i) => i.cardId === c.id).sort((a, b) => b.month.localeCompare(a.month));
  const current = invs.find((i) => i.month === state.settings.month) ?? invs[0];
  const totalTx = round2(invs.reduce((s, i) => s + invoiceTxs(state, i.id).filter((t) => t.type !== "pagamento").reduce((a, t) => a + t.amount, 0), 0));
  const userIds = new Set([...state.people.filter((p) => p.cardIds.includes(c.id)).map((p) => p.id), ...invs.flatMap((i) => invoiceTxs(state, i.id).flatMap((t) => t.allocations.map((a) => a.personId)))]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2"><Link to="/cartoes"><ArrowLeft className="size-4" /> Cartões</Link></Button>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">{c.name} <span className="num text-muted-foreground">•••• {c.last4}</span></h1><p className="text-sm text-muted-foreground">{c.issuer}{c.brand && ` · ${c.brand}`} · fecha dia {c.closingDay}, vence dia {c.dueDay}</p></div>
        <Button variant="outline" onClick={() => setEdit(true)}><Pencil className="size-4" /> Editar</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Fatura atual" value={current ? fmtBRL(current.officialTotal) : "—"} hint={current ? fmtMonthLong(current.month) : "Sem faturas"} />
        <KpiCard label="Total de lançamentos" value={fmtBRL(totalTx)} hint={`${invs.length} fatura(s) importadas`} />
        <KpiCard label="Limite de crédito" value={c.creditLimit === undefined ? "—" : fmtBRL(c.creditLimit)} hint={c.creditLimit === undefined ? "Não informado" : "Limite cadastrado"} />
        <KpiCard label="Próximo fechamento" value={fmtDate(nextOccurrence(c.closingDay))} hint="Estimativa pelo calendário" />
        <KpiCard label="Próximo vencimento" value={fmtDate(nextOccurrence(c.dueDay))} hint="Estimativa pelo calendário" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Faturas">
          {invs.length === 0 ? <EmptyState title="Nenhuma fatura" /> : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr className="[&_th]:px-4 [&_th]:py-2"><th>Mês</th><th>Vencimento</th><th className="text-right">Total</th><th className="text-right">Pendentes</th><th>Status</th></tr></thead>
              <tbody className="divide-y">{invs.map((i) => (
                <tr key={i.id} className="hover:bg-muted/40 [&_td]:px-4 [&_td]:py-2.5">
                  <td><Link to="/faturas/$id" params={{ id: i.id }} className="font-semibold hover:underline">{fmtMonthLong(i.month)}</Link></td>
                  <td className="num">{fmtDate(i.dueDate)}</td>
                  <td className="num text-right">{fmtBRL(i.officialTotal)}{invoiceDiff(state, i) !== 0 && <div className="text-xs text-danger">dif. {fmtBRL(invoiceDiff(state, i))}</div>}</td>
                  <td className="num text-right">{invoicePendingCount(state, i)}</td>
                  <td><InvoiceStatusBadge status={i.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
        <Panel title="Pessoas que utilizam">
          <ul className="divide-y text-sm">
            {userIds.size === 0 && <li className="p-4 text-muted-foreground">Ninguém associado.</li>}
            {[...userIds].map((pid) => { const p = state.people.find((x) => x.id === pid); return p ? <li key={pid}><Link to="/pessoas/$id" params={{ id: p.id }} className="block px-4 py-2.5 hover:bg-muted/50">{p.name}</Link></li> : null; })}
          </ul>
        </Panel>
      </div>
      {edit && <CardDialog card={c} onClose={() => setEdit(false)} />}
    </>
  );
}
