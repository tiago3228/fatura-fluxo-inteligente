import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import diana from "@/assets/diana.jpeg.asset.json";
import { supabase } from "@/integrations/supabase/client";

const KEY = "fatura-bg-image";
const EVT = "fatura-bg-change";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let wsId: PromiseLike<string | null> | null = null;
function workspaceId() {
  wsId ??= supabase
    .rpc("join_family_workspace")
    .then(({ data }) => (data as string | null) ?? null);
  return wsId;
}

function cache(v: string | null) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* sem espaço local: segue só com o banco */
  }
  window.dispatchEvent(new Event(EVT));
}

async function pull() {
  const id = await workspaceId();
  if (!id) return;
  const { data, error } = await supabase
    .from("workspace_settings")
    .select("background_image")
    .eq("workspace_id", id)
    .maybeSingle();
  if (!error && (data?.background_image ?? null) !== read()) cache(data?.background_image ?? null);
}

async function write(v: string | null): Promise<boolean> {
  const id = await workspaceId();
  if (!id) {
    toast.error("Não foi possível salvar a foto");
    return false;
  }
  const { error } = await supabase
    .from("workspace_settings")
    .upsert({ workspace_id: id, background_image: v }, { onConflict: "workspace_id" });
  if (error) {
    toast.error("Não foi possível salvar a foto para a família");
    return false;
  }
  cache(v);
  return true;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBackgroundImage() {
  const [bg, setBg] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setBg(read());
    sync();
    void pull();
    const onFocus = () => void pull();
    const t = window.setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return bg;
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export async function setBackgroundFromImageUrl(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Não foi possível acessar a foto selecionada.");
    const blob = await response.blob();
    const file = new File([blob], "foto-da-galeria.jpg", {
      type: blob.type.startsWith("image/") ? blob.type : "image/jpeg",
    });
    const saved = await write(await shrink(file));
    if (saved) toast.success("Foto de fundo aplicada para a família");
  } catch (error) {
    toast.error("Não foi possível aplicar a foto como fundo", {
      description: error instanceof Error ? error.message : "Erro inesperado.",
    });
  }
}

export function AppBackgroundLayer() {
  const bg = useBackgroundImage();
  useEffect(() => {
    document.documentElement.classList.toggle("has-photo-bg", Boolean(bg));
    return () => document.documentElement.classList.remove("has-photo-bg");
  }, [bg]);
  if (!bg) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${bg}")` }}
      />
      <div className="absolute inset-0 bg-background/55" />
    </div>
  );
}

export function BackgroundPicker() {
  const bg = useBackgroundImage();
  const input = useRef<HTMLInputElement>(null);
  const presets = [{ label: "Diana", url: diana.url }];

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const saved = await write(await shrink(f));
      if (saved) toast.success("Foto de fundo aplicada");
    } catch {
      toast.error("Não foi possível usar essa foto");
    }
  };

  return (
    <div className="space-y-3 py-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void write(null)}
          className={`h-16 w-24 rounded-md border-2 bg-background text-xs ${!bg ? "border-primary" : "border-border"}`}
        >
          Fundo padrão
        </button>
        {presets.map((p) => (
          <button
            key={p.url}
            type="button"
            onClick={() => void write(p.url)}
            aria-label={`Usar foto ${p.label}`}
            className={`h-16 w-24 rounded-md border-2 bg-cover bg-center ${bg === p.url ? "border-primary" : "border-border"}`}
            style={{ backgroundImage: `url("${p.url}")` }}
          />
        ))}
        {bg && !presets.some((p) => p.url === bg) && (
          <div
            className="h-16 w-24 rounded-md border-2 border-primary bg-cover bg-center"
            style={{ backgroundImage: `url("${bg}")` }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" /> Escolher foto
        </Button>
        {bg && (
          <Button variant="ghost" onClick={() => void write(null)}>
            <RotateCcw className="size-4" /> Voltar ao fundo padrão
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
