import { useState, type ReactNode } from "react";
import {
  Copy,
  ExternalLink,
  MessageSquareText,
  Pencil,
  Repeat,
  Scissors,
  Tag,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { TX_TYPE_LABEL, addMonths } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, round2, uid } from "@/lib/finance/format";
import type { RecurringCharge, Transaction, TxType } from "@/lib/finance/types";
import { useTxActions } from "./tx-actions";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const TYPES: TxType[] = [
  "compra",
  "parcela",
  "credito",
  "estorno",
  "tarifa",
  "ajuste",
  "pagamento",
];

export function PurchaseContextMenu({
  transaction: tx,
  children,
}: {
  transaction: Transaction;
  children: ReactNode;
}) {
  const { state, dispatch } = useFinance();
  const { openAssign, openSplit, openEdit, deleteTx, unassign } = useTxActions();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(tx.note ?? "");
  const recurrence = state.recurringCharges.find(
    (charge) => charge.id === tx.recurringChargeId || charge.sourceTransactionId === tx.id,
  );
  const isPayment = tx.type === "pagamento";

  const markAsRecurring = () => {
    const invoice = state.invoices.find((item) => item.id === tx.invoiceId);
    if (!invoice || tx.type !== "compra" || tx.amount <= 0 || recurrence) return;
    const allocationsTotal = round2(
      tx.allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
    );
    const shares =
      allocationsTotal === tx.amount
        ? tx.allocations.map((allocation, index) => ({
            personId: allocation.personId,
            pct:
              index === tx.allocations.length - 1
                ? round2(
                    100 -
                      tx.allocations
                        .slice(0, index)
                        .reduce((sum, item) => sum + round2((item.amount / tx.amount) * 100), 0),
                  )
                : round2((allocation.amount / tx.amount) * 100),
          }))
        : [];
    const charge: RecurringCharge = {
      id: uid("rec"),
      description: tx.description,
      category: tx.category,
      cardId: invoice.cardId,
      amount: tx.amount,
      startMonth: addMonths(invoice.month, 1),
      shares,
      sourceTransactionId: tx.id,
    };
    dispatch({ type: "upsertRecurringCharge", charge });
    toast.success("Compra marcada como recorrente", {
      description: `Projeção mensal iniciada em ${charge.startMonth}; pode ser cancelada em Parcelamentos.`,
    });
  };

  const removeRecurrence = () => {
    const invoice = state.invoices.find((item) => item.id === tx.invoiceId);
    if (!invoice || !recurrence || recurrence.cancelledFromMonth) return;
    const cancelledFromMonth = addMonths(invoice.month, 1);
    dispatch({ type: "cancelRecurringCharge", chargeId: recurrence.id, cancelledFromMonth });
    toast.success("Recorrência removida", {
      description: `Nenhuma nova projeção a partir de ${cancelledFromMonth}; o histórico foi preservado.`,
    });
  };

  const saveNote = () => {
    dispatch({ type: "setTransactionNote", txId: tx.id, note: noteDraft });
    toast.success(noteDraft.trim() ? "Observação salva" : "Observação removida");
    setNoteOpen(false);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuItem disabled={isPayment} onSelect={() => openAssign([tx.id])}>
            <UserCheck className="size-4" /> Direcionar para pessoa
          </ContextMenuItem>
          <ContextMenuItem disabled={isPayment} onSelect={() => openSplit(tx.id)}>
            <Scissors className="size-4" /> Dividir compra
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openEdit(tx.id)}>
            <Pencil className="size-4" /> Editar compra / parcela
          </ContextMenuItem>
          <ContextMenuItem
            disabled={isPayment || tx.type !== "compra" || tx.amount <= 0 || Boolean(recurrence)}
            onSelect={markAsRecurring}
          >
            <Repeat className="size-4" />{" "}
            {recurrence ? "Recorrência já cadastrada" : "Marcar como recorrente"}
          </ContextMenuItem>
          {recurrence && (
            <ContextMenuItem
              disabled={Boolean(recurrence.cancelledFromMonth)}
              onSelect={removeRecurrence}
            >
              <Repeat className="size-4" />{" "}
              {recurrence.cancelledFromMonth ? "Recorrência já encerrada" : "Remover recorrência"}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            disabled={isPayment}
            onSelect={() => {
              setNoteDraft(tx.note ?? "");
              setNoteOpen(true);
            }}
          >
            <MessageSquareText className="size-4" />{" "}
            {tx.note ? "Editar observação" : "Adicionar observação"}
          </ContextMenuItem>
          {tx.allocations.length > 0 && (
            <ContextMenuItem onSelect={() => unassign([tx.id])}>
              <UserX className="size-4" /> Remover atribuição
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={async () => {
              await navigator.clipboard?.writeText(
                `${tx.description} · ${fmtDate(tx.date)} · ${fmtBRL(tx.amount)}`,
              );
            }}
          >
            <Copy className="size-4" /> Copiar compra
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => (window.location.href = `/faturas/${tx.invoiceId}`)}>
            <ExternalLink className="size-4" /> Abrir fatura
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Tag className="mr-2 size-4" /> Tipo de lançamento
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {TYPES.map((type) => (
                <ContextMenuItem
                  key={type}
                  onSelect={() => dispatch({ type: "setTxType", txId: tx.id, txType: type })}
                >
                  {type === tx.type ? "✓ " : ""}
                  {TX_TYPE_LABEL[type]}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-danger" onSelect={() => deleteTx(tx.id)}>
            <Trash2 className="size-4" /> Excluir compra
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Observação da compra</DialogTitle>
            <DialogDescription>
              Adicione um detalhe para identificar melhor este lançamento.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Ex.: compra para a casa"
            className="min-h-24"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveNote}>Salvar observação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
