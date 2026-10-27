import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, FolderOpen, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, Panel } from "@/components/app/common";
import { useFinance } from "@/lib/finance/store";
import { fmtMonthLong, uid } from "@/lib/finance/format";
import { isPrivateLegacySpreadsheet, spreadsheetDownloadHref } from "@/lib/finance/archive";
import type { SpreadsheetArchive } from "@/lib/finance/types";
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

export const Route = createFileRoute("/_authenticated/planilhas")({
  head: () => ({
    meta: [
      { title: "Planilhas — Fatura em Dia" },
      {
        name: "description",
        content: "Arquive, organize por mês e baixe suas planilhas de compras.",
      },
    ],
  }),
  component: Planilhas,
});

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};
const EMPTY_SPREADSHEETS: SpreadsheetArchive[] = [];
const ADD_NEW_SPREADSHEET = "__add_new_spreadsheet__";

function monthFromFilename(fileName: string, fallback: string) {
  const normalized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
  const [replacementId, setReplacementId] = useState(ADD_NEW_SPREADSHEET);
  const [pendingDelete, setPendingDelete] = useState<SpreadsheetArchive | null>(null);
  const [pendingReplace, setPendingReplace] = useState<SpreadsheetArchive | null>(null);
  const [busy, setBusy] = useState(false);
  const spreadsheets = state.spreadsheets ?? EMPTY_SPREADSHEETS;
  const monthEntries = spreadsheets.filter((item) => item.month === month);
  const replacementTarget = monthEntries.find((item) => item.id === replacementId);
  const groups = useMemo(() => {
    const grouped = new Map<string, SpreadsheetArchive[]>();
    [...spreadsheets]
      .sort((a, b) => b.month.localeCompare(a.month) || b.uploadedAt.localeCompare(a.uploadedAt))
      .forEach((item) => {
        grouped.set(item.month, [...(grouped.get(item.month) ?? []), item]);
      });
    return [...grouped.entries()];
  }, [spreadsheets]);

  const chooseFile = (file: File | null) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error("Formato não suportado", {
        description: "Escolha uma planilha .xlsx, .xls ou .csv.",
      });
      return;
    }
    const detectedMonth = monthFromFilename(file.name, state.settings.month);
    setSelectedFile(file);
    setMonth(detectedMonth);
    const sameName = spreadsheets.find(
      (item) =>
        item.month === detectedMonth &&
        item.fileName.toLocaleLowerCase() === file.name.toLocaleLowerCase(),
    );
    setReplacementId(sameName?.id ?? ADD_NEW_SPREADSHEET);
  };

  const saveSpreadsheet = async (replaceTarget?: SpreadsheetArchive) => {
    if (!selectedFile) return;
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(selectedFile);
      dispatch({
        type: "addSpreadsheet",
        spreadsheet: {
          id: replaceTarget?.id ?? uid("sheet"),
          fileName: selectedFile.name,
          month,
          uploadedAt: new Date().toISOString(),
          dataUrl,
        },
      });
      toast.success(replaceTarget ? "Planilha substituída" : "Planilha adicionada", {
        description: `${selectedFile.name} foi organizada em ${fmtMonthLong(month)}.`,
      });
      setSelectedFile(null);
      setReplacementId(ADD_NEW_SPREADSHEET);
      if (input.current) input.current.value = "";
    } catch {
      toast.error(
        replaceTarget
          ? "Não foi possível substituir a planilha"
          : "Não foi possível arquivar a planilha",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitSpreadsheet = () => {
    if (!selectedFile) return;
    if (replacementTarget) setPendingReplace(replacementTarget);
    else void saveSpreadsheet();
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    dispatch({ type: "removeSpreadsheet", spreadsheetId: pendingDelete.id });
    toast.success("Planilha removida do arquivo", { description: pendingDelete.fileName });
    setPendingDelete(null);
  };

  const confirmReplace = () => {
    if (!pendingReplace) return;
    const target = pendingReplace;
    setPendingReplace(null);
    void saveSpreadsheet(target);
  };

  return (
    <>
      <PageHeader
        title="Planilhas"
        description="Guarde suas planilhas por mês e baixe o arquivo original quando precisar."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Arquivo de planilhas"
          description="Os arquivos ficam vinculados ao seu workspace e são sincronizados na nuvem."
        >
          {groups.length === 0 ? (
            <div className="grid place-items-center gap-3 px-6 py-16 text-center text-muted-foreground">
              <FolderOpen className="size-10" />
              <p className="font-medium">Nenhuma planilha arquivada</p>
              <p className="max-w-md text-sm">
                Adicione a primeira planilha ao lado para começar seu histórico mensal.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {groups.map(([groupMonth, items]) => (
                <section
                  key={groupMonth}
                  className="p-4 sm:p-5"
                  aria-labelledby={`month-${groupMonth}`}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 id={`month-${groupMonth}`} className="font-semibold">
                        {fmtMonthLong(groupMonth)}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {items.length} arquivo(s) neste mês
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                      {groupMonth}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => {
                      const privateLegacyArchive = isPrivateLegacySpreadsheet(item);
                      const href = spreadsheetDownloadHref(item);
                      return (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                        >
                          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <FileSpreadsheet className="size-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium" title={item.fileName}>
                              {item.fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Adicionada em {new Date(item.uploadedAt).toLocaleDateString("pt-BR")}
                              {privateLegacyArchive
                                ? " · original preservado fora do build público"
                                : item.publicPath && !item.dataUrl
                                  ? " · arquivo do aplicativo"
                                  : " · arquivo enviado"}
                            </p>
                          </div>
                          {href ? (
                            <a
                              href={href}
                              download={item.fileName}
                              className="inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
                            >
                              <Download className="size-4" /> Baixar
                            </a>
                          ) : null}
                          {privateLegacyArchive ? (
                            <p role="status" className="w-full text-xs text-muted-foreground">
                              Para baixar pelo workspace, reenvie o arquivo original nesta página;
                              ele será armazenado na cópia compartilhada.
                            </p>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${item.fileName}`}
                            title="Excluir do arquivo"
                            onClick={() => setPendingDelete(item)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Adicionar planilha"
          description="Escolha o mês de referência e preserve o arquivo original."
        >
          <div className="space-y-4 p-4 sm:p-5">
            <label className="grid cursor-pointer place-items-center gap-2 rounded-lg border-2 border-dashed p-7 text-center hover:bg-muted/50">
              <Upload className="size-7 text-muted-foreground" />
              <span className="text-sm font-medium">Selecionar arquivo</span>
              <span className="text-xs text-muted-foreground">XLSX, XLS ou CSV</span>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {selectedFile && (
              <p className="rounded-md bg-muted p-3 text-sm">
                <b>Selecionado:</b> {selectedFile.name}
              </p>
            )}
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="spreadsheet-month">
              Mês da planilha
              <Input
                id="spreadsheet-month"
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setReplacementId(ADD_NEW_SPREADSHEET);
                }}
              />
            </label>
            {selectedFile && monthEntries.length > 0 && (
              <label className="grid gap-1.5 text-sm font-medium">
                O que fazer com os arquivos deste mês?
                <Select
                  value={replacementTarget?.id ?? ADD_NEW_SPREADSHEET}
                  onValueChange={setReplacementId}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ADD_NEW_SPREADSHEET}>Adicionar sem substituir</SelectItem>
                    {monthEntries.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        Substituir: {item.fileName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs font-normal text-muted-foreground">
                  A substituição preserva o mês, mas troca o arquivo selecionado pelo novo.
                </span>
              </label>
            )}
            <Button className="w-full" disabled={!selectedFile || busy} onClick={submitSpreadsheet}>
              <Upload className="size-4" />
              {busy
                ? "Salvando…"
                : replacementTarget
                  ? "Substituir planilha"
                  : "Adicionar ao arquivo"}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              O nome do arquivo tenta definir o mês automaticamente. Você pode corrigir o mês antes
              de arquivar.
            </p>
          </div>
        </Panel>
      </div>
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir planilha do arquivo?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.fileName} será removida do workspace compartilhado. As faturas e os
              lançamentos financeiros não serão alterados.
              {pendingDelete?.publicPath
                ? " Para arquivos distribuídos com o aplicativo, a exclusão remove o registro daqui, não o arquivo do pacote público."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Excluir planilha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!pendingReplace}
        onOpenChange={(open) => {
          if (!open) setPendingReplace(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir esta planilha?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo {pendingReplace?.fileName} será substituído por {selectedFile?.name} em{" "}
              {fmtMonthLong(month)}. A versão anterior sairá do arquivo. Faturas e lançamentos não
              serão alterados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplace}>Confirmar substituição</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
