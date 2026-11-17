import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import {
  buildPersonReceiptPayments,
  limitMessage,
  limitStatus,
  personAccountBalance,
  personCreditBalance,
  personDebtTotal,
  personMonthApplied,
  personMonthLimitAvailable,
  personMonthPaid,
  personMonthReceivedTotal,
  personMonthReceipts,
  personMonthRemaining,
  personMonthSurplus,
  personMonthTotal,
  personPaymentStatus,
} from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong, parseBRL, round2, uid } from "@/lib/finance/format";
import type { PersonReceiptSummary } from "@/lib/finance/calc";
import type { Person } from "@/lib/finance/types";
import { EmptyState, LimitBar, PageHeader, Panel } from "@/components/app/common";
import { PaymentStatusBadge, Pill } from "@/components/app/badges";
import { PersonDialog } from "@/components/app/PersonDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export const Route = createFileRoute("/_authenticated/pessoas/")({
  head: () => ({
    meta: [
      { title: "Pessoas — Fatura em Dia" },
      {
        name: "description",
        content:
          "Cadastre quem usa seus cartões, defina limites mensais e acompanhe o uso de cada pessoa.",
      },
      { property: "og:title", content: "Pessoas — Fatura em Dia" },
      { property: "og:description", content: "Limites e gastos por pessoa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Pessoas,
});

const currentLocalDate = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

function Pessoas() {
  const { state, dispatch } = useFinance();
  const m = state.settings.month;
  const [edit, setEdit] = useState<Person | "new" | null>(null);
  const [del, setDel] = useState<Person | null>(null);
  const [paymentPerson, setPaymentPerson] = useState<{
    person: Person;
    remaining: number;
    allowCredit?: boolean;
    receipt?: PersonReceiptSummary;
  } | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);

  return (
    <>
      <PageHeader
        title="Pessoas"
        description={`Limites e gastos atribuídos em ${fmtMonthLong(m)}`}
        showMonth
        actions={
          <Button onClick={() => setEdit("new")}>
            <UserPlus className="size-4" /> Adicionar pessoa
          </Button>
        }
      />
      <Panel>
        {state.people.length === 0 ? (
          <EmptyState
            title="Nenhuma pessoa cadastrada"
            action={<Button onClick={() => setEdit("new")}>Adicionar pessoa</Button>}
          />
        ) : (
          <>
            <div className="md:hidden divide-y">
              {state.people.map((p) => {
                const total = personMonthTotal(state, p.id, m);
                const paid = personMonthPaid(state, p.id, m);
                const applied = personMonthApplied(state, p.id, m);
                const received = personMonthReceivedTotal(state, p.id, m);
                const monthSurplus = personMonthSurplus(state, p.id, m);
                const receipts = personMonthReceipts(state, p.id, m);
                const remaining = personMonthRemaining(state, p.id, m);
                const debt = personDebtTotal(state, p.id);
                const credit = personCreditBalance(state, p.id);
                const accountBalance = personAccountBalance(state, p.id);
                const paymentStatus = personPaymentStatus(state, p.id, m);
                const msg = limitMessage(p.name, total, p.limit, state.settings.warnPct);
                const budgetStatus = limitStatus(total, p.limit, state.settings.warnPct);
                const budgetAvailable = personMonthLimitAvailable(state, p.id, m);
                const budgetExceeded = p.limit > 0 ? Math.max(0, round2(total - p.limit)) : 0;
                const isExpanded = expanded.includes(p.id);
                const editReceipt = (receipt: PersonReceiptSummary) =>
                  setPaymentPerson({ person: p, remaining: debt, allowCredit: true, receipt });
                return (
                  <article
                    key={p.id}
                    className={cn(
                      "p-4",
                      !p.active && "opacity-60",
                      paymentStatus === "pago" && "border-l-4 border-l-success bg-success/5",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/pessoas/$id"
                          params={{ id: p.id }}
                          className={cn(
                            "font-semibold hover:underline",
                            paymentStatus === "pago" && "text-success",
                          )}
                        >
                          {p.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {p.active ? (
                            <PaymentStatusBadge status={paymentStatus} />
                          ) : (
                            <Pill>Inativa</Pill>
                          )}
                          {p.cardIds.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {p.cardIds.length} cartão(ões)
                            </span>
                          )}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-mr-2 -mt-2 shrink-0"
                            aria-label={`Ações para ${p.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to="/pessoas/$id" params={{ id: p.id }}>
                              <Eye className="size-4" /> Ver detalhes
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEdit(p)}>
                            <Pencil className="size-4" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/compras" search={{ assignTo: p.id, status: "pendente" }}>
                              <UserCheck className="size-4" /> Atribuir compras
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              setPaymentPerson({ person: p, remaining: debt, allowCredit: true })
                            }
                          >
                            Já Pagou
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={remaining <= 0}
                            onSelect={() => {
                              if (remaining <= 0) return;
                              dispatch({
                                type: "recordPersonPayment",
                                payment: {
                                  id: uid("payment"),
                                  personId: p.id,
                                  amount: remaining,
                                  paidAt: currentLocalDate(),
                                  month: m,
                                  receiptId: uid("receipt"),
                                  receiptMonth: m,
                                },
                              });
                              toast.success(`${p.name} marcada como paga`, {
                                description: `${fmtBRL(remaining)} registrados em ${fmtMonthLong(m)}.`,
                              });
                            }}
                          >
                            Marcar parcela do mês como paga
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={remaining <= 0}
                            onSelect={() =>
                              remaining > 0 && setPaymentPerson({ person: p, remaining })
                            }
                          >
                            Registrar pagamento parcial
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={paid <= 0}
                            onSelect={() => {
                              if (paid <= 0) return;
                              dispatch({
                                type: "clearPersonMonthPayments",
                                personId: p.id,
                                month: m,
                              });
                              toast.success(`${p.name} marcada como pendente`, {
                                description: `Pagamentos de ${fmtMonthLong(m)} removidos.`,
                              });
                            }}
                          >
                            Marcar como pendente
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-danger" onSelect={() => setDel(p)}>
                            <Trash2 className="size-4" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Fatura do mês</p>
                        <p className="num mt-0.5 font-semibold">{fmtBRL(total)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Recebido no mês</p>
                        <p className="num mt-0.5 font-semibold text-success">{fmtBRL(received)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Falta pagar</p>
                        <p
                          className={cn("num mt-0.5 font-semibold", remaining > 0 && "text-danger")}
                        >
                          {fmtBRL(remaining)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Saldo da conta</p>
                        <AccountBalance amount={accountBalance} align="left" />
                      </div>
                    </div>
                    {(receipts.length > 0 || applied > 0 || credit > 0) && (
                      <div className="mt-2 space-y-1 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs">
                        {receipts.map((receipt) => (
                          <div key={receipt.id} className="flex items-center justify-between gap-2">
                            <span>
                              {fmtBRL(receipt.amount)} · {fmtDate(receipt.paidAt.slice(0, 10))}
                            </span>
                            <button
                              type="button"
                              className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted"
                              aria-label={`Editar recebimento de ${fmtBRL(receipt.amount)} em ${fmtDate(receipt.paidAt.slice(0, 10))}`}
                              title="Editar valor ou data do recebimento"
                              onClick={() => editReceipt(receipt)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          </div>
                        ))}
                        {applied > 0 && (
                          <p className="font-medium">Aplicado à fatura: {fmtBRL(applied)}</p>
                        )}
                        {monthSurplus > 0 && (
                          <p className="break-words font-semibold text-success">
                            Sobra do mês: {fmtBRL(received)} − {fmtBRL(applied)} = +
                            {fmtBRL(monthSurplus)}
                          </p>
                        )}
                        {credit > 0 && (
                          <p className="font-semibold text-success">
                            Crédito disponível: {fmtBRL(credit)}
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="mt-3 flex w-full items-center justify-between text-left text-xs font-semibold text-muted-foreground"
                      onClick={() =>
                        setExpanded((items) =>
                          isExpanded ? items.filter((id) => id !== p.id) : [...items, p.id],
                        )
                      }
                      aria-expanded={isExpanded}
                    >
                      <span>{isExpanded ? "Recolher detalhes" : "Ver demais detalhes"}</span>
                      {isExpanded ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t pt-3 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Valor total devido</p>
                            <p className="num font-semibold">{fmtBRL(debt)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Aplicado à fatura</p>
                            <p className="num font-semibold text-success">{fmtBRL(applied)}</p>
                          </div>
                        </div>
                        {credit > 0 && (
                          <p className="text-xs font-semibold text-success">
                            Crédito disponível: {fmtBRL(credit)}
                          </p>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground">Cartões</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {p.cardIds.length ? (
                              p.cardIds.map((cid) => {
                                const c = state.cards.find((x) => x.id === cid);
                                return c ? <Pill key={cid}>•••• {c.last4}</Pill> : null;
                              })
                            ) : (
                              <span className="text-muted-foreground">Nenhum cartão</span>
                            )}
                          </div>
                        </div>
                        {p.limit > 0 ? (
                          <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span>
                                Limite mensal: <b>{fmtBRL(p.limit)}</b>
                              </span>
                              <span
                                className={cn(
                                  "font-semibold",
                                  budgetExceeded > 0 ? "text-danger" : "text-success",
                                )}
                              >
                                {budgetExceeded > 0
                                  ? `Excedido: ${fmtBRL(budgetExceeded)}`
                                  : `Disponível: ${fmtBRL(budgetAvailable ?? 0)}`}
                              </span>
                            </div>
                            <LimitBar total={total} limit={p.limit} />
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Limite mensal não definido
                          </p>
                        )}
                        {msg && (
                          <Pill tone={budgetStatus === "atencao" ? "warning" : "danger"}>
                            {msg}
                          </Pill>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="[&_th]:px-4 [&_th]:py-2.5">
                    <th>Nome</th>
                    <th>Cartões</th>
                    <th className="text-right">Valor Total Devido</th>
                    <th className="text-right">Fatura do mês</th>
                    <th className="text-right">Recebido no mês</th>
                    <th className="text-right">Falta pagar</th>
                    <th className="text-right">Saldo da conta</th>
                    <th>Status</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {state.people.map((p) => {
                    const total = personMonthTotal(state, p.id, m);
                    const paid = personMonthPaid(state, p.id, m);
                    const applied = personMonthApplied(state, p.id, m);
                    const received = personMonthReceivedTotal(state, p.id, m);
                    const monthSurplus = personMonthSurplus(state, p.id, m);
                    const receipts = personMonthReceipts(state, p.id, m);
                    const remaining = personMonthRemaining(state, p.id, m);
                    const debt = personDebtTotal(state, p.id);
                    const credit = personCreditBalance(state, p.id);
                    const accountBalance = personAccountBalance(state, p.id);
                    const paymentStatus = personPaymentStatus(state, p.id, m);
                    const msg = limitMessage(p.name, total, p.limit, state.settings.warnPct);
                    const budgetStatus = limitStatus(total, p.limit, state.settings.warnPct);
                    const budgetAvailable = personMonthLimitAvailable(state, p.id, m);
                    const budgetExceeded = p.limit > 0 ? Math.max(0, round2(total - p.limit)) : 0;
                    const editReceipt = (receipt: PersonReceiptSummary) =>
                      setPaymentPerson({ person: p, remaining: debt, allowCredit: true, receipt });
                    return (
                      <ContextMenu key={p.id}>
                        <ContextMenuTrigger asChild>
                          <tr
                            className={cn(
                              "hover:bg-muted/40 [&_td]:px-4 [&_td]:py-3",
                              !p.active && "opacity-60",
                              paymentStatus === "pago" && "bg-success/5",
                            )}
                          >
                            <td className="min-w-[240px]">
                              <Link
                                to="/pessoas/$id"
                                params={{ id: p.id }}
                                className={cn(
                                  "font-semibold hover:underline",
                                  paymentStatus === "pago" && "text-success",
                                )}
                              >
                                {p.name}
                              </Link>
                              <div className="mt-2 space-y-1.5">
                                {p.limit > 0 ? (
                                  <>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                      <span>
                                        Limite mensal: <b>{fmtBRL(p.limit)}</b>
                                      </span>
                                      {budgetExceeded > 0 ? (
                                        <span className="font-semibold text-danger">
                                          Excedido: {fmtBRL(budgetExceeded)}
                                        </span>
                                      ) : (
                                        <span className="font-semibold text-success">
                                          Disponível: {fmtBRL(budgetAvailable ?? 0)}
                                        </span>
                                      )}
                                    </div>
                                    <LimitBar total={total} limit={p.limit} />
                                    {msg && (
                                      <div role="status" aria-live="polite">
                                        <Pill
                                          tone={budgetStatus === "atencao" ? "warning" : "danger"}
                                          className="animate-pulse motion-reduce:animate-none"
                                        >
                                          {msg}
                                        </Pill>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    Limite mensal não definido
                                  </p>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className="flex flex-wrap gap-1">
                                {p.cardIds.map((cid) => {
                                  const c = state.cards.find((x) => x.id === cid);
                                  return c ? <Pill key={cid}>•••• {c.last4}</Pill> : null;
                                })}
                                {p.cardIds.length === 0 && (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </div>
                            </td>
                            <td className="num text-right font-semibold">
                              {fmtBRL(debt)}
                              {credit > 0 && (
                                <div className="text-xs font-normal text-success">
                                  Crédito: {fmtBRL(credit)}
                                </div>
                              )}
                            </td>
                            <td className="num text-right">{fmtBRL(total)}</td>
                            <td className="num text-right text-success">
                              <div className="font-semibold">Total: {fmtBRL(received)}</div>
                              {receipts.map((receipt) => (
                                <div
                                  key={receipt.id}
                                  className="flex items-center justify-end gap-1 text-xs"
                                >
                                  <span>
                                    {fmtBRL(receipt.amount)} ·{" "}
                                    {fmtDate(receipt.paidAt.slice(0, 10))}
                                  </span>
                                  <button
                                    type="button"
                                    className="inline-flex size-6 items-center justify-center rounded-md hover:bg-muted"
                                    aria-label={`Editar recebimento de ${fmtBRL(receipt.amount)} em ${fmtDate(receipt.paidAt.slice(0, 10))}`}
                                    title="Editar valor ou data do recebimento"
                                    onClick={() => editReceipt(receipt)}
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                </div>
                              ))}
                              {applied > 0 && (
                                <div className="text-xs font-normal text-muted-foreground">
                                  Aplicado à fatura: {fmtBRL(applied)}
                                </div>
                              )}
                              {monthSurplus > 0 && (
                                <div className="text-xs font-semibold text-success">
                                  Sobra: {fmtBRL(received)} − {fmtBRL(applied)} = +
                                  {fmtBRL(monthSurplus)}
                                </div>
                              )}
                            </td>
                            <td
                              className={cn(
                                "num text-right",
                                remaining > 0 && "font-semibold text-danger",
                              )}
                            >
                              {fmtBRL(remaining)}
                            </td>
                            <td>
                              <AccountBalance amount={accountBalance} />
                            </td>
                            <td>
                              {p.active ? (
                                <PaymentStatusBadge status={paymentStatus} />
                              ) : (
                                <Pill>Inativa</Pill>
                              )}
                            </td>
                            <td>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Ações para ${p.name}`}
                                  >
                                    <MoreHorizontal className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link to="/pessoas/$id" params={{ id: p.id }}>
                                      <Eye className="size-4" /> Ver detalhes
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => setEdit(p)}>
                                    <Pencil className="size-4" /> Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setPaymentPerson({
                                        person: p,
                                        remaining: debt,
                                        allowCredit: true,
                                      })
                                    }
                                  >
                                    Já Pagou
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={remaining <= 0}
                                    onSelect={() => {
                                      if (remaining <= 0) return;
                                      dispatch({
                                        type: "recordPersonPayment",
                                        payment: {
                                          id: uid("payment"),
                                          personId: p.id,
                                          amount: remaining,
                                          paidAt: currentLocalDate(),
                                          month: m,
                                          receiptId: uid("receipt"),
                                          receiptMonth: m,
                                        },
                                      });
                                      toast.success(`${p.name} marcada como paga`, {
                                        description: `${fmtBRL(remaining)} registrados em ${fmtMonthLong(m)}.`,
                                      });
                                    }}
                                  >
                                    Marcar parcela do mês como paga
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={remaining <= 0}
                                    onSelect={() =>
                                      remaining > 0 && setPaymentPerson({ person: p, remaining })
                                    }
                                  >
                                    Registrar pagamento parcial
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={paid <= 0}
                                    onSelect={() => {
                                      if (paid <= 0) return;
                                      dispatch({
                                        type: "clearPersonMonthPayments",
                                        personId: p.id,
                                        month: m,
                                      });
                                      toast.success(`${p.name} marcada como pendente`, {
                                        description: `Pagamentos de ${fmtMonthLong(m)} removidos.`,
                                      });
                                    }}
                                  >
                                    Marcar como pendente
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-danger"
                                    onSelect={() => setDel(p)}
                                  >
                                    <Trash2 className="size-4" /> Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-64">
                          <ContextMenuItem asChild>
                            <Link to="/pessoas/$id" params={{ id: p.id }}>
                              <Eye className="size-4" /> Ver detalhes
                            </Link>
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => setEdit(p)}>
                            <Pencil className="size-4" /> Editar pessoa
                          </ContextMenuItem>
                          <ContextMenuItem asChild>
                            <Link to="/compras" search={{ assignTo: p.id, status: "pendente" }}>
                              <UserCheck className="size-4" /> Atribuir compras
                            </Link>
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() =>
                              setPaymentPerson({ person: p, remaining: debt, allowCredit: true })
                            }
                          >
                            Já Pagou
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={async () => {
                              await navigator.clipboard?.writeText(p.name);
                              toast.success("Nome copiado");
                            }}
                          >
                            <Copy className="size-4" /> Copiar nome
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => {
                              dispatch({
                                type: "upsertPerson",
                                person: { ...p, active: !p.active },
                              });
                              toast.success(p.active ? "Pessoa desativada" : "Pessoa reativada");
                            }}
                          >
                            <UserPlus className="size-4" />{" "}
                            {p.active ? "Desativar pessoa" : "Reativar pessoa"}
                          </ContextMenuItem>
                          <ContextMenuItem className="text-danger" onSelect={() => setDel(p)}>
                            <Trash2 className="size-4" /> Excluir pessoa
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {edit && (
        <PersonDialog person={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />
      )}

      {paymentPerson && (
        <PersonPaymentDialog
          person={paymentPerson.person}
          remaining={paymentPerson.remaining}
          allowCredit={paymentPerson.allowCredit ?? false}
          receipt={paymentPerson.receipt}
          month={m}
          onClose={() => setPaymentPerson(null)}
        />
      )}

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {del?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              As compras atribuídas a esta pessoa (
              {
                state.transactions.filter((t) => t.allocations.some((a) => a.personId === del?.id))
                  .length
              }
              ) voltarão para as pendências. Os valores originais das faturas não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (del) {
                  dispatch({ type: "deletePerson", personId: del.id });
                  toast.success(`${del.name} foi excluída`);
                }
                setDel(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AccountBalance({ amount, align = "right" }: { amount: number; align?: "left" | "right" }) {
  const tone = amount > 0 ? "text-success" : amount < 0 ? "text-danger" : "text-muted-foreground";
  const description =
    amount > 0
      ? "Crédito para compras futuras"
      : amount < 0
        ? "Total ainda em aberto"
        : "Conta quitada";
  const signedAmount =
    amount > 0 ? `+ ${fmtBRL(amount)}` : amount < 0 ? `− ${fmtBRL(Math.abs(amount))}` : fmtBRL(0);

  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className={cn("num font-semibold", tone)}>{signedAmount}</div>
      <div className={cn("text-xs", tone)}>{description}</div>
    </div>
  );
}

function PersonPaymentDialog({
  person,
  remaining,
  allowCredit,
  receipt,
  month,
  onClose,
}: {
  person: Person;
  remaining: number;
  allowCredit: boolean;
  receipt?: PersonReceiptSummary;
  month: string;
  onClose: () => void;
}) {
  const { state, dispatch } = useFinance();
  const [amount, setAmount] = useState(
    receipt
      ? receipt.amount.toFixed(2).replace(".", ",")
      : allowCredit
        ? ""
        : remaining.toFixed(2).replace(".", ","),
  );
  const [paidDate, setPaidDate] = useState(
    () => receipt?.paidAt.slice(0, 10) ?? currentLocalDate(),
  );
  const value = parseBRL(amount);
  const receiptPaymentIds = new Set(receipt?.paymentIds ?? []);
  const stateWithoutReceipt = receipt
    ? {
        ...state,
        payments: (state.payments ?? []).filter((payment) => !receiptPaymentIds.has(payment.id)),
      }
    : state;
  const valid =
    value !== null && value > 0 && paidDate.length > 0 && (allowCredit || value <= remaining);
  const projectedCredit =
    allowCredit && value !== null
      ? Math.max(
          0,
          round2(
            personCreditBalance(stateWithoutReceipt, person.id) +
              value -
              personDebtTotal(stateWithoutReceipt, person.id),
          ),
        )
      : 0;

  const save = () => {
    if (!valid || value === null) return;
    if (allowCredit || receipt) {
      const payments = buildPersonReceiptPayments(
        stateWithoutReceipt,
        person.id,
        round2(value),
        paidDate,
        month,
      );
      if (receipt) {
        dispatch({
          type: "replacePersonPaymentBatch",
          paymentIds: receipt.paymentIds,
          payments,
        });
      } else {
        dispatch({ type: "recordPersonPaymentBatch", payments });
      }
      toast.success(receipt ? "Recebimento atualizado" : "Recebimento registrado", {
        description:
          projectedCredit > 0
            ? `${fmtBRL(value)} em ${fmtDate(paidDate)} para ${person.name}. Crédito disponível para futuras compras: ${fmtBRL(projectedCredit)}.`
            : `${fmtBRL(value)} em ${fmtDate(paidDate)} para ${person.name}. Os débitos conhecidos foram abatidos.`,
      });
    } else {
      dispatch({
        type: "recordPersonPayment",
        payment: {
          id: uid("payment"),
          personId: person.id,
          amount: round2(value),
          paidAt: paidDate,
          month,
          receiptId: uid("receipt"),
          receiptMonth: month,
        },
      });
      toast.success("Pagamento registrado", {
        description: `${fmtBRL(value)} em ${fmtDate(paidDate)} para ${person.name}. Saldo restante: ${fmtBRL(Math.max(0, round2(remaining - value)))}`,
      });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {receipt ? "Editar recebimento" : allowCredit ? "Já Pagou" : "Registrar pagamento"}
          </DialogTitle>
          <DialogDescription>
            {allowCredit
              ? `Informe quanto ${person.name} já pagou. O valor quitará primeiro os débitos conhecidos; qualquer excedente ficará como crédito para abater compras atribuídas a ela depois.`
              : `Informe quanto ${person.name} pagou em ${fmtMonthLong(month)}. O saldo restante é ${fmtBRL(remaining)}.`}
          </DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium">
          {allowCredit ? "Valor recebido" : "Valor pago"}
          <Input
            className="mt-1"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0,00"
            autoFocus
          />
        </label>
        <label className="text-sm font-medium">
          Data do recebimento
          <Input
            className="mt-1"
            type="date"
            value={paidDate}
            onChange={(event) => setPaidDate(event.target.value)}
          />
        </label>
        {allowCredit && value !== null && value > 0 && projectedCredit > 0 && (
          <p className="text-sm text-success">
            Crédito após quitar os débitos conhecidos: {fmtBRL(projectedCredit)}
          </p>
        )}
        {!allowCredit && value !== null && value > remaining && (
          <p className="text-sm text-danger">O valor não pode ser maior que o saldo restante.</p>
        )}
        {value !== null && value <= 0 && (
          <p className="text-sm text-danger">Informe um valor maior que zero.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!valid}>
            {allowCredit ? "Confirmar recebimento" : "Registrar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
