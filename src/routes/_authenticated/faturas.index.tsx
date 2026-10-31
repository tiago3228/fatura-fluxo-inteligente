import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CircleCheckBig, Eye, FileSpreadsheet, FileUp, X } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import {
  invoiceDiff,
  invoiceHasFinancialData,
  invoicePendingCount,
  invoiceTxs,
} from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonth, fmtMonthLong } from "@/lib/finance/format";
import { EmptyState, KpiCard, PageHeader, Panel } from "@/components/app/common";
import { InvoiceStatusBadge, Pill } from "@/components/app/badges";
import { PdfImportDialog } from "@/components/app/PdfImportDialog";
import { ExcelImportDialog } from "@/components/app/ExcelImportDialog";
import { SendInvoiceToFinancesButton } from "@/components/app/SendInvoiceToFinancesButton";
import { FilterSelect } from "@/components/app/FilterSelect";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/faturas/")({
  head: () => ({
    meta: [
      { title: "Faturas — Fatura em Dia" },
      {
        name: "description",
        content: "Liste, filtre e importe as faturas mensais dos seus cartões de crédito.",
      },
      { property: "og:title", content: "Faturas — Fatura em Dia" },
      { property: "og:description", content: "Importe e confira faturas de cartão de crédito." },
    ],
  }),
  component: Faturas,
});

