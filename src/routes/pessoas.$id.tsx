import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Download, Pencil, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { limitMessage, limitStatus, monthTxs, totalFutureCommitted } from "@/lib/finance/calc";
import { fmtBRL, fmtMonth, fmtMonthLong, round2 } from "@/lib/finance/format";
import { personAllTransactionsTable, personReport, personReportTable } from "@/lib/finance/reports";
import { EmptyState, KpiCard, LimitBar, MonthSelect, Panel } from "@/components/app/common";
import { LimitBadge, Pill } from "@/components/app/badges";
import { TransactionTable } from "@/components/app/TransactionTable";
import { PersonDialog } from "@/components/app/PersonDialog";
import { ExportButtons } from "@/components/app/ExportButtons";
import { Button } from "@/components/ui/button";
import { createPDFBlob, exportPDF } from "@/lib/finance/export";

export const Route = createFileRoute("/pessoas/$id")({
  head: () => ({
    meta: [
      { title: "Detalhes da pessoa — Fatura em Dia" },
      { name: "description", content: "Resumo de gastos, limite, compras, parcelamentos e histórico de uma pessoa." },
      { property: "og:title", content: "Detalhes da pessoa — Fatura em Dia" },
      { property: "og:description", content: "Gastos e limite individual." },
    ],
  }),
  component: PessoaDetalhe,
});

