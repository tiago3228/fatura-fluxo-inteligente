import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileSpreadsheet, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/lib/finance/store";
import { DemoTag, Field, MonthSelect, PageHeader, Panel } from "@/components/app/common";
import { ExcelImportDialog } from "@/components/app/ExcelImportDialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Fatura em Dia" },
      { name: "description", content: "Preferências de exibição, alertas, exportação e importação do organizador de faturas." },
      { property: "og:title", content: "Configurações — Fatura em Dia" },
      { property: "og:description", content: "Ajuste o organizador de faturas." },
    ],
  }),
  component: Configuracoes,
});

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-semibold">{title}</p>{desc && <p className="text-xs text-muted-foreground">{desc}</p>}</div>{children}</div>;
}

function Configuracoes() {
  const { state, dispatch } = useFinance();
  const s = state.settings;
  const set = (patch: Partial<typeof s>) => dispatch({ type: "updateSettings", patch });
  const [warn, setWarn] = useState(String(s.warnPct));
  const [xls, setXls] = useState(false);
  const warnN = Number(warn);
  const warnErr = Number.isInteger(warnN) && warnN >= 1 && warnN <= 99 ? undefined : "Entre 1 e 99";

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Preferências de exibição">
          <div className="divide-y">
            <Row title="Tabelas compactas" desc="Reduz a altura das linhas"><Switch checked={s.compact} onCheckedChange={(v) => set({ compact: v })} aria-label="Tabelas compactas" /></Row>
            <Row title="Mês de referência" desc="Usado na visão geral, pessoas e parcelamentos"><MonthSelect /></Row>
          </div>
        </Panel>
        <Panel title="Regras de alertas" description="Regra demonstrativa de limite individual">
          <div className="space-y-3 p-4">
            <Field label="Alerta de atenção a partir de (%)" htmlFor="warn" error={warnErr} hint="100% = limite atingido; acima disso = ultrapassado">
              <div className="flex gap-2">
                <Input id="warn" className="num w-24" inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} />
                <Button variant="outline" disabled={!!warnErr || warnN === s.warnPct} onClick={() => { set({ warnPct: warnN }); toast.success(`Alerta de atenção ajustado para ${warnN}%`); }}>Aplicar</Button>
              </div>
            </Field>
          </div>
        </Panel>
        <Panel title="Exportação">
          <Row title="Separador do CSV" desc="Ponto e vírgula funciona melhor no Excel em português">
            <Select value={s.csvSeparator} onValueChange={(v) => set({ csvSeparator: v as ";" | "," })}>
              <SelectTrigger className="w-44" aria-label="Separador do CSV"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value=";">Ponto e vírgula (;)</SelectItem><SelectItem value=",">Vírgula (,)</SelectItem></SelectContent>
            </Select>
          </Row>
        </Panel>
        <Panel title="Importação">
          <div className="divide-y">
            <Row title="Detectar possíveis duplicidades" desc="Sinaliza linhas com mesma data, valor e descrição"><Switch checked={s.duplicateCheck} onCheckedChange={(v) => set({ duplicateCheck: v })} aria-label="Detectar duplicidades" /></Row>
            <Row title="Importar planilha Excel" desc="Migre os dados da sua planilha atual (.xlsx ou .csv)"><Button variant="outline" onClick={() => setXls(true)}><FileSpreadsheet className="size-4" /> Importar planilha</Button></Row>
          </div>
        </Panel>
        <Panel title="Sobre esta versão" className="lg:col-span-2">
          <div className="divide-y">
            <div className="space-y-2 px-4 py-3 text-sm text-muted-foreground">
              <DemoTag />
              <p>Esta é uma versão local, sem servidor e sem login. Os dados ficam apenas neste navegador e <b>não são sincronizados entre computadores</b>.</p>
              <p>A importação de PDF lê localmente PDFs com texto selecionável e sempre exige conferência. PDFs escaneados ou com layout não reconhecido são sinalizados para revisão manual. A planilha Excel também é lida localmente no navegador.</p>
            </div>
            <Row title="Guardar dados neste navegador" desc="Desligado, as alterações se perdem ao recarregar a página"><Switch checked={s.persist} onCheckedChange={(v) => set({ persist: v })} aria-label="Guardar dados neste navegador" /></Row>
            <Row title="Restaurar dados importados" desc="Apaga suas alterações locais">
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="outline"><RotateCcw className="size-4" /> Restaurar</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Restaurar dados importados?</AlertDialogTitle><AlertDialogDescription>As alterações locais serão substituídas pela base atual da fatura importada.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => { dispatch({ type: "reset" }); setWarn("80"); toast.success("Dados restaurados"); }}>Restaurar</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Row>
          </div>
        </Panel>
      </div>
      <ExcelImportDialog open={xls} onOpenChange={setXls} />
    </>
  );
}
