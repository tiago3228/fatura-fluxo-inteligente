import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CreditCard as CardIcon, Eye, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { monthTxs, nextOccurrence } from "@/lib/finance/calc";
import { fmtBRL, fmtDate, fmtMonthLong } from "@/lib/finance/format";
import type { CreditCard } from "@/lib/finance/types";
import { EmptyState, PageHeader } from "@/components/app/common";
import { Pill } from "@/components/app/badges";
import { CardDialog } from "@/components/app/CardDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export const Route = createFileRoute("/_authenticated/cartoes/")({
  head: () => ({
    meta: [
      { title: "Cartões — Fatura em Dia" },
      {
        name: "description",
        content:
          "Cadastre cartões de crédito com fechamento e vencimento próprios, sem dados sensíveis.",
      },
      { property: "og:title", content: "Cartões — Fatura em Dia" },
      { property: "og:description", content: "Seus cartões de crédito organizados." },
    ],
  }),
  component: Cartoes,
});

function Cartoes() {
  const { state, dispatch } = useFinance();
  const [edit, setEdit] = useState<CreditCard | "new" | null>(null);
  const month = state.settings.month;
  const monthCardIds = new Set(
    monthTxs(state, month)
      .filter((transaction) => transaction.type !== "pagamento")
      .map(
        (transaction) =>
          state.invoices.find((invoice) => invoice.id === transaction.invoiceId)?.cardId,
      )
      .filter((cardId): cardId is string => Boolean(cardId)),
  );
  const visibleCards = state.cards.filter((card) => monthCardIds.has(card.id));
  return (
    <>
      <PageHeader
        title="Cartões"
        description="Apenas os 4 últimos dígitos são guardados"
        actions={
          <Button onClick={() => setEdit("new")}>
            <Plus className="size-4" /> Cadastrar cartão
          </Button>
        }
      />
      {state.cards.length === 0 ? (
        <EmptyState title="Nenhum cartão cadastrado" />
      ) : visibleCards.length === 0 ? (
        <EmptyState
          title={`Nenhum cartão com compras em ${fmtMonthLong(month)}`}
          description="Os cartões sem lançamentos nesta competência ficam ocultos, mas continuam cadastrados."
        />
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleCards.map((c) => (
          <ContextMenu key={c.id}>
            <ContextMenuTrigger asChild>
              <article
                className={cn(
                  "fade-in-up rounded-xl border bg-card p-5 shadow-xs",
                  !c.active && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between">
                  <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <CardIcon className="size-5" />
                  </span>
                  {c.active ? <Pill tone="success">Ativo</Pill> : <Pill>Inativo</Pill>}
                </div>
                <h2 className="mt-3 text-lg font-bold">{c.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {c.issuer}
                  {c.brand && ` · ${c.brand}`} · <span className="num">•••• {c.last4}</span>
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <dt className="text-xs text-muted-foreground">Fechamento</dt>
                    <dd className="font-semibold">Dia {c.closingDay}</dd>
                    <dd className="num text-xs text-muted-foreground">
                      próx. {fmtDate(nextOccurrence(c.closingDay))}*
                    </dd>
                  </div>
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <dt className="text-xs text-muted-foreground">Vencimento</dt>
                    <dd className="font-semibold">Dia {c.dueDay}</dd>
                    <dd className="num text-xs text-muted-foreground">
                      próx. {fmtDate(nextOccurrence(c.dueDay))}*
                    </dd>
                  </div>
                  <div className="col-span-2 rounded-lg bg-muted px-3 py-2">
                    <dt className="text-xs text-muted-foreground">Limite de crédito</dt>
                    <dd className="num font-semibold">
                      {c.creditLimit === undefined ? "Não informado" : fmtBRL(c.creditLimit)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/cartoes/$id" params={{ id: c.id }}>
                      <Eye className="size-4" /> Detalhes
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEdit(c)}>
                    <Pencil className="size-4" /> Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      dispatch({ type: "upsertCard", card: { ...c, active: !c.active } });
                      toast.success(c.active ? "Cartão desativado" : "Cartão reativado");
                    }}
                  >
                    <Power className="size-4" /> {c.active ? "Desativar" : "Ativar"}
                  </Button>
                </div>
              </article>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-60">
              <ContextMenuItem asChild>
                <Link to="/cartoes/$id" params={{ id: c.id }}>
                  <Eye className="size-4" /> Ver detalhes
                </Link>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setEdit(c)}>
                <Pencil className="size-4" /> Editar cartão
              </ContextMenuItem>
              <ContextMenuItem asChild>
                <Link to="/compras" search={{ last4: c.last4 }}>
                  <CardIcon className="size-4" /> Ver compras deste cartão
                </Link>
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={async () => {
                  await navigator.clipboard?.writeText(`${c.name} •••• ${c.last4}`);
                  toast.success("Identificação copiada");
                }}
              >
                <CardIcon className="size-4" /> Copiar identificação
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => {
                  dispatch({ type: "upsertCard", card: { ...c, active: !c.active } });
                  toast.success(c.active ? "Cartão desativado" : "Cartão reativado");
                }}
              >
                <Power className="size-4" /> {c.active ? "Desativar cartão" : "Reativar cartão"}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        * Datas estimadas pelo calendário; em meses com menos dias, considera-se o último dia do
        mês. O banco pode ajustar para dias úteis.
      </p>
      {edit === "new" && <CardDialog onClose={() => setEdit(null)} />}
      {edit && edit !== "new" && <CardDialog card={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
