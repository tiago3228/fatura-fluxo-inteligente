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
    const { data: signed } = await supabase.storage
      .from("dog-photos")
      .createSignedUrls(rows.map((r) => r.path), 3600);
    setPhotos(rows.map((r, i) => ({ ...r, url: signed?.[i]?.signedUrl ?? "" })));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const { data: ws } = await supabase.rpc("join_family_workspace");
    const wsId = ws as string | null;
    let ok = 0;
    for (const f of Array.from(files)) {
      if (!wsId) break;
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${wsId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("dog-photos").upload(path, f, { contentType: f.type });
      if (up.error) continue;
      const ins = await supabase.from("dog_photos").insert({ workspace_id: wsId, path });
      if (!ins.error) ok++;
    }
    setBusy(false);
    if (ok) toast.success(ok === 1 ? "Foto adicionada" : `${ok} fotos adicionadas`);
    else toast.error("Não foi possível adicionar as fotos");
    void load();
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
        accept="image/*"
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
              <img src={p.url} alt="Foto de cachorro" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-4"
          onClick={() => setOpen(null)}
        >
          <img src={open.url} alt="Foto de cachorro" className="max-h-[85dvh] max-w-full rounded-lg" />
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="destructive" size="icon" aria-label="Apagar foto" onClick={() => void remove(open)}>
              <Trash2 className="size-4" />
            </Button>
            <Button variant="secondary" size="icon" aria-label="Fechar" onClick={() => setOpen(null)}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
