import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileSpreadsheet, History, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { DemoTag, Field, MonthSelect, PageHeader, Panel } from "@/components/app/common";
import { ExcelImportDialog } from "@/components/app/ExcelImportDialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Fatura em Dia" },
      {
        name: "description",
        content:
          "Preferências de exibição, alertas, exportação e importação do organizador de faturas.",
      },
      { property: "og:title", content: "Configurações — Fatura em Dia" },
      { property: "og:description", content: "Ajuste o organizador de faturas." },
    ],
  }),
  component: Configuracoes,
});

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function AuditPanel() {
  const { state, dispatch } = useFinance();
  const entries = state.auditLog ?? [];
  return (
    <Panel
      title="Histórico de atividades"
      description="Alterações feitas pelas contas autorizadas no workspace compartilhado."
    >
      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <History className="size-8 text-muted-foreground" />
          <p className="font-semibold">Nenhuma atividade registrada</p>
          <p className="max-w-md text-sm text-muted-foreground">
            As próximas alterações feitas por você ou sua irmã aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="divide-y">
          {entries.map((entry) => (
            <ContextMenu key={entry.id}>
              <ContextMenuTrigger asChild>
                <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <History className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        entry.undoneAt ? "text-sm text-muted-foreground line-through" : "text-sm"
                      }
                    >
                      {entry.description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString("pt-BR")} · {entry.actorName}
                      {entry.undoneAt ? " · Desfeita" : ""}
                    </p>
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {entry.undo && !entry.undoneAt ? (
                  <ContextMenuItem
                    onSelect={() => {
                      dispatch({ type: "undoAudit", auditId: entry.id });
                      toast.success("Ação desfeita");
                    }}
                  >
                    <Undo2 className="size-4" /> Desfazer
                  </ContextMenuItem>
                ) : (
                  <ContextMenuItem disabled>
                    {entry.undoneAt ? "Ação já desfeita" : "Esta ação não pode ser desfeita"}
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Configuracoes() {
  const { state, dispatch, syncStatus } = useFinance();
  const s = state.settings;
  const set = (patch: Partial<typeof s>) => dispatch({ type: "updateSettings", patch });
  const [warn, setWarn] = useState(String(s.warnPct));
  const [xls, setXls] = useState(false);
  const warnN = Number(warn);
  const warnErr = Number.isInteger(warnN) && warnN >= 1 && warnN <= 99 ? undefined : "Entre 1 e 99";

  return (
    <>
      <PageHeader title="Configurações" />
      <Tabs defaultValue="preferencias" className="space-y-4">
        <TabsList>
          <TabsTrigger value="preferencias">Preferências</TabsTrigger>
          <TabsTrigger value="auditoria">
            <History className="size-4" /> Auditoria
          </TabsTrigger>
        </TabsList>
        <TabsContent value="preferencias">
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Preferências de exibição">
              <div className="divide-y">
                <Row title="Tabelas compactas" desc="Reduz a altura das linhas">
                  <Switch
                    checked={s.compact}
                    onCheckedChange={(v) => set({ compact: v })}
                    aria-label="Tabelas compactas"
                  />
                </Row>
                <Row title="Mês de referência" desc="Usado na visão geral, pessoas e parcelamentos">
                  <MonthSelect />
                </Row>
              </div>
            </Panel>
            <Panel title="Regras de alertas" description="Regra demonstrativa de limite individual">
              <div className="space-y-3 p-4">
                <Field
                  label="Alerta de atenção a partir de (%)"
                  htmlFor="warn"
                  error={warnErr}
                  hint="100% = limite atingido; acima disso = ultrapassado"
                >
                  <div className="flex gap-2">
                    <Input
                      id="warn"
                      className="num w-24"
                      inputMode="numeric"
                      value={warn}
                      onChange={(e) => setWarn(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={!!warnErr || warnN === s.warnPct}
                      onClick={() => {
                        set({ warnPct: warnN });
                        toast.success(`Alerta de atenção ajustado para ${warnN}%`);
                      }}
                    >
                      Aplicar
                    </Button>
                  </div>
                </Field>
              </div>
            </Panel>
            <Panel title="Exportação">
              <Row
                title="Separador do CSV"
                desc="Ponto e vírgula funciona melhor no Excel em português"
              >
                <Select
                  value={s.csvSeparator}
                  onValueChange={(v) => set({ csvSeparator: v as ";" | "," })}
                >
                  <SelectTrigger className="w-44" aria-label="Separador do CSV">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=";">Ponto e vírgula (;)</SelectItem>
                    <SelectItem value=",">Vírgula (,)</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
            </Panel>
            <Panel title="Importação">
              <div className="divide-y">
                <Row
                  title="Detectar possíveis duplicidades"
                  desc="Sinaliza linhas com mesma data, valor e descrição"
                >
                  <Switch
                    checked={s.duplicateCheck}
                    onCheckedChange={(v) => set({ duplicateCheck: v })}
                    aria-label="Detectar duplicidades"
                  />
                </Row>
                <Row
                  title="Importar planilha Excel"
                  desc="Migre os dados da sua planilha atual (.xlsx ou .csv)"
                >
                  <Button variant="outline" onClick={() => setXls(true)}>
                    <FileSpreadsheet className="size-4" /> Importar planilha
                  </Button>
                </Row>
              </div>
            </Panel>
            <Panel title="Sobre esta versão" className="lg:col-span-2">
              <div className="divide-y">
                <div className="space-y-2 px-4 py-3 text-sm text-muted-foreground">
                  <p>
                    As contas autorizadas no workspace familiar compartilham faturas, cartões,
                    pessoas e lançamentos pela nuvem. A sincronização mostra seu estado no
                    cabeçalho; confira-o antes de encerrar uma sessão.
                  </p>
                  <p>
                    A importação de PDF lê localmente PDFs com texto selecionável e sempre exige
                    conferência. PDFs escaneados ou com layout não reconhecido são sinalizados para
                    revisão manual. A planilha Excel também é lida localmente no navegador.
                  </p>
                </div>
                <Row
                  title="Guardar uma cópia neste navegador"
                  desc="Desligado, remove o cache local; a sincronização da conta continua ativa"
                >
                  <Switch
                    checked={s.persist}
                    onCheckedChange={(v) => set({ persist: v })}
                    aria-label="Guardar uma cópia neste navegador"
                  />
                </Row>
                <Row
                  title="Redefinir dados de demonstração"
                  desc={
                    syncStatus === "local"
                      ? "Substitui os exemplos deste navegador por dados de demonstração"
                      : "Disponível apenas no modo local, fora do workspace sincronizado"
                  }
                >
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={syncStatus !== "local"}>
                        <RotateCcw className="size-4" /> Redefinir exemplos
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Redefinir para dados de demonstração?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação substitui o estado atual deste navegador por exemplos e não
                          recupera faturas importadas. Ela só fica disponível fora de um workspace
                          sincronizado.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            dispatch({ type: "reset" });
                            setWarn("80");
                            toast.success("Dados de demonstração redefinidos");
                          }}
                        >
                          Redefinir exemplos
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </Row>
              </div>
            </Panel>
          </div>
        </TabsContent>
        <TabsContent value="auditoria">
          <AuditPanel />
        </TabsContent>
      </Tabs>
      <ExcelImportDialog open={xls} onOpenChange={setXls} />
    </>
  );
}
