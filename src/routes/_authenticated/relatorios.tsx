import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useFinance } from "@/lib/finance/store";
import { TX_TYPE_LABEL, addMonths, availableMonths, forecast, invoiceDiff, invoicePendingCount, limitStatus, personMonthTotal, planFutureCommitted, planStatusAt, txCard, txMonth, txStatus } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonth, fmtMonthLong, round2 } from "@/lib/finance/format";
import { personReport, personReportTable } from "@/lib/finance/reports";
import type { ExportTable } from "@/lib/finance/export";
import { KpiCard, PageHeader, Panel } from "@/components/app/common";
import { LimitBadge } from "@/components/app/badges";
import { ExportButtons } from "@/components/app/ExportButtons";
import { FilterSelect } from "@/components/app/FilterSelect";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Fatura em Dia" },
      { name: "description", content: "Relatórios por pessoa, cartão e período, com exportação em CSV, Excel e PDF." },
      { property: "og:title", content: "Relatórios — Fatura em Dia" },
      { property: "og:description", content: "Relatórios de gastos de cartão por pessoa." },
    ],
  }),
  component: Relatorios,
});

const REPORTS = [
  ["consolidado", "Consolidado mensal"], ["pessoa", "Gastos por pessoa"], ["cartao", "Gastos por cartão"], ["periodo", "Por período"], ["pendentes", "Não atribuídas"],
  ["parcelas", "Parcelamentos ativos"], ["previsao", "Previsão futura"], ["limites", "Limites"], ["faturas", "Faturas importadas"], ["individual", "Relatório individual"],
] as const;
type R = (typeof REPORTS)[number][0];

