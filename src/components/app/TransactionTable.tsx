import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  ExternalLink,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Repeat,
  Scissors,
  Tag,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import {
  TX_TYPE_LABEL,
  addMonths,
  allocatedSum,
  isCreditType,
  txCard,
  txStatus,
} from "@/lib/finance/calc";
import { fmtBRL, fmtDate, round2, uid } from "@/lib/finance/format";
import type { RecurringCharge, Transaction, TxType } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TxStatusBadge, TxTypeBadge } from "./badges";
import { EmptyState } from "./common";
import { useTxActions } from "./tx-actions";
import { toast } from "sonner";
import { categoryLabel } from "@/lib/finance/categories";

export type SortKey = "date" | "amount" | "description" | "card" | "person" | "status";

const TYPES: TxType[] = [
  "compra",
  "parcela",
  "credito",
  "estorno",
  "tarifa",
  "ajuste",
  "pagamento",
];

export function TransactionTable({
  txs,
  selectable,
  selected,
  onSelectedChange,
  showCard = true,
  showType = true,
  emptyTitle = "Nenhum lançamento encontrado",
  emptyDescription,
  personFilter,
}: {
  txs: Transaction[];
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  showCard?: boolean;
  showType?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Quando definido, mostra apenas a parte desta pessoa na coluna de responsável */
  personFilter?: string;
}) {
  const { state } = useFinance();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });

  const sorted = [...txs].sort((a, b) => {
    const k = sort.key;
    const cardName = (tx: Transaction) => txCard(state, tx)?.name ?? "Sem cartão";
    const personName = (tx: Transaction) =>
      tx.allocations
        .map(
          (allocation) =>
            state.people.find((person) => person.id === allocation.personId)?.name ??
            "Sem responsável",
        )
        .join(", ");
    const v =
      k === "amount"
        ? a.amount - b.amount
        : k === "date"
          ? a.date.localeCompare(b.date)
          : k === "card"
            ? cardName(a).localeCompare(cardName(b), "pt-BR")
            : k === "person"
              ? personName(a).localeCompare(personName(b), "pt-BR")
              : k === "status"
                ? txStatus(a).localeCompare(txStatus(b), "pt-BR")
                : a.description.localeCompare(b.description, "pt-BR");
    return v * sort.dir;
  });

  const sel = new Set(selected ?? []);
  const selectableIds = txs.filter((t) => t.type !== "pagamento").map((t) => t.id);
  const allSel = selectableIds.length > 0 && selectableIds.every((id) => sel.has(id));

  const SortBtn = ({
    k,
    children,
    right,
  }: {
    k: SortKey;
    children: React.ReactNode;
    right?: boolean;
  }) => (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 font-semibold hover:text-foreground",
        right && "flex-row-reverse",
      )}
      onClick={() =>
        setSort((s) => ({
          key: k,
          dir: s.key === k ? ((s.dir * -1) as 1 | -1) : k === "description" ? 1 : -1,
        }))
      }
      aria-label={`Ordenar por ${children}`}
    >
      {children}
      {sort.key === k ? (
        sort.dir === 1 ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );

  if (txs.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div className="overflow-x-auto">
      <table
        className={cn("w-full min-w-[860px] text-sm", state.settings.compact && "[&_td]:py-1.5")}
      >
        <thead className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="[&_th]:px-3 [&_th]:py-2.5">
            {selectable && (
              <th className="w-10">
                <Checkbox
                  aria-label="Selecionar todos"
                  checked={allSel}
                  onCheckedChange={(v) => onSelectedChange?.(v ? selectableIds : [])}
                />
              </th>
            )}
            <th className="w-28">
              <SortBtn k="date">Data</SortBtn>
            </th>
            <th>
              <SortBtn k="description">Descrição</SortBtn>
            </th>
            {showCard && (
              <th>
                <SortBtn k="card">Cartão</SortBtn>
              </th>
            )}
            {showType && <th>Tipo</th>}
            <th className="text-right">
              <SortBtn k="amount" right>
                Valor
              </SortBtn>
            </th>
            <th>
              <SortBtn k="person">Responsável</SortBtn>
            </th>
            <th>
              <SortBtn k="status">Status</SortBtn>
            </th>
            <th className="w-12">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((t) => (
            <Row
              key={t.id}
              tx={t}
              selectable={selectable}
              checked={sel.has(t.id)}
              onCheck={(v) =>
                onSelectedChange?.(v ? [...sel, t.id] : [...sel].filter((x) => x !== t.id))
              }
              showCard={showCard}
              showType={showType}
              personFilter={personFilter}
              cardLabel={(() => {
                const c = txCard(state, t);
                return c ? { name: c.name, last4: c.last4 } : null;
              })()}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  tx,
  selectable,
  checked,
  onCheck,
  showCard,
  showType,
  cardLabel,
  personFilter,
}: {
  tx: Transaction;
  selectable?: boolean | undefined;
  checked: boolean;
  onCheck?: ((v: boolean) => void) | undefined;
  showCard: boolean;
  showType: boolean;
  cardLabel: { name: string; last4: string } | null;
  personFilter?: string | undefined;
}) {
  const { state, dispatch } = useFinance();
  const { openAssign, openSplit, openEdit, deleteTx, unassign } = useTxActions();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(tx.note ?? "");
  const status = txStatus(tx);
  const isPay = tx.type === "pagamento";
  const recurrence = state.recurringCharges.find(
    (charge) => charge.id === tx.recurringChargeId || charge.sourceTransactionId === tx.id,
  );
  const people = tx.allocations.map((a) => ({
    ...a,
    name: state.people.find((p) => p.id === a.personId)?.name ?? "Pessoa removida",
  }));
  const shown = personFilter ? people.filter((p) => p.personId === personFilter) : people;
  const allocMismatch = tx.allocations.length > 0 && allocatedSum(tx) !== tx.amount;

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
    dispatch({
      type: "cancelRecurringCharge",
      chargeId: recurrence.id,
      cancelledFromMonth,
    });
    toast.success("Recorrência removida", {
      description: `Nenhuma nova projeção a partir de ${cancelledFromMonth}; o histórico foi preservado.`,
    });
  };

  const saveNote = () => {
    dispatch({ type: "setTransactionNote", txId: tx.id, note: noteDraft });
    toast.success(noteDraft.trim() ? "Observação salva" : "Observação removida");
    setNoteOpen(false);
  };

  const items = (
    Item: typeof ContextMenuItem | typeof DropdownMenuItem,
    Sep: typeof ContextMenuSeparator,
    Sub: typeof ContextMenuSub,
    SubT: typeof ContextMenuSubTrigger,
    SubC: typeof ContextMenuSubContent,
  ) => (
    <>
      <Item disabled={isPay} onSelect={() => openAssign([tx.id])}>
        <UserCheck className="size-4" /> Direcionar para pessoa
      </Item>
      <Item disabled={isPay} onSelect={() => openSplit(tx.id)}>
        <Scissors className="size-4" /> Dividir compra
      </Item>
      <Item onSelect={() => openEdit(tx.id)}>
        <Pencil className="size-4" /> Editar compra / parcela
      </Item>
      <Item
        disabled={isPay || tx.type !== "compra" || tx.amount <= 0 || Boolean(recurrence)}
        onSelect={markAsRecurring}
      >
        <Repeat className="size-4" />{" "}
        {recurrence ? "Recorrência já cadastrada" : "Marcar como recorrente"}
      </Item>
      {recurrence && (
        <Item disabled={Boolean(recurrence.cancelledFromMonth)} onSelect={removeRecurrence}>
          <Repeat className="size-4" />{" "}
          {recurrence.cancelledFromMonth ? "Recorrência já encerrada" : "Remover recorrência"}
        </Item>
      )}
      <Item
        disabled={isPay}
        onSelect={() => {
          setNoteDraft(tx.note ?? "");
          setNoteOpen(true);
        }}
      >
        <MessageSquareText className="size-4" />{" "}
        {tx.note ? "Editar observação" : "Adicionar observação"}
      </Item>
      {tx.allocations.length > 0 && (
        <Item onSelect={() => unassign([tx.id])}>
          <UserX className="size-4" /> Remover atribuição
        </Item>
      )}
      <Sep />
      <Item
        onSelect={async () => {
          await navigator.clipboard?.writeText(
            `${tx.description} · ${fmtDate(tx.date)} · ${fmtBRL(tx.amount)}`,
          );
        }}
      >
        <Copy className="size-4" /> Copiar compra
      </Item>
      <Item
        onSelect={() => {
          window.location.href = `/faturas/${tx.invoiceId}`;
        }}
      >
        <ExternalLink className="size-4" /> Abrir fatura
      </Item>
      <Sep />
      <Sub>
        <SubT>
          <Tag className="mr-2 size-4" /> Tipo de lançamento
        </SubT>
        <SubC>
          {TYPES.map((ty) => (
            <Item
              key={ty}
              onSelect={() => dispatch({ type: "setTxType", txId: tx.id, txType: ty })}
            >
              {ty === tx.type ? "✓ " : ""}
              {TX_TYPE_LABEL[ty]}
            </Item>
          ))}
        </SubC>
      </Sub>
      <Sep />
      <Item className="text-danger" onSelect={() => deleteTx(tx.id)}>
        <Trash2 className="size-4" /> Excluir compra
      </Item>
    </>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <tr
            className={cn(
              "transition-colors hover:bg-muted/50 [&_td]:px-3 [&_td]:py-2.5",
              checked && "bg-accent/60",
              status === "pendente" && "bg-warning-soft/30",
            )}
          >
            {selectable && (
              <td>
                <Checkbox
                  aria-label={`Selecionar ${tx.description}`}
                  disabled={isPay}
                  checked={checked}
                  onCheckedChange={(v) => onCheck?.(!!v)}
                />
              </td>
            )}
            <td className="num text-muted-foreground">{fmtDate(tx.date)}</td>
            <td>
              <div className="font-medium">{tx.description}</div>
              <div
                className={cn("text-xs", tx.category ? "text-primary" : "text-muted-foreground")}
              >
                {categoryLabel(tx.category)}
              </div>
              {tx.installmentNumber && (
                <div className="text-xs text-muted-foreground">
                  Parcela {tx.installmentNumber}/{tx.installmentTotal}
                </div>
              )}
              {tx.adjustmentNote && (
                <div className="text-xs text-warning">Ajuste: {tx.adjustmentNote}</div>
              )}
              {tx.note && (
                <div className="mt-1 flex items-start gap-1 text-xs text-info">
                  <MessageSquareText className="mt-0.5 size-3 shrink-0" />
                  <span>Observação: {tx.note}</span>
                </div>
              )}
              {recurrence && (
                <div className="text-xs text-info">
                  {recurrence.cancelledFromMonth
                    ? `Recorrência encerrada em ${recurrence.cancelledFromMonth}`
                    : "Projeção mensal recorrente"}
                </div>
              )}
            </td>
            {showCard && (
              <td className="whitespace-nowrap text-muted-foreground">
                {cardLabel ? (
                  <>
                    {cardLabel.name} <span className="num">•••• {cardLabel.last4}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
            )}
            {showType && (
              <td>
                <TxTypeBadge type={tx.type} />
              </td>
            )}
            <td
              className={cn(
                "num text-right font-semibold",
                isCreditType(tx.type) && "text-success",
                isPay && "text-muted-foreground",
              )}
            >
              {fmtBRL(tx.amount)}
            </td>
            <td>
              {shown.length === 0 ? (
                <span className="text-muted-foreground">{isPay ? "—" : "Sem responsável"}</span>
              ) : shown.length === 1 && !personFilter && people.length === 1 ? (
                <span className="font-medium">{shown[0]?.name}</span>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block cursor-help">
                      {shown.map((p) => (
                        <span key={p.personId} className="num mr-2 inline-block text-xs">
                          {p.name.split(" ")[0]} {fmtBRL(p.amount)}
                        </span>
                      ))}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {people.map((p) => (
                      <div key={p.personId} className="num">
                        {p.name}: {fmtBRL(p.amount)}
                      </div>
                    ))}
                  </TooltipContent>
                </Tooltip>
              )}
              {allocMismatch && (
                <div className="text-xs text-warning">Distribuído {fmtBRL(allocatedSum(tx))}</div>
              )}
            </td>
            <td>
              <TxStatusBadge status={status} />
            </td>
            <td>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Ações para ${tx.description}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {items(
                    DropdownMenuItem as never,
                    DropdownMenuSeparator as never,
                    DropdownMenuSub as never,
                    DropdownMenuSubTrigger as never,
                    DropdownMenuSubContent as never,
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {items(
            ContextMenuItem,
            ContextMenuSeparator,
            ContextMenuSub,
            ContextMenuSubTrigger,
            ContextMenuSubContent,
          )}
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tx.note ? "Observação da compra" : "Adicionar observação"}</DialogTitle>
            <DialogDescription>
              Identifique do que se trata este lançamento. A observação será sincronizada com o
              workspace compartilhado.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            maxLength={500}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Ex.: compra para manutenção do carro"
            aria-label="Observação da compra"
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
