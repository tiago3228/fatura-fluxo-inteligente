import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CalendarClock, CircleDollarSign, CreditCard as CardIcon, Download, Info, TrendingUp, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useFinance } from "@/lib/finance/store";
import { useAlerts } from "@/lib/finance/alerts";
import {
  addMonths,
  forecast,
  invoiceAllocatedTotal,
  invoiceLaunchesTotal,
  limitStatus,
  monthInvoices,
  monthTxs,
  personMonthTotal,
  sortPeopleBySpending,
  totalCardLimit,
  totalCardLimitAvailable,
  totalCardLimitUsed,
  totalFutureCommitted,
  txCard,
  txStatus,
} from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong, round2 } from "@/lib/finance/format";
import { exportPDF, type ExportTable } from "@/lib/finance/export";
import { KpiCard, LimitBar, PageHeader, Panel } from "@/components/app/common";
import { LimitBadge } from "@/components/app/badges";
import { TransactionTable } from "@/components/app/TransactionTable";
import { CardLimitDialog } from "@/components/app/CardLimitDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Visão geral — Fatura em Dia" },
      { name: "description", content: "Panorama do mês: total das faturas, compras atribuídas, pendências, parcelas futuras e limites." },
      { property: "og:title", content: "Visão geral — Fatura em Dia" },
      { property: "og:description", content: "Panorama financeiro mensal dos seus cartões de crédito." },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { state } = useFinance();
  const m = state.settings.month;
  const sharedCardLimit = totalCardLimit(state);
  const sharedCardLimitUsed = totalCardLimitUsed(state);
  const sharedCardLimitAvailable = totalCardLimitAvailable(state);
  const invs = monthInvoices(state, m);
  const official = round2(invs.reduce((s, i) => s + i.officialTotal, 0));
  const launches = round2(invs.reduce((s, i) => s + invoiceLaunchesTotal(state, i), 0));
  const allocated = round2(invs.reduce((s, i) => s + invoiceAllocatedTotal(state, i), 0));
  const pending = monthTxs(state, m).filter((t) => txStatus(t) === "pendente");
  const pendingTotal = round2(pending.reduce((s, t) => s + t.amount, 0));
  const future = totalFutureCommitted(state, m);
  const nextMonth = addMonths(m, 1);
  const nextMonthInvoices = monthInvoices(state, nextMonth);
  const nextMonthTxs = monthTxs(state, nextMonth).filter((t) => t.type !== "pagamento");
  const nextMonthExpected = round2(forecast(state, m, 1)[0]?.value ?? 0);
  const nextMonthActual = round2(nextMonthTxs.reduce((sum, transaction) => sum + transaction.amount, 0));
  const nextMonthExtra = round2(Math.max(0, nextMonthActual - nextMonthExpected));
  const evolution = forecast(state, m, 6).map((item, index) => {
    const targetMonth = addMonths(m, index + 1);
    const actual = round2(monthTxs(state, targetMonth).filter((transaction) => transaction.type !== "pagamento").reduce((sum, transaction) => sum + transaction.amount, 0));
    return { month: fmtMonthLong(targetMonth).split(" de ")[0], previsto: item.value, novos: round2(Math.max(0, actual - item.value)) };
  });
  const chartConfig = {
    previsto: { label: "Previsto", color: "hsl(var(--primary))" },
    novos: { label: "Gastos novos", color: "hsl(var(--warning))" },
  } satisfies ChartConfig;
  const [showExtra, setShowExtra] = useState(false);
  const [showCardLimit, setShowCardLimit] = useState(false);
  const people = state.people.filter((p) => p.active).map((p) => ({ ...p, total: personMonthTotal(state, p.id, m) }));
  const peopleBySpending = sortPeopleBySpending(people);
  const nextPeopleSummary = people.map((person) => {
    const actual = personMonthTotal(state, person.id, nextMonth);
    const expected = forecast(state, m, 1, person.id)[0]?.value ?? 0;
    const transactions = nextMonthTxs.filter((transaction) => transaction.allocations.some((allocation) => allocation.personId === person.id));
    return { ...person, extra: round2(Math.max(0, actual - expected)), actual: round2(actual), expected: round2(expected), transactions };
  });
  const extraByPerson = nextPeopleSummary.filter((person) => person.extra > 0);
  const personNextMonthTable = (person: typeof people[number]): ExportTable => {
    const summary = nextPeopleSummary.find((item) => item.id === person.id)!;
    return {
      title: `Resumo do próximo mês — ${person.name}`,
      subtitle: `${fmtMonthLong(nextMonth)} · previsto ${fmtBRL(summary.expected)} · gastos novos ${fmtBRL(summary.extra)}`,
      headers: ["Data", "Descrição", "Parcela", "Cartão", "Valor a pagar"],
      rows: summary.transactions.map((transaction) => [
        fmtDate(transaction.date),
        transaction.description,
        transaction.installmentNumber ? `${transaction.installmentNumber}/${transaction.installmentTotal ?? "?"}` : "—",
        txCard(state, transaction)?.last4 ?? "—",
        transaction.allocations.find((allocation) => allocation.personId === person.id)?.amount ?? 0,
      ]),
      footer: ["", "Total da pessoa", "", "", summary.actual],
    };
  };
  const atRisk = people.filter((p) => limitStatus(p.total, p.limit, state.settings.warnPct) !== "normal");
  const alerts = useAlerts();

  return (
    <>
      <PageHeader title="Visão geral" description={`Panorama de ${fmtMonthLong(m)}`} showMonth />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Total das faturas" value={fmtBRL(official)} hint={`${invs.length} fatura(s) · lançamentos ${fmtBRL(launches)}`} icon={<CircleDollarSign />} />
        <KpiCard label="Atribuído a pessoas" value={fmtBRL(allocated)} hint={official ? `${Math.round((allocated / official) * 100)}% do total oficial` : "—"} icon={<UserCheck />} tone="success" />
        <KpiCard label="A identificar" value={pending.length} hint={`${fmtBRL(pendingTotal)} sem responsável`} icon={<UserX />} tone={pending.length ? "warning" : "success"} />
        <KpiCard label="Parcelas futuras" value={fmtBRL(future)} hint="Não somado à fatura atual" icon={<CalendarClock />} />
        <KpiCard label="Perto ou acima do limite" value={atRisk.length} hint={`de ${people.length} pessoas ativas`} icon={<Users />} tone={atRisk.some((p) => p.total > p.limit) ? "danger" : atRisk.length ? "warning" : "success"} />
      </div>

      <Panel
        className="mt-6"
        title="Limite total dos cartões"
        description="Disponível = limite total menos faturas em aberto e parcelas futuras conhecidas; compras pagas não são descontadas novamente."
        actions={
          <Button
            onClick={() => setShowCardLimit(true)}
            disabled={state.cards.length === 0}
          >
            <CardIcon className="size-4" /> Definir limite total
          </Button>
        }
      >
        {state.cards.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Cadastre um cartão para informar o limite total compartilhado.
          </p>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <KpiCard
              label="Limite total"
              value={sharedCardLimit === null ? "Não informado" : fmtBRL(sharedCardLimit)}
              hint="Compartilhado entre todos os cartões cadastrados"
              icon={<CardIcon />}
            />
            <KpiCard
              label="Em aberto e parcelas futuras"
              value={fmtBRL(sharedCardLimitUsed)}
              hint="Somado entre todos os cartões"
            />
            <KpiCard
              label="Disponível"
              value={sharedCardLimitAvailable === null ? "—" : fmtBRL(sharedCardLimitAvailable)}
              hint={
                sharedCardLimitAvailable === null
                  ? "Defina o limite total para calcular"
                  : "Limite compartilhado menos compromissos conhecidos"
              }
              tone={
                sharedCardLimitAvailable === null
                  ? undefined
                  : sharedCardLimitAvailable <= 0
                    ? "danger"
                    : "success"
              }
            />
          </div>
        )}
      </Panel>

      <Panel className="mt-6" title={`Próximo mês · ${fmtMonthLong(nextMonth)}`} description="Estimativa considerando apenas parcelas e compromissos já conhecidos">
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Se não gastar nada" value={fmtBRL(nextMonthExpected)} hint="Parcelas já comprometidas" icon={<CalendarClock />} />
          <KpiCard label="Já lançado" value={fmtBRL(nextMonthActual)} hint={nextMonthInvoices.length ? `${nextMonthInvoices.length} fatura(s) importada(s)` : "Nenhuma fatura importada"} />
          <KpiCard label="Gastou a mais" value={fmtBRL(nextMonthExtra)} hint="Itens novos além do previsto" tone={nextMonthExtra > 0 ? "warning" : "success"} icon={<TrendingUp />} />
          <div className="flex items-center justify-center">
            <Button variant="outline" onClick={() => setShowExtra((visible) => !visible)}><TrendingUp className="size-4" /> {showExtra ? "Ocultar gastos extras" : "Gastou a mais"}</Button>
          </div>
        </div>
        <div className="border-t p-4">
          <div className="mb-3">
            <h3 className="text-sm font-bold">Evolução: previsto x gastos novos</h3>
            <p className="text-xs text-muted-foreground">Nos próximos seis meses, considerando as parcelas conhecidas e as faturas já importadas.</p>
          </div>
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <BarChart data={evolution} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => fmtBRL(Number(value)).replace("R$", "").trim()} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value) => fmtBRL(Number(value))} />} />
              <Bar dataKey="previsto" fill="var(--color-previsto)" radius={4} />
              <Bar dataKey="novos" fill="var(--color-novos)" radius={4} />
            </BarChart>
          </ChartContainer>
        </div>
        {showExtra && (
          <div className="border-t px-4 py-3">
            {!nextMonthInvoices.length ? (
              <p className="text-sm text-muted-foreground">Importe a fatura de {fmtMonthLong(nextMonth)} para identificar os itens novos e calcular quanto cada pessoa gastou a mais.</p>
            ) : (
              <div>
                <p className="mb-2 text-sm font-semibold">Resumo do próximo mês por pessoa</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {nextPeopleSummary.map((person) => <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm"><span><b>{person.name}</b><span className="ml-2 text-muted-foreground">previsto {fmtBRL(person.expected)} · novo {fmtBRL(person.extra)}</span></span><Button size="sm" variant="outline" onClick={async () => { try { await exportPDF(personNextMonthTable(person), `resumo-proximo-mes-${person.name.toLowerCase().replace(/\s+/g, "-")}.pdf`); toast.success("Resumo em PDF baixado", { description: `Arquivo pronto para enviar para ${person.name}.` }); } catch (error) { toast.error("Não foi possível gerar o PDF", { description: error instanceof Error ? error.message : undefined }); } }}><Download className="size-4" /> PDF</Button></div>)}
                </div>
                {extraByPerson.length === 0 && <p className="mt-3 text-sm font-medium text-success">Nenhum gasto novo acima das parcelas previstas foi identificado.</p>}
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Pendências de classificação"
          description="Clique com o botão direito ou use ⋯ para direcionar"
          actions={<Button asChild variant="outline" size="sm"><Link to="/compras" search={{ status: "pendente" }}>Ver todas</Link></Button>}
        >
          <TransactionTable txs={pending} showType={false} emptyTitle="Nenhuma pendência" emptyDescription="Todas as compras deste mês já têm responsável." />
        </Panel>

        <Panel title="Alertas" description={`${alerts.length} item(ns)`}>
          <ul className="divide-y">
            {alerts.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nenhum alerta para este mês.</li>}
            {alerts.map((a) => (
              <li key={a.id}>
                <Link to={a.to} className="flex gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                  {a.tone === "info" ? <Info className="mt-0.5 size-4 shrink-0 text-info" /> : <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", a.tone === "danger" ? "text-danger" : "text-warning")} />}
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-6" title="Gastos por pessoa" description="Valores atribuídos no mês de referência">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="[&_th]:px-4 [&_th]:py-2.5">
                <th>Pessoa</th><th className="text-right">Atribuído</th><th className="text-right">Limite</th><th className="w-56">Uso</th><th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {peopleBySpending.map((p) => (
                <tr key={p.id} className="[&_td]:px-4 [&_td]:py-3 hover:bg-muted/40">
                  <td><Link to="/pessoas/$id" params={{ id: p.id }} className="font-semibold hover:underline">{p.name}</Link></td>
                  <td className="num text-right font-semibold">{fmtBRL(p.total)}</td>
                  <td className="num text-right text-muted-foreground">{fmtBRL(p.limit)}</td>
                  <td><LimitBar total={p.total} limit={p.limit} /></td>
                  <td><LimitBadge status={limitStatus(p.total, p.limit, state.settings.warnPct)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {showCardLimit && state.cards.length > 0 && (
        <CardLimitDialog onClose={() => setShowCardLimit(false)} />
      )}
    </>
  );
}
