import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarPlus, CheckCircle2, CircleCheckBig, CircleDollarSign } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { allocatedSum, invoiceAllocatedTotal, invoiceDiff, invoiceLaunchesTotal, invoiceTxs, isCreditType, txStatus } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong, parseBRL, round2 } from "@/lib/finance/format";
import { EmptyState, KpiCard, Panel } from "@/components/app/common";
import { InvoiceStatusBadge, Pill } from "@/components/app/badges";
import { SendInvoiceToFinancesButton } from "@/components/app/SendInvoiceToFinancesButton";
import { TransactionTable } from "@/components/app/TransactionTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Invoice, InvoicePayment, Person } from "@/lib/finance/types";

export const Route = createFileRoute("/_authenticated/faturas/$id")({
  head: () => ({
    meta: [
      { title: "Detalhes da fatura — Fatura em Dia" },
      { name: "description", content: "Lançamentos da fatura, conciliação com o total oficial e distribuição por pessoa." },
      { property: "og:title", content: "Detalhes da fatura — Fatura em Dia" },
      { property: "og:description", content: "Confira os lançamentos e a conciliação da fatura." },
    ],
  }),
  component: FaturaDetalhe,
});

const TABS = [
  ["todas", "Todas"], ["atribuidas", "Atribuídas"], ["pendentes", "Pendentes"], ["parcelas", "Parcelamentos"], ["creditos", "Créditos e estornos"], ["tarifas", "Tarifas e encargos"],
] as const;