function Relatorios() {
  const { state } = useFinance();
  const months = availableMonths(state);
  const [kind, setKind] = useState<R>("pessoa");
  const [month, setMonth] = useState(state.settings.month);
  const [card, setCard] = useState<string | undefined>();
  const [person, setPerson] = useState<string>(state.people[0]?.id ?? "");
  const [from, setFrom] = useState(`${addMonths(state.settings.month, -2)}-01`);
  const [to, setTo] = useState(`${state.settings.month}-31`);

  const inCard = (t: (typeof state.transactions)[number]) => !card || txCard(state, t)?.id === card;
  const consolidatedInvoices = state.invoices.filter((invoice) => invoice.month === month && (!card || invoice.cardId === card));
  const consolidatedTransactions = state.transactions.filter((transaction) => transaction.type !== "pagamento" && consolidatedInvoices.some((invoice) => invoice.id === transaction.invoiceId));
  const consolidatedOfficial = round2(consolidatedInvoices.reduce((sum, invoice) => sum + invoice.officialTotal, 0));
  const consolidatedLaunches = round2(consolidatedTransactions.reduce((sum, transaction) => sum + transaction.amount, 0));
  const consolidatedAllocated = round2(consolidatedTransactions.reduce((sum, transaction) => sum + transaction.allocations.reduce((subtotal, allocation) => subtotal + allocation.amount, 0), 0));
  const consolidatedPending = consolidatedTransactions.filter((transaction) => txStatus(transaction) === "pendente").length;
  const table = (): ExportTable => {
    switch (kind) {
      case "consolidado": return {
        title: "Consolidado mensal de todos os cartões",
        subtitle: fmtMonthLong(month),
        headers: ["Cartão", "Final", "Total oficial", "Lançamentos", "Atribuído", "Pendentes", "Diferença"],
        rows: state.cards.filter((c) => !card || c.id === card).map((c) => {
          const invoices = state.invoices.filter((invoice) => invoice.cardId === c.id && invoice.month === month);
          const txs = state.transactions.filter((transaction) => transaction.type !== "pagamento" && invoices.some((invoice) => invoice.id === transaction.invoiceId));
          const official = round2(invoices.reduce((sum, invoice) => sum + invoice.officialTotal, 0));
          const launches = round2(txs.reduce((sum, transaction) => sum + transaction.amount, 0));
          const allocated = round2(txs.reduce((sum, transaction) => sum + transaction.allocations.reduce((subtotal, allocation) => subtotal + allocation.amount, 0), 0));
          return [c.name, c.last4, official, txs.length, allocated, txs.filter((transaction) => txStatus(transaction) === "pendente").length, round2(official - launches)];
        }).filter((row) => row[2] !== 0 || row[3] !== 0),
        footer: ["Total geral", "", consolidatedOfficial, consolidatedTransactions.length, consolidatedAllocated, consolidatedPending, round2(consolidatedOfficial - consolidatedLaunches)],
      };
      case "pessoa": return { title: "Gastos por pessoa", subtitle: fmtMonthLong(month), headers: ["Pessoa", "Limite", "Atribuído", "Saldo", "% usado"],
        rows: state.people.map((p) => { const t = round2(state.transactions.filter((x) => txMonth(state, x) === month && inCard(x)).reduce((s, x) => s + x.allocations.filter((a) => a.personId === p.id).reduce((y, a) => y + a.amount, 0), 0)); return [p.name, p.limit, t, round2(p.limit - t), `${Math.round(p.limit ? (t / p.limit) * 100 : 0)}%`]; }) };
      case "cartao": return { title: "Gastos por cartão", subtitle: fmtMonthLong(month), headers: ["Cartão", "Final", "Total oficial", "Lançamentos", "Pendentes"],
        rows: state.cards.filter((c) => !card || c.id === card).map((c) => { const inv = state.invoices.filter((i) => i.cardId === c.id && i.month === month); return [c.name, c.last4, round2(inv.reduce((s, i) => s + i.officialTotal, 0)), inv.reduce((s, i) => s + state.transactions.filter((t) => t.invoiceId === i.id).length, 0), inv.reduce((s, i) => s + invoicePendingCount(state, i), 0)]; }) };
      case "periodo": { const txs = state.transactions.filter((t) => t.date >= from && t.date <= to && inCard(t) && t.type !== "pagamento").sort((a, b) => a.date.localeCompare(b.date));
        return { title: "Lançamentos por período", subtitle: `${fmtDate(from)} a ${fmtDate(to)}`, headers: ["Data", "Descrição", "Cartão", "Tipo", "Valor"], rows: txs.map((t) => [fmtDate(t.date), t.description, txCard(state, t)?.name ?? "", TX_TYPE_LABEL[t.type], t.amount]), footer: ["", "Total", "", "", round2(txs.reduce((s, t) => s + t.amount, 0))] }; }
      case "pendentes": { const txs = state.transactions.filter((t) => txStatus(t) === "pendente" && txMonth(state, t) === month && inCard(t));
        return { title: "Compras não atribuídas", subtitle: fmtMonthLong(month), headers: ["Data", "Descrição", "Cartão", "Valor"], rows: txs.map((t) => [fmtDate(t.date), t.description, txCard(state, t)?.name ?? "", t.amount]), footer: ["", "Total", "", round2(txs.reduce((s, t) => s + t.amount, 0))] }; }
      case "parcelas": return { title: "Parcelamentos ativos", subtitle: fmtMonthLong(month), headers: ["Compra", "Cartão", "Total", "Parcelas", "Futuro comprometido"],
        rows: state.plans.filter((p) => planStatusAt(p, month) === "ativo" && (!card || p.cardId === card)).map((p) => [p.description, state.cards.find((c) => c.id === p.cardId)?.name ?? "", p.total, p.amounts.length, planFutureCommitted(p, month)]) };
      case "previsao": return { title: "Previsão de parcelas futuras", subtitle: `A partir de ${fmtMonthLong(month)}`, headers: ["Mês", "Valor previsto"], rows: forecast(state, month, 12).map((f) => [fmtMonthLong(f.month), f.value]) };
      case "limites": return { title: "Pessoas no limite ou acima", subtitle: fmtMonthLong(month), headers: ["Pessoa", "Limite", "Atribuído", "Situação"],
        rows: state.people.map((p) => ({ p, t: personMonthTotal(state, p.id, month) })).filter(({ p, t }) => limitStatus(t, p.limit, state.settings.warnPct) !== "normal").map(({ p, t }) => [p.name, p.limit, t, limitStatus(t, p.limit, state.settings.warnPct)]) };
      case "faturas": return { title: "Resumo das faturas importadas", headers: ["Cartão", "Mês", "Vencimento", "Total oficial", "Diferença", "Pendentes", "Status"],
        rows: state.invoices.filter((i) => !card || i.cardId === card).sort((a, b) => b.month.localeCompare(a.month)).map((i) => [state.cards.find((c) => c.id === i.cardId)?.name ?? "", fmtMonth(i.month), fmtDate(i.dueDate), i.officialTotal, invoiceDiff(state, i), invoicePendingCount(state, i), i.status]) };
      case "individual": return person ? personReportTable(state, person, month) : { title: "", headers: [], rows: [] };
    }
  };
  const t = table();
  const ind = kind === "individual" && person ? personReport(state, person, month) : null;

  return (
    <>
      <PageHeader title="Relatórios" description="Os arquivos são gerados no navegador a partir dos dados atuais" />
      <Panel>
        <div className="overflow-x-auto border-b p-3">
          <Tabs value={kind} onValueChange={(v) => setKind(v as R)}><TabsList className="h-auto flex-wrap">{REPORTS.map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}</TabsList></Tabs>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b p-3">
          {kind === "periodo" ? (
            <>
              <label className="text-xs">De<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-40" /></label>
              <label className="text-xs">Até<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-40" /></label>
            </>
          ) : kind !== "faturas" && (
            <Select value={month} onValueChange={setMonth}><SelectTrigger className="w-48" aria-label="Mês"><SelectValue /></SelectTrigger><SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{fmtMonthLong(m)}</SelectItem>)}</SelectContent></Select>
          )}
          {kind !== "previsao" && kind !== "limites" && kind !== "individual" && <FilterSelect label="Cartão" value={card} onChange={setCard} options={state.cards.map((c) => [c.id, `${c.name} •••• ${c.last4}`])} />}
          {kind === "individual" && (
            <Select value={person} onValueChange={setPerson}><SelectTrigger className="w-52" aria-label="Pessoa"><SelectValue placeholder="Pessoa" /></SelectTrigger><SelectContent>{state.people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
          )}
          <div className="ml-auto"><ExportButtons table={table} filename={`${kind}-${kind === "periodo" ? `${from}_${to}` : month}`} /></div>
        </div>

        {ind && (
          <div className="grid gap-3 border-b p-4 sm:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Total atribuído" value={fmtBRL(ind.total)} />
            <KpiCard label="Limite mensal" value={fmtBRL(ind.person.limit)} hint={<LimitBadge status={limitStatus(ind.total, ind.person.limit, state.settings.warnPct)} />} />
            <KpiCard label="Saldo restante" value={fmtBRL(round2(ind.person.limit - ind.total))} />
            <KpiCard label="Compras divididas" value={fmtBRL(ind.splitTotal)} />
            <KpiCard label="Parcelas do mês" value={fmtBRL(round2(ind.plans.reduce((s, p) => s + p.monthValue, 0)))} />
            <KpiCard label="Parcelas futuras" value={fmtBRL(round2(ind.plans.reduce((s, p) => s + p.future, 0)))} hint={ind.history.map((h) => `${fmtMonth(h.month)} ${Math.round(h.total)}`).slice(-3).join(" · ")} />
          </div>
        )}

        {kind === "consolidado" && (
          <div className="grid gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total oficial" value={fmtBRL(consolidatedOfficial)} hint={`${consolidatedInvoices.length} fatura(s)`} />
            <KpiCard label="Lançamentos" value={fmtBRL(consolidatedLaunches)} hint={`${consolidatedTransactions.length} compra(s)`} />
            <KpiCard label="Atribuído" value={fmtBRL(consolidatedAllocated)} hint={consolidatedOfficial ? `${Math.round((consolidatedAllocated / consolidatedOfficial) * 100)}% do oficial` : "—"} tone="success" />
            <KpiCard label="Pendentes" value={consolidatedPending} hint="Sem responsável" tone={consolidatedPending ? "warning" : "success"} />
          </div>
        )}

        <div className="p-4">
          <h2 className="text-base font-bold">{t.title}</h2>
          {t.subtitle && <p className="text-xs text-muted-foreground">{t.subtitle}</p>}
          {t.rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum dado para os filtros selecionados.</p> : (
            <div className="mt-3 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr>{t.headers.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody className="divide-y">{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" ? "num px-3 py-2 text-right" : "px-3 py-2"}>{typeof c === "number" && !/Parcelas|Lançamentos|Pendentes/.test(t.headers[j]) ? fmtBRL(c) : c}</td>)}</tr>)}</tbody>
                {t.footer && <tfoot className="border-t bg-muted/40 font-bold"><tr>{t.footer.map((c, j) => <td key={j} className={typeof c === "number" ? "num px-3 py-2 text-right" : "px-3 py-2"}>{typeof c === "number" ? fmtBRL(c) : c}</td>)}</tr></tfoot>}
              </table>
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
