import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  CircleCheck,
  CircleDollarSign,
  Clock3,
  Ellipsis,
  Pencil,
  Plus,
  ReceiptText,
  Scissors,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useFinance } from "@/lib/finance/store";
import type { OtherAccount, OtherAccountCategory, OtherAccountStatus } from "@/lib/finance/types";
import { fmtBRL, fmtDate } from "@/lib/finance/format";
import { createDefaultOtherAccountCategories } from "@/lib/finance/otherAccounts";
import { PageHeader, Panel } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { OtherAccountDialog } from "@/components/app/OtherAccountDialog";
import { OtherAccountCategoryDialog } from "@/components/app/OtherAccountCategoryDialog";
import { OtherAccountPeopleDialog } from "@/components/app/OtherAccountPeopleDialog";

export const Route = createFileRoute("/_authenticated/outras-contas")({
  head: () => ({
    meta: [
      { title: "Outras contas — Fatura em Dia" },
      {
        name: "description",
        content: "Organize contas domésticas, responsáveis e rateios por pessoa.",
      },
      { property: "og:title", content: "Outras contas — Fatura em Dia" },
      {
        property: "og:description",
        content: "Energia, água, internet, botijão de gás, condomínio, IPTU, IPVA e outras contas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OtherAccountsPage,
});

type AccountFilter = "all" | OtherAccountStatus;

function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function OtherAccountsPage() {
  const { state, dispatch } = useFinance();
  const categories = state.otherAccountCategories ?? createDefaultOtherAccountCategories();
  const accounts = state.otherAccounts ?? [];
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AccountFilter>("all");
  const [search, setSearch] = useState("");
  const [accountDialog, setAccountDialog] = useState<OtherAccount | "new" | null>(null);
  const [newAccountCategoryId, setNewAccountCategoryId] = useState<string | undefined>();
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [peopleDialog, setPeopleDialog] = useState<{
    account: OtherAccount;
    mode: "associate" | "split";
  } | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<OtherAccount | null>(null);

  const normalizedCategories = useMemo(() => categories, [categories]);
  const today = todayLocal();
  const pending = accounts.filter((account) => account.status === "pending");
  const paid = accounts.filter((account) => account.status === "paid");
  const overdueCount = pending.filter((account) => account.dueDate < today).length;
  const pendingTotal = pending.reduce((sum, account) => sum + account.amountCents, 0);
  const paidTotal = paid.reduce((sum, account) => sum + account.amountCents, 0);
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const visibleAccounts = [...accounts]
    .filter((account) => categoryFilter === "all" || account.categoryId === categoryFilter)
    .filter((account) => statusFilter === "all" || account.status === statusFilter)
    .filter((account) => {
      if (!query) return true;
      const categoryName =
        normalizedCategories.find((category) => category.id === account.categoryId)?.name ?? "";
      const peopleNames = account.responsibilities.map((item) => item.personName).join(" ");
      return `${account.description} ${account.notes ?? ""} ${categoryName} ${peopleNames}`
        .toLocaleLowerCase("pt-BR")
        .includes(query);
    })
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));

  const openNewAccount = (categoryId?: string) => {
    setNewAccountCategoryId(categoryId);
    setAccountDialog("new");
  };

  const setStatus = (account: OtherAccount, status: OtherAccountStatus) => {
    dispatch({
      type: "setOtherAccountStatus",
      accountId: account.id,
      status,
      ...(status === "paid" ? { paidAt: todayLocal() } : {}),
    });
    toast.success(status === "paid" ? "Conta marcada como paga" : "Conta marcada como pendente", {
      description: account.description,
    });
  };

  const deleteCategory = (category: OtherAccountCategory) => {
    dispatch({ type: "deleteOtherAccountCategory", categoryId: category.id });
    toast.success(`Tipo “${category.name}” removido`);
    if (categoryFilter === category.id) setCategoryFilter("all");
  };

  return (
    <>
      <PageHeader
        title="Outras contas"
        description="Organize contas da casa, associe responsáveis e divida o valor sem misturar com faturas de cartão."
        actions={
          <>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(true)}>
              <Tag className="size-4" /> Novo tipo
            </Button>
            <Button onClick={() => openNewAccount()}>
              <Plus className="size-4" /> Adicionar conta
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CircleDollarSign className="size-4" /> Pendente
          </div>
          <p className="num mt-2 text-2xl font-bold">{fmtBRL(pendingTotal / 100)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending.length} {pending.length === 1 ? "conta em aberto" : "contas em aberto"}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock3 className="size-4" /> Vencidas
          </div>
          <p className="num mt-2 text-2xl font-bold">{overdueCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {overdueCount === 1 ? "conta passou do vencimento" : "contas passaram do vencimento"}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CircleCheck className="size-4" /> Marcado como pago
          </div>
          <p className="num mt-2 text-2xl font-bold">{fmtBRL(paidTotal / 100)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {paid.length} {paid.length === 1 ? "conta paga" : "contas pagas"}
          </p>
        </div>
      </div>

      <Panel>
        <div className="space-y-3 border-b p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar conta, fornecedor ou pessoa…"
              aria-label="Buscar contas domésticas"
              className="min-w-0 flex-1"
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as AccountFilter)}
            >
              <SelectTrigger className="w-full bg-card sm:w-44" aria-label="Filtrar por situação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as situações</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="paid">Pagas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Filtrar por tipo de conta">
            <Button
              size="sm"
              variant={categoryFilter === "all" ? "default" : "outline"}
              onClick={() => setCategoryFilter("all")}
            >
              Todas <span className="ml-1 opacity-70">{accounts.length}</span>
            </Button>
            {normalizedCategories.map((category) => {
              const count = accounts.filter((account) => account.categoryId === category.id).length;
              const used = count > 0;
              return (
                <ContextMenu key={category.id}>
                  <ContextMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant={categoryFilter === category.id ? "default" : "outline"}
                      onClick={() => setCategoryFilter(category.id)}
                      title="Clique para filtrar; botão direito para opções do tipo"
                    >
                      {category.name} <span className="ml-1 opacity-70">{count}</span>
                    </Button>
                  </ContextMenuTrigger>
                  {!category.builtIn && (
                    <ContextMenuContent>
                      <ContextMenuItem disabled={used} onSelect={() => deleteCategory(category)}>
                        <Trash2 className="size-4" /> Remover tipo
                        {used ? " (há contas vinculadas)" : ""}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  )}
                </ContextMenu>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Dica: clique com o botão direito numa conta para associar pessoas, dividir, editar ou
            marcar como paga. No celular, use os botões visíveis em cada conta.
          </p>
        </div>

        {visibleAccounts.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <ReceiptText className="size-5" />
            </span>
            <h2 className="mt-3 font-semibold">
              {accounts.length === 0
                ? "Nenhuma outra conta cadastrada"
                : "Nenhuma conta encontrada"}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {accounts.length === 0
                ? "Comece cadastrando uma conta de energia, água, internet, botijão de gás, condomínio, IPTU, IPVA ou um tipo personalizado."
                : "Tente mudar o tipo, a situação ou o texto da busca."}
            </p>
            {accounts.length === 0 && (
              <Button className="mt-4" onClick={() => openNewAccount()}>
                <Plus className="size-4" /> Adicionar conta
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
            {visibleAccounts.map((account) => {
              const category = normalizedCategories.find((item) => item.id === account.categoryId);
              const isOverdue = account.status === "pending" && account.dueDate < today;
              const hasSplit =
                account.responsibilities.length > 0 &&
                account.responsibilities.every((person) => person.amountCents !== undefined);
              const peopleSummary = account.responsibilities
                .map((person) => person.personName)
                .join(", ");
              const showSplit = () => setPeopleDialog({ account, mode: "split" });
              const showAssociation = () => setPeopleDialog({ account, mode: "associate" });
              const edit = () => setAccountDialog(account);
              const togglePaid = () =>
                setStatus(account, account.status === "paid" ? "pending" : "paid");
              return (
                <ContextMenu key={account.id}>
                  <ContextMenuTrigger asChild>
                    <article className="fade-in-up flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {category?.name ?? "Outro tipo"}
                          </p>
                          <h2
                            className="mt-1 truncate text-lg font-bold"
                            title={account.description}
                          >
                            {account.description}
                          </h2>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${account.status === "paid" ? "bg-success-soft text-success" : isOverdue ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}
                        >
                          {account.status === "paid" ? "Paga" : isOverdue ? "Vencida" : "Pendente"}
                        </span>
                      </div>
                      <p className="num mt-4 text-2xl font-bold">
                        {fmtBRL(account.amountCents / 100)}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarDays className="size-4 shrink-0" />
                        <span>
                          Vencimento:{" "}
                          <strong className={isOverdue ? "text-danger" : "text-foreground"}>
                            {fmtDate(account.dueDate)}
                          </strong>
                        </span>
                      </div>
                      {account.status === "paid" && account.paidAt && (
                        <p className="mt-1 pl-6 text-xs text-muted-foreground">
                          Pago em {fmtDate(account.paidAt)}
                        </p>
                      )}
                      {peopleSummary ? (
                        <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs">
                          <p className="flex items-center gap-1 font-semibold">
                            <Users className="size-3.5" />{" "}
                            {hasSplit ? "Dividida entre" : "Responsáveis"}
                          </p>
                          {account.responsibilities.map((person) => (
                            <p key={person.personId} className="mt-1 flex justify-between gap-2">
                              <span className="truncate">{person.personName}</span>
                              {hasSplit && (
                                <span className="num font-medium">
                                  {fmtBRL((person.amountCents ?? 0) / 100)}
                                </span>
                              )}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="size-3.5" /> Sem responsáveis associados
                        </p>
                      )}
                      {account.notes && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {account.notes}
                        </p>
                      )}
                      <div className="mt-auto flex flex-wrap gap-2 pt-4">
                        <Button size="sm" variant="outline" onClick={edit}>
                          <Pencil className="size-4" /> Editar
                        </Button>
                        <Button size="sm" variant="outline" onClick={showAssociation}>
                          <Users className="size-4" /> Pessoas
                        </Button>
                        <Button size="sm" variant="outline" onClick={showSplit}>
                          <Scissors className="size-4" /> Dividir
                        </Button>
                        <Button
                          size="sm"
                          variant={account.status === "paid" ? "ghost" : "secondary"}
                          onClick={togglePaid}
                        >
                          {account.status === "paid" ? (
                            <Ellipsis className="size-4" />
                          ) : (
                            <Check className="size-4" />
                          )}
                          {account.status === "paid" ? "Pendente" : "Paga"}
                        </Button>
                      </div>
                    </article>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-64">
                    <ContextMenuItem onSelect={edit}>
                      <Pencil className="size-4" /> Editar conta
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={showAssociation}>
                      <Users className="size-4" /> Associar pessoas
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={showSplit}>
                      <Scissors className="size-4" /> Dividir valor
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={togglePaid}>
                      {account.status === "paid" ? (
                        <Clock3 className="size-4" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Marcar como {account.status === "paid" ? "pendente" : "paga"}
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-danger"
                      onSelect={() => setAccountToDelete(account)}
                    >
                      <Trash2 className="size-4" /> Remover conta
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}
      </Panel>

      {accountDialog === "new" && (
        <OtherAccountDialog
          categoryId={newAccountCategoryId}
          onClose={() => setAccountDialog(null)}
        />
      )}
      {accountDialog && accountDialog !== "new" && (
        <OtherAccountDialog account={accountDialog} onClose={() => setAccountDialog(null)} />
      )}
      {categoryDialogOpen && (
        <OtherAccountCategoryDialog
          onClose={() => setCategoryDialogOpen(false)}
          onSaved={(categoryId) => setCategoryFilter(categoryId)}
        />
      )}
      {peopleDialog && (
        <OtherAccountPeopleDialog
          account={peopleDialog.account}
          mode={peopleDialog.mode}
          onClose={() => setPeopleDialog(null)}
        />
      )}

      <AlertDialog
        open={!!accountToDelete}
        onOpenChange={(open) => !open && setAccountToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {accountToDelete?.description}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta conta será removida do histórico compartilhado. Isso não alterará faturas de
              cartão nem pagamentos de pessoas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAccountToDelete(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!accountToDelete) return;
                dispatch({ type: "deleteOtherAccount", accountId: accountToDelete.id });
                toast.success(`Conta “${accountToDelete.description}” removida`);
                setAccountToDelete(null);
              }}
            >
              Remover conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