function FaturaDetalhe() {
  const { id } = Route.useParams();
  const { state, dispatch } = useFinance();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("todas");
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const inv = state.invoices.find((i) => i.id === id);
  if (!inv) return <EmptyState title="Fatura não encontrada" action={<Button asChild variant="outline"><Link to="/faturas">Voltar para faturas</Link></Button>} />;
  const card = state.cards.find((c) => c.id === inv.cardId);
  const all = invoiceTxs(state, inv.id);
  const launches = invoiceLaunchesTotal(state, inv);
  const allocated = invoiceAllocatedTotal(state, inv);
  const diff = invoiceDiff(state, inv);
  const pend = all.filter((t) => txStatus(t) === "pendente");
  const filtered = all.filter((t) => {
    switch (tab) {
      case "atribuidas": return t.allocations.length > 0;
      case "pendentes": return txStatus(t) === "pendente";
      case "parcelas": return t.type === "parcela";
      case "creditos": return isCreditType(t.type);
      case "tarifas": return t.type === "tarifa";
      default: return true;
    }
  });
  const unallocated = all.filter((t) => t.type !== "pagamento").reduce((s, t) => s + (t.amount - allocatedSum(t)), 0);
  const recordedPaidTotal = round2((inv.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0));
  const paidTotal = inv.status === "paga" ? inv.officialTotal : recordedPaidTotal;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2"><Link to="/faturas"><ArrowLeft className="size-4" /> Faturas</Link></Button>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-bold">{card?.name} •••• {card?.last4}</h1><InvoiceStatusBadge status={inv.status} /></div>
          <p className="text-sm text-muted-foreground">{card?.issuer} · {fmtMonthLong(inv.month)} · vencimento {fmtDate(inv.dueDate)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SendInvoiceToFinancesButton invoice={inv} card={card} />
          {paidTotal > 0 && <Pill tone={paidTotal >= inv.officialTotal ? "success" : "warning"}><CircleCheckBig className="size-3" /> Pago {fmtBRL(paidTotal)}</Pill>}
          <Button variant="outline" onClick={() => setPaymentsOpen(true)}><CircleCheckBig className="size-4" /> Já pagou</Button>
          {inv.status !== "paga" && <Button onClick={() => { dispatch({ type: "markInvoicePaid", invoiceId: inv.id, paidAt: new Date().toISOString() }); toast.success("Fatura marcada como paga"); }}><CircleDollarSign className="size-4" /> Marcar fatura como paga</Button>}
          <Button variant="outline" onClick={() => { const nextMonth = new Date(`${inv.month}-15T12:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1); const label = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`; const exists = state.invoices.some((item) => item.cardId === inv.cardId && item.month === label); if (exists) { toast.info("A próxima competência já existe"); return; } dispatch({ type: "prepareNextInvoice", invoiceId: inv.id }); toast.success("Próxima competência preparada", { description: label }); }}><CalendarPlus className="size-4" /> Preparar próxima fatura</Button>
          {inv.status !== "conferida" && (
            <Button
              variant="outline"
              onClick={() => {
                if (pend.length || diff !== 0) {
                  toast.error("Ainda não é possível marcar como conferida", { description: `${pend.length} pendência(s)${diff !== 0 ? ` e diferença de ${fmtBRL(diff)}` : ""}.` });
                  return;
                }
                dispatch({ type: "setInvoiceStatus", invoiceId: inv.id, status: "conferida" });
                toast.success("Fatura marcada como conferida");
              }}
            >
              <CheckCircle2 className="size-4" /> Marcar como conferida
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total oficial da fatura" value={fmtBRL(inv.officialTotal)} hint="Valor informado pelo banco" />
        <KpiCard label="Soma dos lançamentos" value={fmtBRL(launches)} hint={diff === 0 ? "Confere com o total oficial" : `Diferença de ${fmtBRL(diff)}`} tone={diff === 0 ? "success" : "danger"} />
        <KpiCard label="Distribuído entre pessoas" value={fmtBRL(allocated)} hint={`Falta distribuir ${fmtBRL(unallocated)}`} tone={unallocated ? "warning" : "success"} />
        <KpiCard label="Pendentes" value={pend.length} hint="Compras sem responsável" tone={pend.length ? "warning" : "success"} />
      </div>

      {diff !== 0 && (
        <p className="mt-4 flex gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" /> A soma dos lançamentos não confere com o total oficial (diferença de {fmtBRL(diff)}). Verifique se falta algum lançamento — a diferença não é corrigida automaticamente.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Parcelas futuras de compras parceladas não entram neste total — veja em Parcelamentos.</p>

      <PaymentDialog
        open={paymentsOpen}
        invoice={inv}
        people={state.people.filter((person) => person.active)}
        onClose={() => setPaymentsOpen(false)}
        onSave={(payments) => {
          dispatch({ type: "setInvoicePayments", invoiceId: inv.id, payments });
          setPaymentsOpen(false);
          toast.success("Pagamentos atualizados", { description: `${fmtBRL(payments.reduce((sum, payment) => sum + payment.amount, 0))} informado(s) por pessoa.` });
        }}
      />

      <Panel className="mt-4">
        <div className="overflow-x-auto border-b p-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              {TABS.map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        <TransactionTable txs={filtered} showCard={false} emptyTitle="Nada nesta categoria" />
      </Panel>
    </>
  );
}

function PaymentDialog({ open, invoice, people, onClose, onSave }: { open: boolean; invoice: Invoice; people: Person[]; onClose: () => void; onSave: (payments: InvoicePayment[]) => void }) {
  const [rows, setRows] = useState<Record<string, string>>({});
  const existing = invoice.payments ?? [];
  const peopleKey = people.map((person) => person.id).join(",");
  const paymentKey = JSON.stringify(existing);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    people.forEach((person) => {
      const payment = existing.find((item) => item.personId === person.id);
      initial[person.id] = payment ? payment.amount.toFixed(2).replace(".", ",") : "";
    });
    setRows(initial);
  }, [open, invoice.id, peopleKey, paymentKey]);

  const amounts = people.map((person) => ({ person, amount: parseBRL(rows[person.id] ?? "") ?? 0 }));
  const paidTotal = round2(amounts.reduce((sum, item) => sum + item.amount, 0));
  const remaining = round2(invoice.officialTotal - paidTotal);
  const save = () => onSave(amounts.filter((item) => item.amount > 0).map(({ person, amount }) => ({ personId: person.id, amount: round2(amount), paidAt: new Date().toISOString().slice(0, 10) })));

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quem já pagou esta fatura?</DialogTitle>
          <DialogDescription>Informe quanto cada pessoa cadastrada já pagou. Deixe vazio quem ainda não pagou.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {people.map((person) => (
            <label key={person.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="min-w-0 flex-1 font-medium">{person.name}</span>
              <div className="relative w-36">
                <Input className="num pr-8 text-right" inputMode="decimal" placeholder="0,00" value={rows[person.id] ?? ""} onChange={(event) => setRows((current) => ({ ...current, [person.id]: event.target.value }))} aria-label={`Quanto ${person.name} já pagou`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
              </div>
            </label>
          ))}
          {people.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Cadastre uma pessoa antes de registrar pagamentos.</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Total da fatura</p><p className="num font-bold">{fmtBRL(invoice.officialTotal)}</p></div>
          <div><p className="text-xs text-muted-foreground">Já pago</p><p className="num font-bold">{fmtBRL(paidTotal)}</p></div>
          <div className="col-span-2"><p className="text-xs text-muted-foreground">Saldo em aberto</p><p className={paidTotal > invoice.officialTotal ? "num font-bold text-danger" : "num font-bold"}>{fmtBRL(remaining)}</p></div>
        </div>
        {paidTotal > invoice.officialTotal && <p className="text-sm text-danger">O total pago não pode ser maior que o total oficial da fatura.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={paidTotal > invoice.officialTotal}>Salvar pagamentos</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