function Faturas() {
  const { state, dispatch } = useFinance();
  const [pdf, setPdf] = useState(false);
  const [xls, setXls] = useState(false);
  const [f, setF] = useState<{ card?: string; month?: string; status?: string; due?: string }>({});

  const visibleInvoices = state.invoices.filter((invoice) =>
    invoiceHasFinancialData(state, invoice),
  );
  const months = [...new Set(visibleInvoices.map((invoice) => invoice.month))].sort().reverse();
  const list = visibleInvoices
    .filter(
      (i) =>
        (!f.card || i.cardId === f.card) &&
        (!f.month || i.month === f.month) &&
        (!f.status || i.status === f.status),
    )
    .filter((i) => {
      if (!f.due) return true;
      const today = new Date().toISOString().slice(0, 10);
      return f.due === "vencidas" ? i.dueDate < today : i.dueDate >= today;
    })
    .sort((a, b) => b.month.localeCompare(a.month) || a.dueDate.localeCompare(b.dueDate));
  const hasF = Object.values(f).some(Boolean);
  const monthInvoices = f.month
    ? visibleInvoices.filter((invoice) => invoice.month === f.month)
    : [];
  const openMonthInvoices = monthInvoices.filter((invoice) => invoice.status !== "paga");
  const paidCount = list.filter((invoice) => invoice.status === "paga").length;
  const openCount = list.length - paidCount;
  const inconsistentCount = list.filter((invoice) => invoice.status === "inconsistente").length;
  const officialTotal = list.reduce((sum, invoice) => sum + invoice.officialTotal, 0);
  const markMonthPaid = () => {
    if (!f.month || openMonthInvoices.length === 0) return;
    const monthLabel = fmtMonthLong(f.month);
    const confirmed = window.confirm(
      `Marcar ${openMonthInvoices.length} fatura(s) de ${monthLabel} como paga(s)?`,
    );
    if (!confirmed) return;
    dispatch({ type: "markMonthInvoicesPaid", month: f.month, paidAt: new Date().toISOString() });
    toast.success(`Faturas de ${monthLabel} marcadas como pagas`, {
      description: `${openMonthInvoices.length} fatura(s) atualizada(s).`,
    });
  };

  return (
    <>
      <PageHeader
        title="Faturas"
        description="Total oficial de cada fatura comparado com os lançamentos importados"
        actions={
          <>
            <Button variant="outline" onClick={() => setXls(true)}>
              <FileSpreadsheet className="size-4" /> Importar planilha Excel
            </Button>
            <Button onClick={() => setPdf(true)}>
              <FileUp className="size-4" /> Importar fatura PDF
            </Button>
          </>
        }
      />

      <Panel>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <FilterSelect
            label="Cartão"
            value={f.card}
            onChange={(v) => setF({ ...f, card: v })}
            options={state.cards.map((c) => [c.id, `${c.name} •••• ${c.last4}`])}
          />
          <FilterSelect
            label="Mês"
            value={f.month}
            onChange={(v) => setF({ ...f, month: v })}
            options={months.map((m) => [m, fmtMonthLong(m)])}
          />
          <FilterSelect
            label="Vencimento"
            value={f.due}
            onChange={(v) => setF({ ...f, due: v })}
            options={[
              ["vencidas", "Já vencidas"],
              ["a_vencer", "A vencer"],
            ]}
          />
          <FilterSelect
            label="Status"
            value={f.status}
            onChange={(v) => setF({ ...f, status: v })}
            options={[
              ["paga", "Paga"],
              ["conferida", "Conferida"],
              ["em_revisao", "Em revisão"],
              ["inconsistente", "Inconsistente"],
            ]}
          />
          {f.month && (
            <Button
              variant="outline"
              size="sm"
              onClick={markMonthPaid}
              disabled={openMonthInvoices.length === 0}
              title={
                openMonthInvoices.length === 0
                  ? "Todas as faturas deste mês já estão pagas"
                  : undefined
              }
            >
              <CircleCheckBig className="size-4" />
              {openMonthInvoices.length === 0 ? "Mês já pago" : "Marcar mês como pago"}
            </Button>
          )}
          {hasF && (
            <Button variant="ghost" size="sm" onClick={() => setF({})}>
              <X className="size-4" /> Limpar
            </Button>
          )}
        </div>
        <div className="grid gap-3 border-b p-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total oficial"
            value={fmtBRL(officialTotal)}
            hint={`${list.length} fatura(s) exibida(s)`}
          />
          <KpiCard label="Pagas" value={paidCount} hint="Faturas concluídas" tone="success" />
          <KpiCard
            label="Em aberto"
            value={openCount}
            hint="Ainda precisam de pagamento"
            tone={openCount > 0 ? "warning" : "success"}
          />
          <KpiCard
            label="Inconsistentes"
            value={inconsistentCount}
            hint="Precisam de conferência"
            tone={inconsistentCount > 0 ? "danger" : "success"}
          />
        </div>
        {list.length === 0 ? (
          <EmptyState
            title="Nenhuma fatura encontrada"
            description={hasF ? "Altere os filtros." : "Importe sua primeira fatura."}
            action={!hasF && <Button onClick={() => setPdf(true)}>Importar fatura PDF</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="[&_th]:px-3 [&_th]:py-2.5">
                  <th>Cartão</th>
                  <th>Final</th>
                  <th>Emissor</th>
                  <th>Mês</th>
                  <th>Vencimento</th>
                  <th className="text-right">Total oficial</th>
                  <th className="text-right">Compras</th>
                  <th className="text-right">Pendentes</th>
                  <th>Status</th>
                  <th>Pagamento</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((i) => {
                  const c = state.cards.find((x) => x.id === i.cardId);
                  const pend = invoicePendingCount(state, i);
                  const diff = invoiceDiff(state, i);
                  const recordedPaid =
                    i.payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0;
                  const paid = i.status === "paga" ? i.officialTotal : recordedPaid;
                  return (
                    <tr key={i.id} className="hover:bg-muted/40 [&_td]:px-3 [&_td]:py-3">
                      <td className="font-semibold">
                        <Link to="/faturas/$id" params={{ id: i.id }} className="hover:underline">
                          {c?.name}
                        </Link>
                        {i.source !== "demo" && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {i.source === "planilha"
                              ? "via planilha"
                              : i.source === "pdf"
                                ? "via PDF"
                                : "PDF demonstrativo"}
                          </span>
                        )}
                      </td>
                      <td className="num">•••• {c?.last4}</td>
                      <td className="text-muted-foreground">{c?.issuer}</td>
                      <td>{fmtMonth(i.month)}</td>
                      <td className="num">{fmtDate(i.dueDate)}</td>
                      <td className="num text-right font-semibold">
                        {fmtBRL(i.officialTotal)}
                        {diff !== 0 && (
                          <div className="text-xs font-medium text-danger">dif. {fmtBRL(diff)}</div>
                        )}
                      </td>
                      <td className="num text-right">{invoiceTxs(state, i.id).length}</td>
                      <td className={cn("num text-right", pend > 0 && "font-bold text-warning")}>
                        {pend}
                      </td>
                      <td>
                        <InvoiceStatusBadge status={i.status} />
                      </td>
                      <td>
                        {paid > 0 ? (
                          <Pill tone={paid >= i.officialTotal ? "success" : "warning"}>
                            Pago {fmtBRL(paid)}
                          </Pill>
                        ) : (
                          <Pill tone="warning">Em aberto</Pill>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <SendInvoiceToFinancesButton invoice={i} card={c} compact />
                          <Button asChild variant="ghost" size="icon" aria-label="Ver detalhes">
                            <Link to="/faturas/$id" params={{ id: i.id }}>
                              <Eye className="size-4" />
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <PdfImportDialog open={pdf} onOpenChange={setPdf} />
      <ExcelImportDialog open={xls} onOpenChange={setXls} />
    </>
  );
}