function PessoaDetalhe() {
  const { id } = Route.useParams();
  const { state } = useFinance();
  const [edit, setEdit] = useState(false);
  const m = state.settings.month;
  const p = state.people.find((x) => x.id === id);
  if (!p) return <EmptyState title="Pessoa não encontrada" action={<Button asChild variant="outline"><Link to="/pessoas">Voltar</Link></Button>} />;
  const r = personReport(state, p.id, m);
  const st = limitStatus(r.total, p.limit, state.settings.warnPct);
  const msg = limitMessage(p.name, r.total, p.limit, state.settings.warnPct);
  const txs = monthTxs(state, m).filter((t) => t.allocations.some((a) => a.personId === p.id));
  const allPersonTable = personAllTransactionsTable(state, p.id);
  const allPersonTotal = Number(allPersonTable.footer?.at(-1) ?? 0);
  const pdfFilename = `quanto-${p.name.toLowerCase().replace(/\s+/g, "-")}-todas-as-compras.pdf`;
  const maxHist = Math.max(p.limit, ...r.history.map((h) => h.total), 1);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2"><Link to="/pessoas"><ArrowLeft className="size-4" /> Pessoas</Link></Button>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-bold">{p.name}</h1><LimitBadge status={st} />{!p.active && <Pill>Inativa</Pill>}</div>
          <p className="text-sm text-muted-foreground">{p.notes || "Sem observações"} · {fmtMonthLong(m)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MonthSelect />
          <Button variant="outline" onClick={async () => {
            try {
              await exportPDF(allPersonTable, pdfFilename);
              toast.success("PDF baixado", { description: `${allPersonTable.rows.length} compra(s) · total final de ${fmtBRL(allPersonTotal)}.` });
            } catch (error) {
              toast.error("Não foi possível gerar o PDF", { description: error instanceof Error ? error.message : undefined });
            }
          }}><Download className="size-4" /> Baixar PDF</Button>
          <Button onClick={async () => {
            try {
              const blob = await createPDFBlob(allPersonTable);
              const file = new File([blob], pdfFilename, { type: "application/pdf" });
              const text = `Resumo de compras de ${p.name}: ${fmtBRL(allPersonTotal)} no total. O PDF está anexado.`;
              if (navigator.share && navigator.canShare?.({ files: [file] })) {
                await navigator.share({ title: `Compras de ${p.name}`, text, files: [file] });
              } else {
                await exportPDF(allPersonTable, pdfFilename);
                window.open(`https://wa.me/?text=${encodeURIComponent(`${text} O arquivo foi baixado; anexe o PDF nesta conversa.`)}`, "_blank", "noopener,noreferrer");
              }
              toast.success("Pronto para compartilhar", { description: "Selecione o WhatsApp ou outro aplicativo na janela de compartilhamento." });
            } catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") return;
              toast.error("Não foi possível compartilhar o PDF", { description: error instanceof Error ? error.message : undefined });
            }
          }}><Share2 className="size-4" /> Compartilhar WhatsApp</Button>
          <Button variant="outline" onClick={() => setEdit(true)}><Pencil className="size-4" /> Editar</Button>
        </div>
      </div>

      {msg && <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm font-medium text-warning">{msg}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Gasto no mês" value={fmtBRL(r.total)} hint={<LimitBar total={r.total} limit={p.limit} />} />
        <KpiCard label="Limite mensal" value={fmtBRL(p.limit)} hint={`Saldo ${fmtBRL(round2(p.limit - r.total))}`} tone={r.total > p.limit ? "danger" : "default"} />
        <KpiCard label="Compras divididas" value={fmtBRL(r.splitTotal)} hint={`${r.rows.filter((x) => x.split).length} lançamento(s)`} />
        <KpiCard label="Parcelas futuras" value={fmtBRL(totalFutureCommitted(state, m, p.id))} hint="Comprometido após este mês" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Compras atribuídas no mês" description="Coluna Responsável mostra a parte desta pessoa">
          <TransactionTable txs={txs} personFilter={p.id} emptyTitle="Nenhuma compra atribuída neste mês" />
        </Panel>
        <div className="space-y-6">
          <Panel title="Cartões utilizados">
            <ul className="divide-y text-sm">
              {p.cardIds.length === 0 && <li className="p-4 text-muted-foreground">Nenhum cartão associado.</li>}
              {p.cardIds.map((cid) => { const c = state.cards.find((x) => x.id === cid); return c ? <li key={cid} className="flex justify-between px-4 py-2.5"><span>{c.name}</span><span className="num text-muted-foreground">•••• {c.last4}</span></li> : null; })}
            </ul>
          </Panel>
          <Panel title="Histórico por mês">
            <div className="flex h-40 items-end gap-2 px-4 pb-3 pt-4">
              {r.history.map((h) => (
                <div key={h.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="num text-[10px] text-muted-foreground">{h.total ? Math.round(h.total) : ""}</span>
                  <div className={h.total > p.limit ? "w-full rounded-t bg-danger" : "w-full rounded-t bg-primary"} style={{ height: `${(h.total / maxHist) * 100}px` }} />
                  <span className="text-[10px] text-muted-foreground">{fmtMonth(h.month)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Parcelamentos ativos">
          {r.plans.length === 0 ? <EmptyState title="Nenhum parcelamento ativo" /> : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/60 text-left text-xs uppercase text-muted-foreground"><tr className="[&_th]:px-4 [&_th]:py-2"><th>Compra</th><th>Parcela</th><th className="text-right">Neste mês</th><th className="text-right">Futuro</th></tr></thead>
              <tbody className="divide-y">{r.plans.map((x) => (
                <tr key={x.plan.id} className="[&_td]:px-4 [&_td]:py-2.5"><td>{x.plan.description}{x.pct < 100 && <span className="text-xs text-muted-foreground"> ({x.pct}%)</span>}</td><td className="num">{x.current}/{x.plan.amounts.length}</td><td className="num text-right">{fmtBRL(x.monthValue)}</td><td className="num text-right">{fmtBRL(x.future)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
        <Panel title="Previsão de parcelas futuras" description="Somente parcelamentos — compras novas não incluídas">
          <ul className="divide-y text-sm">
            {r.forecast.map((f) => <li key={f.month} className="flex justify-between px-4 py-2"><span>{fmtMonthLong(f.month)}</span><span className="num font-semibold">{fmtBRL(f.value)}</span></li>)}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-6" title="Relatório individual" description="Arquivo gerado no navegador com os dados atuais" actions={<ExportButtons table={() => personReportTable(state, p.id, m)} filename={`relatorio-${p.name.toLowerCase().replace(/\s+/g, "-")}-${m}`} />}>
        <p className="px-4 py-3 text-sm text-muted-foreground">Inclui {r.rows.length} lançamento(s), total de {fmtBRL(r.total)} e saldo de {fmtBRL(round2(p.limit - r.total))}.</p>
      </Panel>

      {edit && <PersonDialog person={p} onClose={() => setEdit(false)} />}
    </>
  );
}
