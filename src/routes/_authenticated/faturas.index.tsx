import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, FileSpreadsheet, FileUp, X } from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import { availableMonths, invoiceDiff, invoicePendingCount, invoiceTxs } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonth, fmtMonthLong } from "@/lib/finance/format";
import { EmptyState, PageHeader, Panel } from "@/components/app/common";
import { InvoiceStatusBadge, Pill } from "@/components/app/badges";
import { PdfImportDialog } from "@/components/app/PdfImportDialog";
import { ExcelImportDialog } from "@/components/app/ExcelImportDialog";
import { FilterSelect } from "@/components/app/FilterSelect";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/faturas/")({
  head: () => ({
    meta: [
      { title: "Faturas — Fatura em Dia" },
      { name: "description", content: "Liste, filtre e importe as faturas mensais dos seus cartões de crédito." },
      { property: "og:title", content: "Faturas — Fatura em Dia" },
      { property: "og:description", content: "Importe e confira faturas de cartão de crédito." },
    ],
  }),
  component: Faturas,
});

function Faturas() {
  const { state } = useFinance();
  const [pdf, setPdf] = useState(false);
  const [xls, setXls] = useState(false);
  const [f, setF] = useState<{ card?: string; month?: string; status?: string; due?: string }>({});

  const list = state.invoices
    .filter((i) => (!f.card || i.cardId === f.card) && (!f.month || i.month === f.month) && (!f.status || i.status === f.status))
    .filter((i) => {
      if (!f.due) return true;
      const today = new Date().toISOString().slice(0, 10);
      return f.due === "vencidas" ? i.dueDate < today : i.dueDate >= today;
    })
    .sort((a, b) => b.month.localeCompare(a.month) || a.dueDate.localeCompare(b.dueDate));
  const hasF = Object.values(f).some(Boolean);

  return (
    <>
      <PageHeader
        title="Faturas"
        description="Total oficial de cada fatura comparado com os lançamentos importados"
        actions={
          <>
            <Button variant="outline" onClick={() => setXls(true)}><FileSpreadsheet className="size-4" /> Importar planilha Excel</Button>
            <Button onClick={() => setPdf(true)}><FileUp className="size-4" /> Importar fatura PDF</Button>
          </>
        }
      />

      <Panel>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <FilterSelect label="Cartão" value={f.card} onChange={(v) => setF({ ...f, card: v })} options={state.cards.map((c) => [c.id, `${c.name} •••• ${c.last4}`])} />
          <FilterSelect label="Mês" value={f.month} onChange={(v) => setF({ ...f, month: v })} options={availableMonths(state).map((m) => [m, fmtMonthLong(m)])} />
          <FilterSelect label="Vencimento" value={f.due} onChange={(v) => setF({ ...f, due: v })} options={[["vencidas", "Já vencidas"], ["a_vencer", "A vencer"]]} />
          <FilterSelect label="Status" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[["conferida", "Conferida"], ["em_revisao", "Em revisão"], ["inconsistente", "Inconsistente"]]} />
          {hasF && <Button variant="ghost" size="sm" onClick={() => setF({})}><X className="size-4" /> Limpar</Button>}
        </div>
        {list.length === 0 ? (
          <EmptyState title="Nenhuma fatura encontrada" description={hasF ? "Altere os filtros." : "Importe sua primeira fatura."} action={!hasF && <Button onClick={() => setPdf(true)}>Importar fatura PDF</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="[&_th]:px-3 [&_th]:py-2.5">
                  <th>Cartão</th><th>Final</th><th>Emissor</th><th>Mês</th><th>Vencimento</th><th className="text-right">Total oficial</th><th className="text-right">Compras</th><th className="text-right">Pendentes</th><th>Status</th><th>Pagamento</th><th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((i) => {
                  const c = state.cards.find((x) => x.id === i.cardId);
                  const pend = invoicePendingCount(state, i);
                  const diff = invoiceDiff(state, i);
                  const paid = i.payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0;
                  return (
                    <tr key={i.id} className="hover:bg-muted/40 [&_td]:px-3 [&_td]:py-3">
                      <td className="font-semibold">
                        <Link to="/faturas/$id" params={{ id: i.id }} className="hover:underline">{c?.name}</Link>
                        {i.source !== "demo" && <span className="ml-2 text-xs font-normal text-muted-foreground">{i.source === "planilha" ? "via planilha" : i.source === "pdf" ? "via PDF" : "PDF demonstrativo"}</span>}
                      </td>
                      <td className="num">•••• {c?.last4}</td>
                      <td className="text-muted-foreground">{c?.issuer}</td>
                      <td>{fmtMonth(i.month)}</td>
                      <td className="num">{fmtDate(i.dueDate)}</td>
                      <td className="num text-right font-semibold">
                        {fmtBRL(i.officialTotal)}
                        {diff !== 0 && <div className="text-xs font-medium text-danger">dif. {fmtBRL(diff)}</div>}
                      </td>
                      <td className="num text-right">{invoiceTxs(state, i.id).length}</td>
                      <td className={cn("num text-right", pend > 0 && "font-bold text-warning")}>{pend}</td>
                      <td><InvoiceStatusBadge status={i.status} /></td>
                      <td>{paid > 0 ? <Pill tone={paid >= i.officialTotal ? "success" : "warning"}>Pago {fmtBRL(paid)}</Pill> : <Pill tone="warning">Em aberto</Pill>}</td>
                      <td>
                        <Button asChild variant="ghost" size="icon" aria-label="Ver detalhes"><Link to="/faturas/$id" params={{ id: i.id }}><Eye className="size-4" /></Link></Button>
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
