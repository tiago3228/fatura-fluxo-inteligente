import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Dog,
  Folder,
  FolderPlus,
  GripVertical,
  Image,
  ImagePlus,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/common";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { setBackgroundFromImageUrl } from "@/components/app/AppBackground";

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

type Photo = {
  id: string;
  path: string;
  album_id: string;
  caption: string;
  sort_order: number;
  url: string;
};
type Album = { id: string; name: string; coverUrl: string | null; photoCount: number };
type GallerySize = "large" | "medium" | "small";

const GALLERY_SIZE_KEY = "dog-gallery-size";
const GRID_CLASSES: Record<GallerySize, string> = {
  large: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  medium: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  small: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6",
};

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
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);
  const [zoom, setZoom] = useState(1);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [gallerySize, setGallerySize] = useState<GallerySize>("medium");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [albumName, setAlbumName] = useState("");
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);
  const [albumNameDraft, setAlbumNameDraft] = useState("");
  const [savingAlbumName, setSavingAlbumName] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [savingCaption, setSavingCaption] = useState(false);
  const [draggingPhotoId, setDraggingPhotoId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const viewerImageAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GALLERY_SIZE_KEY);
      if (saved === "large" || saved === "medium" || saved === "small") setGallerySize(saved);
    } catch {
      // A galeria continua funcionando sem persistência local.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(GALLERY_SIZE_KEY, gallerySize);
    } catch {
      // A preferência fica só nesta sessão se o armazenamento estiver indisponível.
    }
  }, [gallerySize]);

  const load = useCallback(async (workspaceId: string) => {
    try {
      const [albumResult, photoResult] = await Promise.all([
        supabase
          .from("dog_albums")
          .select("id, name")
          .eq("workspace_id", workspaceId)
          .order("name", { ascending: true }),
        supabase
          .from("dog_photos")
          .select("id, path, caption, album_id, sort_order")
          .eq("workspace_id", workspaceId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false }),
      ]);
      if (albumResult.error) throw albumResult.error;
      if (photoResult.error) throw photoResult.error;

      const rows = photoResult.data ?? [];
      let loadedPhotos: Photo[] = [];
      if (rows.length) {
        const { data: signed, error: signedError } = await supabase.storage
          .from("dog-photos")
          .createSignedUrls(
            rows.map((row) => row.path),
            3600,
          );
        if (signedError) throw signedError;
        loadedPhotos = rows.map((row, index) => ({
          ...row,
          url: signed?.[index]?.signedUrl ?? "",
        }));
      }

      setPhotos(loadedPhotos);
      setAlbums(
        (albumResult.data ?? []).map((album) => {
          const albumPhotos = loadedPhotos.filter((photo) => photo.album_id === album.id);
          return {
            ...album,
            coverUrl: albumPhotos[0]?.url ?? null,
            photoCount: albumPhotos.length,
          };
        }),
      );
    } catch (error) {
      setPhotos([]);
      setAlbums([]);
      toast.error("Não foi possível carregar as fotos", { description: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const initializeGallery = async () => {
      try {
        const { data, error } = await supabase.rpc("ensure_user_workspace");
        if (error) throw error;
        if (typeof data !== "string") {
          throw new Error("Não foi possível localizar o espaço compartilhado da família.");
        }
        if (disposed) return;

        const workspaceId = data;
        setWorkspaceId(workspaceId);
        await load(workspaceId);
        if (disposed) return;

        channel = supabase
          .channel(`dog-photos:${workspaceId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "dog_photos",
              filter: `workspace_id=eq.${workspaceId}`,
            },
            () => void load(workspaceId),
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "dog_albums",
              filter: `workspace_id=eq.${workspaceId}`,
            },
            () => void load(workspaceId),
          )
          .subscribe();
      } catch (error) {
        if (disposed) return;
        setLoading(false);
        toast.error("Não foi possível carregar as fotos", { description: errorMessage(error) });
      }
    };

    void initializeGallery();
    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);
  const activeAlbum = albums.find((album) => album.id === activeAlbumId) ?? null;
  const albumPhotos = photos.filter((photo) => photo.album_id === activeAlbumId);
  const upload = async (files: FileList | null) => {
    // Copiar antes do primeiro await: o handler limpa o input para permitir escolher o mesmo arquivo novamente.
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) return;
    if (!activeAlbumId) {
      toast.error("Abra uma pasta de cachorro antes de adicionar fotos.");
      return;
    }
    setBusy(true);
    let added = 0;
    let workspaceId: string | null = null;
    let nextSortOrder =
      albumPhotos.reduce((highest, photo) => Math.max(highest, photo.sort_order), -1) + 1;
    const failures: string[] = [];

    try {
      const { data: ws, error: workspaceError } = await supabase.rpc("ensure_user_workspace");
      if (workspaceError)
        throw new Error(`Não foi possível acessar o espaço da família: ${workspaceError.message}`);
      workspaceId = typeof ws === "string" ? ws : null;
      if (!workspaceId)
        throw new Error("Não foi possível localizar o espaço compartilhado da família.");

      for (const file of selectedFiles) {
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

        const path = `${workspaceId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("dog-photos")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          failures.push(`${file.name}: ${uploadError.message}`);
          continue;
        }

        const { error: insertError } = await supabase.from("dog_photos").insert({
          workspace_id: workspaceId,
          path,
          album_id: activeAlbumId,
          caption: file.name.replace(/\.[^.]+$/, ""),
          sort_order: nextSortOrder,
        });
        if (insertError) {
          const { error: cleanupError } = await supabase.storage.from("dog-photos").remove([path]);
          failures.push(
            `${file.name}: ${insertError.message}${cleanupError ? ` (falha ao limpar o arquivo: ${cleanupError.message})` : ""}`,
          );
          continue;
        }
        added++;
        nextSortOrder++;
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
    if (added && workspaceId) void load(workspaceId);
  };

  const reorderPhoto = async (targetPhotoId: string) => {
    const sourcePhotoId = draggingPhotoId;
    setDraggingPhotoId(null);
    setDragOverPhotoId(null);
    if (!sourcePhotoId || sourcePhotoId === targetPhotoId || !activeAlbumId || !workspaceId) return;

    const reordered = [...albumPhotos];
    const sourceIndex = reordered.findIndex((photo) => photo.id === sourcePhotoId);
    const targetIndex = reordered.findIndex((photo) => photo.id === targetPhotoId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [movedPhoto] = reordered.splice(sourceIndex, 1);
    if (!movedPhoto) return;
    reordered.splice(targetIndex, 0, movedPhoto);

    const orderedPhotos = reordered.map((photo, index) => ({ ...photo, sort_order: index }));
    setPhotos((current) => [
      ...current.filter((photo) => photo.album_id !== activeAlbumId),
      ...orderedPhotos,
    ]);

    try {
      const { error } = await supabase.rpc("reorder_dog_album_photos", {
        p_workspace_id: workspaceId,
        p_album_id: activeAlbumId,
        p_photo_ids: orderedPhotos.map((photo) => photo.id),
      });
      if (error) throw error;
      toast.success("Ordem das fotos atualizada");
    } catch (error) {
      toast.error("Não foi possível salvar a nova ordem", { description: errorMessage(error) });
      await load(workspaceId);
    }
  };

  const createAlbum = async () => {
    const name = albumName.trim();
    if (!name || !workspaceId) return;
    setSavingAlbum(true);
    try {
      const { data, error } = await supabase
        .from("dog_albums")
        .insert({ workspace_id: workspaceId, name })
        .select("id")
        .single();
      if (error) throw error;
      setCreatingAlbum(false);
      setAlbumName("");
      await load(workspaceId);
      setActiveAlbumId(data.id);
      toast.success(`Pasta “${name}” criada`);
    } catch (error) {
      toast.error("Não foi possível criar a pasta", { description: errorMessage(error) });
    } finally {
      setSavingAlbum(false);
    }
  };

  const renameAlbum = async () => {
    if (!editingAlbum || !workspaceId) return;
    const name = albumNameDraft.trim();
    if (!name) return;
    setSavingAlbumName(true);
    try {
      const { error } = await supabase
        .from("dog_albums")
        .update({ name })
        .eq("id", editingAlbum.id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      setAlbums((current) =>
        current.map((album) => (album.id === editingAlbum.id ? { ...album, name } : album)),
      );
      setEditingAlbum(null);
      toast.success(`Pasta renomeada para “${name}”`);
    } catch (error) {
      const message = errorMessage(error);
      toast.error(
        message.toLowerCase().includes("unique")
          ? "Já existe uma pasta com esse nome"
          : "Não foi possível renomear a pasta",
        { description: message },
      );
    } finally {
      setSavingAlbumName(false);
    }
  };

  const remove = async (p: Photo) => {
    if (!confirm("Apagar esta foto?")) return;
    const { error: storageError } = await supabase.storage.from("dog-photos").remove([p.path]);
    if (storageError) {
      toast.error("Não foi possível apagar a foto", { description: storageError.message });
      return;
    }
    const { error } = await supabase.from("dog_photos").delete().eq("id", p.id);
    if (error) {
      toast.error("Não foi possível apagar a foto", { description: error.message });
      return;
    }
    setOpen(null);
    if (workspaceId) void load(workspaceId);
  };

  const saveCaption = async () => {
    if (!editingPhoto || !workspaceId) return;
    setSavingCaption(true);
    const caption = captionDraft.trim();
    try {
      const { error } = await supabase
        .from("dog_photos")
        .update({ caption })
        .eq("id", editingPhoto.id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      setPhotos((current) =>
        current.map((photo) => (photo.id === editingPhoto.id ? { ...photo, caption } : photo)),
      );
      setOpen((current) => (current?.id === editingPhoto.id ? { ...current, caption } : current));
      setEditingPhoto(null);
      toast.success("Nome da foto atualizado");
    } catch (error) {
      toast.error("Não foi possível salvar o nome da foto", { description: errorMessage(error) });
    } finally {
      setSavingCaption(false);
    }
  };

  const navigatePhoto = useCallback(
    (direction: -1 | 1) => {
      if (!open || albumPhotos.length < 2) return;
      const currentIndex = albumPhotos.findIndex((photo) => photo.id === open.id);
      if (currentIndex < 0) return;
      const nextIndex = (currentIndex + direction + albumPhotos.length) % albumPhotos.length;
      setOpen(albumPhotos[nextIndex] ?? null);
    },
    [albumPhotos, open],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigatePhoto(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigatePhoto(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigatePhoto, open]);

  useEffect(() => setZoom(1), [open?.id]);

  useEffect(() => {
    const element = viewerImageAreaRef.current;
    if (!open || !element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      setZoom((current) => Math.min(4, Math.max(1, current + (event.deltaY < 0 ? 0.25 : -0.25))));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [open]);

  const gridClassName = `grid ${GRID_CLASSES[gallerySize]} max-h-[calc(100dvh-14rem)] gap-3 overflow-y-auto overscroll-contain pr-2`;
  const currentPhotoIndex = open ? albumPhotos.findIndex((photo) => photo.id === open.id) : -1;
  const gallerySizeControl = (
    <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2 text-sm">
      <span className="text-muted-foreground">Tamanho</span>
      <select
        aria-label="Tamanho da galeria"
        className="bg-transparent font-medium outline-none"
        value={gallerySize}
        onChange={(event) => setGallerySize(event.target.value as GallerySize)}
      >
        <option value="large">Grande</option>
        <option value="medium">Médio</option>
        <option value="small">Pequeno</option>
      </select>
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={activeAlbum?.name ?? "Cachorros"}
        description={
          activeAlbum
            ? `Fotos de ${activeAlbum.name}, compartilhadas com toda a família. Arraste as fotos para mudar a ordem.`
            : "Crie uma pasta para cada cachorro e organize as fotos da família."
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {gallerySizeControl}
            {activeAlbumId && (
              <Button variant="outline" onClick={() => setActiveAlbumId(null)}>
                <ArrowLeft className="size-4" /> Pastas
              </Button>
            )}
            <Button onClick={() => setCreatingAlbum(true)} disabled={!workspaceId}>
              <FolderPlus className="size-4" /> Nova pasta
            </Button>
            {activeAlbumId && (
              <Button onClick={() => input.current?.click()} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                Adicionar fotos
              </Button>
            )}
          </div>
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
      ) : !activeAlbumId ? (
        albums.length === 0 ? (
          <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            Crie uma pasta para cada cachorro. As fotos já existentes serão mantidas em “Sem pasta”.
          </p>
        ) : (
          <div className={gridClassName}>
            {albums.map((album) => (
              <ContextMenu key={album.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActiveAlbumId(album.id)}
                    className="overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Abrir pasta ${album.name}, ${album.photoCount} fotos`}
                  >
                    <div className="relative aspect-square overflow-hidden bg-muted">
                      {album.coverUrl ? (
                        <img
                          src={album.coverUrl}
                          alt={`Capa da pasta ${album.name}`}
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="grid size-full place-items-center text-muted-foreground">
                          <Dog className="size-14" />
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 rounded-full bg-background/90 px-2 py-1 text-xs font-medium">
                        {album.photoCount} {album.photoCount === 1 ? "foto" : "fotos"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-3">
                      <Folder className="size-4 shrink-0 text-primary" />
                      <span className="truncate text-sm font-semibold">{album.name}</span>
                    </div>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    onSelect={() => {
                      setEditingAlbum(album);
                      setAlbumNameDraft(album.name);
                    }}
                  >
                    <Pencil className="mr-2 size-4" /> Renomear pasta
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )
      ) : albumPhotos.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Esta pasta ainda não tem fotos. Clique em “Adicionar fotos” para começar.
        </p>
      ) : (
        <div className={gridClassName}>
          {albumPhotos.map((p) => (
            <ContextMenu key={p.id}>
              <ContextMenuTrigger asChild>
                <article
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", p.id);
                    setDraggingPhotoId(p.id);
                  }}
                  onDragEnd={() => {
                    setDraggingPhotoId(null);
                    setDragOverPhotoId(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverPhotoId(p.id);
                  }}
                  onDragLeave={() =>
                    setDragOverPhotoId((current) => (current === p.id ? null : current))
                  }
                  onDrop={(event) => {
                    event.preventDefault();
                    void reorderPhoto(p.id);
                  }}
                  className={`overflow-hidden rounded-lg border bg-card transition-all ${dragOverPhotoId === p.id && draggingPhotoId !== p.id ? "border-primary ring-2 ring-primary/40" : ""} ${draggingPhotoId === p.id ? "opacity-50" : "cursor-grab active:cursor-grabbing"}`}
                  title="Arraste para mudar a posição"
                >
                  <button
                    type="button"
                    onClick={() => setOpen(p)}
                    className="aspect-square w-full overflow-hidden bg-muted"
                    aria-label={`Ampliar foto ${p.caption || "de cachorro"}`}
                  >
                    <img
                      src={p.url}
                      alt={p.caption || "Foto de cachorro"}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </button>
                  <div className="flex min-h-12 items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <GripVertical
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <p className="truncate text-sm font-medium" title={p.caption}>
                        {p.caption || <span className="text-muted-foreground">Sem nome</span>}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={
                        p.caption ? `Editar nome de ${p.caption}` : "Adicionar nome à foto"
                      }
                      title={p.caption ? "Editar nome" : "Adicionar nome"}
                      onClick={() => {
                        setEditingPhoto(p);
                        setCaptionDraft(p.caption);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </article>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-56">
                <ContextMenuItem onSelect={() => void setBackgroundFromImageUrl(p.url)}>
                  <Image className="mr-2 size-4" />
                  Definir como foto de fundo
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void remove(p)}>
                  <Trash2 className="mr-2 size-4" />
                  Apagar foto
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Visualizador de fotos${activeAlbum ? `: ${activeAlbum.name}` : ""}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-5"
          onClick={() => setOpen(null)}
        >
          <div
            className="flex h-[94dvh] max-h-[900px] w-full max-w-7xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex min-h-16 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="truncate font-semibold">{open.caption || "Foto sem nome"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {activeAlbum ? `Pasta: ${activeAlbum.name}` : "Galeria de cachorros"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden rounded-full bg-muted px-3 py-1.5 text-sm tabular-nums sm:inline-flex">
                  {Math.max(currentPhotoIndex + 1, 1)} / {albumPhotos.length}
                </span>
                <span className="rounded-full bg-muted px-2 py-1.5 text-xs tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Redefinir zoom para 100%"
                  title="Redefinir zoom"
                  disabled={zoom === 1}
                  onClick={() => setZoom(1)}
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Definir como foto de fundo"
                  title="Definir como foto de fundo"
                  onClick={() => void setBackgroundFromImageUrl(open.url)}
                >
                  <Image className="size-4" />
                  <span className="hidden sm:inline">Definir fundo</span>
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  aria-label="Apagar foto"
                  title="Apagar foto"
                  onClick={() => void remove(open)}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Fechar visualizador"
                  title="Fechar"
                  onClick={() => setOpen(null)}
                >
                  <X className="size-5" />
                </Button>
              </div>
            </header>
            <div
              ref={viewerImageAreaRef}
              className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/95 p-3 sm:p-8"
            >
              {albumPhotos.length > 1 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-3 z-10 size-11 rounded-full shadow-lg sm:left-5"
                  aria-label="Foto anterior"
                  title="Foto anterior (←)"
                  onClick={() => navigatePhoto(-1)}
                >
                  <ChevronLeft className="size-6" />
                </Button>
              )}
              <img
                src={open.url}
                alt={open.caption || "Foto de cachorro"}
                className={`max-h-full max-w-full select-none object-contain transition-transform duration-150 ${zoom === 1 ? "cursor-zoom-in" : "cursor-zoom-out"}`}
                style={{ transform: `scale(${zoom})` }}
                draggable={false}
              />
              {albumPhotos.length > 1 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-3 z-10 size-11 rounded-full shadow-lg sm:right-5"
                  aria-label="Próxima foto"
                  title="Próxima foto (→)"
                  onClick={() => navigatePhoto(1)}
                >
                  <ChevronRight className="size-6" />
                </Button>
              )}
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white sm:hidden">
                {Math.max(currentPhotoIndex + 1, 1)} / {albumPhotos.length}
              </span>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 sm:px-6">
              <p className="truncate text-sm text-muted-foreground">
                {open.caption || "Foto sem nome"}
              </p>
              <p className="text-xs text-muted-foreground">
                Rodinha do mouse para zoom · ← e → para navegar · Esc para fechar
              </p>
            </footer>
          </div>
        </div>
      )}
      <Dialog open={creatingAlbum} onOpenChange={setCreatingAlbum}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova pasta</DialogTitle>
            <DialogDescription>
              Crie uma pasta para organizar as fotos de um cachorro. A capa será atualizada com uma
              foto da pasta.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={80}
            value={albumName}
            onChange={(event) => setAlbumName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createAlbum();
            }}
            placeholder="Nome do cachorro"
            aria-label="Nome da pasta"
            disabled={savingAlbum}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreatingAlbum(false)}
              disabled={savingAlbum}
            >
              Cancelar
            </Button>
            <Button onClick={() => void createAlbum()} disabled={!albumName.trim() || savingAlbum}>
              {savingAlbum ? <Loader2 className="size-4 animate-spin" /> : "Criar pasta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingAlbum} onOpenChange={(isOpen) => !isOpen && setEditingAlbum(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear pasta</DialogTitle>
            <DialogDescription>
              O novo nome será compartilhado com todas as contas da família.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={80}
            value={albumNameDraft}
            onChange={(event) => setAlbumNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void renameAlbum();
            }}
            placeholder="Nome do cachorro"
            aria-label="Novo nome da pasta"
            disabled={savingAlbumName}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingAlbum(null)}
              disabled={savingAlbumName}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void renameAlbum()}
              disabled={!albumNameDraft.trim() || savingAlbumName}
            >
              {savingAlbumName ? <Loader2 className="size-4 animate-spin" /> : "Salvar nome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingPhoto} onOpenChange={(isOpen) => !isOpen && setEditingPhoto(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nome da foto</DialogTitle>
            <DialogDescription>
              O nome aparece abaixo da foto e é compartilhado com as outras contas da família.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={80}
            value={captionDraft}
            onChange={(event) => setCaptionDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveCaption();
            }}
            placeholder="Ex.: Mel brincando no parque"
            aria-label="Nome da foto"
            disabled={savingCaption}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingPhoto(null)}
              disabled={savingCaption}
            >
              Cancelar
            </Button>
            <Button onClick={() => void saveCaption()} disabled={savingCaption}>
              {savingCaption ? <Loader2 className="size-4 animate-spin" /> : "Salvar nome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
