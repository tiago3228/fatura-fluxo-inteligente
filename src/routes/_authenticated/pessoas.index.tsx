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
  limitMessage,
  limitStatus,
  personDebtTotal,
  personMonthLimitAvailable,
  personMonthPaid,
  personMonthRemaining,
  personMonthTotal,
  personPaymentStatus,
} from "@/lib/finance/calc";
import { fmtBRL, fmtMonthLong, parseBRL, round2, uid } from "@/lib/finance/format";
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
    ],
  }),
  component: Pessoas,
});

function Pessoas() {
  const { state, dispatch } = useFinance();
  const m = state.settings.month;
  const [edit, setEdit] = useState<Person | "new" | null>(null);
  const [del, setDel] = useState<Person | null>(null);
  const [paymentPerson, setPaymentPerson] = useState<{ person: Person; remaining: number } | null>(
    null,
  );
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
                const remaining = personMonthRemaining(state, p.id, m);
                const debt = personDebtTotal(state, p.id);
                const paymentStatus = personPaymentStatus(state, p.id, m);
                const msg = limitMessage(p.name, total, p.limit, state.settings.warnPct);
                const budgetStatus = limitStatus(total, p.limit, state.settings.warnPct);
                const budgetAvailable = personMonthLimitAvailable(state, p.id, m);
                const budgetExceeded = p.limit > 0 ? Math.max(0, round2(total - p.limit)) : 0;
                const isExpanded = expanded.includes(p.id);
                return (
                  <article key={p.id} className={cn("p-4", !p.active && "opacity-60")}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/pessoas/$id"
                          params={{ id: p.id }}
                          className="font-semibold hover:underline"
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
                            disabled={remaining <= 0}
                            onSelect={() => {
                              if (remaining <= 0) return;
                              dispatch({
                                type: "recordPersonPayment",
                                payment: {
                                  id: uid("payment"),
                                  personId: p.id,
                                  amount: remaining,
                                  paidAt: new Date().toISOString(),
                                  month: m,
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
                        <p className="text-xs text-muted-foreground">Falta pagar</p>
                        <p
                          className={cn("num mt-0.5 font-semibold", remaining > 0 && "text-danger")}
                        >
                          {fmtBRL(remaining)}
                        </p>
                      </div>
                    </div>
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
                            <p className="text-xs text-muted-foreground">Pago no mês</p>
                            <p className="num font-semibold text-success">{fmtBRL(paid)}</p>
                          </div>
                        </div>
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
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="[&_th]:px-4 [&_th]:py-2.5">
                    <th>Nome</th>
                    <th>Cartões</th>
                    <th className="text-right">Valor Total Devido</th>
                    <th className="text-right">Fatura do mês</th>
                    <th className="text-right">Pago no mês</th>
                    <th className="text-right">Falta pagar</th>
                    <th>Status</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {state.people.map((p) => {
                    const total = personMonthTotal(state, p.id, m);
                    const paid = personMonthPaid(state, p.id, m);
                    const remaining = personMonthRemaining(state, p.id, m);
                    const debt = personDebtTotal(state, p.id);
                    const paymentStatus = personPaymentStatus(state, p.id, m);
                    const msg = limitMessage(p.name, total, p.limit, state.settings.warnPct);
                    const budgetStatus = limitStatus(total, p.limit, state.settings.warnPct);
                    const budgetAvailable = personMonthLimitAvailable(state, p.id, m);
                    const budgetExceeded = p.limit > 0 ? Math.max(0, round2(total - p.limit)) : 0;
                    return (
                      <ContextMenu key={p.id}>
                        <ContextMenuTrigger asChild>
                          <tr
                            className={cn(
                              "hover:bg-muted/40 [&_td]:px-4 [&_td]:py-3",
                              !p.active && "opacity-60",
                            )}
                          >
                            <td className="min-w-[240px]">
                              <Link
                                to="/pessoas/$id"
                                params={{ id: p.id }}
                                className="font-semibold hover:underline"
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
                            <td className="num text-right font-semibold">{fmtBRL(debt)}</td>
                            <td className="num text-right">{fmtBRL(total)}</td>
                            <td className="num text-right text-success">{fmtBRL(paid)}</td>
                            <td
                              className={cn(
                                "num text-right",
                                remaining > 0 && "font-semibold text-danger",
                              )}
                            >
                              {fmtBRL(remaining)}
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
                                    disabled={remaining <= 0}
                                    onSelect={() => {
                                      if (remaining <= 0) return;
                                      dispatch({
                                        type: "recordPersonPayment",
                                        payment: {
                                          id: uid("payment"),
                                          personId: p.id,
                                          amount: remaining,
                                          paidAt: new Date().toISOString(),
                                          month: m,
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

function PersonPaymentDialog({
  person,
  remaining,
  month,
  onClose,
}: {
  person: Person;
  remaining: number;
  month: string;
  onClose: () => void;
}) {
  const { dispatch } = useFinance();
  const [amount, setAmount] = useState(remaining.toFixed(2).replace(".", ","));
  const value = parseBRL(amount);
  const valid = value !== null && value > 0 && value <= remaining;

  const save = () => {
    if (!valid || value === null) return;
    dispatch({
      type: "recordPersonPayment",
      payment: {
        id: uid("payment"),
        personId: person.id,
        amount: round2(value),
        paidAt: new Date().toISOString(),
        month,
      },
    });
    toast.success("Pagamento registrado", {
      description: `${fmtBRL(value)} para ${person.name}. Saldo restante: ${fmtBRL(Math.max(0, round2(remaining - value)))}`,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            Informe quanto {person.name} pagou em {fmtMonthLong(month)}. O saldo restante é{" "}
            {fmtBRL(remaining)}.
          </DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium">
          Valor pago
          <Input
            className="mt-1"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0,00"
            autoFocus
          />
        </label>
        {value !== null && value > remaining && (
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
            Registrar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
