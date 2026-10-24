import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, FolderOpen, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/app/common";
import { useFinance } from "@/lib/finance/store";
import { fmtMonthLong, uid } from "@/lib/finance/format";
import type { SpreadsheetArchive } from "@/lib/finance/types";

export const Route = createFileRoute("/_authenticated/planilhas")({
  head: () => ({
    meta: [
      { title: "Planilhas — Fatura em Dia" },
      { name: "description", content: "Arquive, organize por mês e baixe suas planilhas de compras." },
    ],
  }),
  component: Planilhas,
});

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function monthFromFilename(fileName: string, fallback: string) {
  const normalized = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const year = normalized.match(/20\d{2}/)?.[0];
  const month = Object.entries(MONTHS).find(([name]) => normalized.includes(name))?.[1];
  return year && month ? `${year}-${String(month).padStart(2, "0")}` : fallback;
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Planilhas() {
  const { state, dispatch } = useFinance();
  const input = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(state.settings.month);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const spreadsheets = state.spreadsheets ?? [];
  const groups = useMemo(() => {
    const grouped = new Map<string, SpreadsheetArchive[]>();
    [...spreadsheets].sort((a, b) => b.month.localeCompare(a.month) || b.uploadedAt.localeCompare(a.uploadedAt)).forEach((item) => {
      grouped.set(item.month, [...(grouped.get(item.month) ?? []), item]);
    });
    return [...grouped.entries()];
  }, [spreadsheets]);

  const chooseFile = (file: File | null) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error("Formato não suportado", { description: "Escolha uma planilha .xlsx, .xls ou .csv." });
      return;
    }
    setSelectedFile(file);
    setMonth(monthFromFilename(file.name, state.settings.month));
  };

  const addSpreadsheet = async () => {
    if (!selectedFile) return;
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(selectedFile);
      dispatch({
        type: "addSpreadsheet",
        spreadsheet: {
          id: uid("sheet"),
          fileName: selectedFile.name,
          month,
          uploadedAt: new Date().toISOString(),
          dataUrl,
        },
      });
      toast.success("Planilha arquivada", { description: `${selectedFile.name} foi organizada em ${fmtMonthLong(month)}.` });
      setSelectedFile(null);
      if (input.current) input.current.value = "";
    } catch {
      toast.error("Não foi possível arquivar a planilha");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Planilhas" description="Guarde suas planilhas por mês e baixe o arquivo original quando precisar." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Arquivo de planilhas" description="Os arquivos ficam vinculados ao seu workspace e são sincronizados na nuvem.">
          {groups.length === 0 ? (
            <div className="grid place-items-center gap-3 px-6 py-16 text-center text-muted-foreground">
              <FolderOpen className="size-10" />
              <p className="font-medium">Nenhuma planilha arquivada</p>
              <p className="max-w-md text-sm">Adicione a primeira planilha ao lado para começar seu histórico mensal.</p>
            </div>
          ) : (
            <div className="divide-y">
              {groups.map(([groupMonth, items]) => (
                <section key={groupMonth} className="p-4 sm:p-5" aria-labelledby={`month-${groupMonth}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 id={`month-${groupMonth}`} className="font-semibold">{fmtMonthLong(groupMonth)}</h2>
                      <p className="text-xs text-muted-foreground">{items.length} arquivo(s) neste mês</p>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{groupMonth}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => {
                      const href = item.dataUrl ?? item.publicPath;
                      return (
                        <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileSpreadsheet className="size-5" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium" title={item.fileName}>{item.fileName}</p>
                            <p className="text-xs text-muted-foreground">Adicionada em {new Date(item.uploadedAt).toLocaleDateString("pt-BR")}{item.publicPath ? " · arquivo do aplicativo" : " · arquivo enviado"}</p>
                          </div>
                          {href ? <a href={href} download={item.fileName} className="inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" /> Baixar</a> : null}
                          {!item.publicPath && <Button variant="ghost" size="icon" aria-label={`Excluir ${item.fileName}`} onClick={() => { dispatch({ type: "removeSpreadsheet", spreadsheetId: item.id }); toast.success("Planilha removida do arquivo"); }}><Trash2 className="size-4" /></Button>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Adicionar planilha" description="Escolha o mês de referência e preserve o arquivo original.">
          <div className="space-y-4 p-4 sm:p-5">
            <label className="grid cursor-pointer place-items-center gap-2 rounded-lg border-2 border-dashed p-7 text-center hover:bg-muted/50">
              <Upload className="size-7 text-muted-foreground" />
              <span className="text-sm font-medium">Selecionar arquivo</span>
              <span className="text-xs text-muted-foreground">XLSX, XLS ou CSV</span>
              <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
            </label>
            {selectedFile && <p className="rounded-md bg-muted p-3 text-sm"><b>Selecionado:</b> {selectedFile.name}</p>}
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="spreadsheet-month">Mês da planilha
              <Input id="spreadsheet-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </label>
            <Button className="w-full" disabled={!selectedFile || busy} onClick={() => void addSpreadsheet()}><Upload className="size-4" /> {busy ? "Arquivando…" : "Adicionar ao arquivo"}</Button>
            <p className="text-xs leading-relaxed text-muted-foreground">O nome do arquivo tenta definir o mês automaticamente. Você pode corrigir o mês antes de arquivar.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
