import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/common";

export const Route = createFileRoute("/_authenticated/cachorros")({
  head: () => ({
    meta: [
      { title: "Cachorros | Fatura em Dia" },
      { name: "description", content: "Galeria de fotos dos cachorros da família." },
      { property: "og:title", content: "Cachorros | Fatura em Dia" },
      { property: "og:description", content: "Galeria de fotos dos cachorros da família." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DogsPage,
});

type Photo = { id: string; path: string; url: string };

const MAX_PHOTO_SIZE = 20 * 1024 * 1024;
const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
};

const errorMessage = (error: unknown) =>
  error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : "Erro inesperado ao enviar a foto.";

function DogsPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("dog_photos")
      .select("id, path")
      .order("created_at", { ascending: false });
    const rows = data ?? [];
    if (!rows.length) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    const { data: signed } = await supabase.storage.from("dog-photos").createSignedUrls(
      rows.map((r) => r.path),
      3600,
    );
    setPhotos(rows.map((r, i) => ({ ...r, url: signed?.[i]?.signedUrl ?? "" })));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    const failures: string[] = [];

    try {
      const { data: ws, error: workspaceError } = await supabase.rpc("join_family_workspace");
      if (workspaceError)
        throw new Error(`Não foi possível acessar o espaço da família: ${workspaceError.message}`);
      const wsId = ws as string | null;
      if (!wsId) throw new Error("Não foi possível localizar o espaço compartilhado da família.");

      for (const file of Array.from(files)) {
        const extension = PHOTO_EXTENSIONS[file.type];
        if (!extension) {
          failures.push(
            `${file.name}: formato não suportado. Use JPEG, PNG, WebP, GIF, HEIC ou AVIF.`,
          );
          continue;
        }
        if (file.size > MAX_PHOTO_SIZE) {
          failures.push(`${file.name}: a foto excede o limite de 20 MB.`);
          continue;
        }

        const path = `${wsId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("dog-photos")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          failures.push(`${file.name}: ${uploadError.message}`);
          continue;
        }

        const { error: insertError } = await supabase
          .from("dog_photos")
          .insert({ workspace_id: wsId, path });
        if (insertError) {
          const { error: cleanupError } = await supabase.storage.from("dog-photos").remove([path]);
          failures.push(
            `${file.name}: ${insertError.message}${cleanupError ? ` (falha ao limpar o arquivo: ${cleanupError.message})` : ""}`,
          );
          continue;
        }
        added++;
      }
    } catch (error) {
      failures.push(errorMessage(error));
    } finally {
      setBusy(false);
    }

    if (added) toast.success(added === 1 ? "Foto adicionada" : `${added} fotos adicionadas`);
    if (failures.length) {
      const details = failures.slice(0, 3).join(" · ");
      const more = failures.length > 3 ? ` · e mais ${failures.length - 3} erro(s)` : "";
      toast.error(
        added ? "Algumas fotos não foram adicionadas" : "Não foi possível adicionar as fotos",
        {
          description: `${details}${more}`,
        },
      );
    }
    if (added) void load();
  };

  const remove = async (p: Photo) => {
    if (!confirm("Apagar esta foto?")) return;
    await supabase.storage.from("dog-photos").remove([p.path]);
    const { error } = await supabase.from("dog_photos").delete().eq("id", p.id);
    if (error) toast.error("Não foi possível apagar");
    setOpen(null);
    void load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cachorros"
        description="Fotos dos nossos cachorros, visíveis para toda a família."
        actions={
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            Adicionar fotos
          </Button>
        }
      />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif"
        multiple
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
      {loading ? (
        <p className="text-muted-foreground">Carregando fotos…</p>
      ) : photos.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Nenhuma foto ainda. Clique em “Adicionar fotos”.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setOpen(p)}
              className="aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              <img
                src={p.url}
                alt="Foto de cachorro"
                loading="lazy"
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-4"
          onClick={() => setOpen(null)}
        >
          <img
            src={open.url}
            alt="Foto de cachorro"
            className="max-h-[85dvh] max-w-full rounded-lg"
          />
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="destructive"
              size="icon"
              aria-label="Apagar foto"
              onClick={() => void remove(open)}
            >
              <Trash2 className="size-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Fechar"
              onClick={() => setOpen(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
