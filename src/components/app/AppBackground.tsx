import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import diana from "@/assets/diana.jpeg.asset.json";

const KEY = "fatura-bg-image";
const EVT = "fatura-bg-change";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(v: string | null) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    toast.error("Não foi possível salvar a foto neste aparelho");
    return;
  }
  window.dispatchEvent(new Event(EVT));
}

export function useBackgroundImage() {
  const [bg, setBg] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setBg(read());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
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

export function AppBackgroundLayer() {
  const bg = useBackgroundImage();
  useEffect(() => {
    document.documentElement.classList.toggle("has-photo-bg", Boolean(bg));
    return () => document.documentElement.classList.remove("has-photo-bg");
  }, [bg]);
  if (!bg) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bg}")` }} />
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
      write(await shrink(f));
      toast.success("Foto de fundo aplicada");
    } catch {
      toast.error("Não foi possível usar essa foto");
    }
  };

  return (
    <div className="space-y-3 py-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => write(null)}
          className={`h-16 w-24 rounded-md border-2 bg-background text-xs ${!bg ? "border-primary" : "border-border"}`}
        >
          Fundo padrão
        </button>
        {presets.map((p) => (
          <button
            key={p.url}
            type="button"
            onClick={() => write(p.url)}
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
          <Button variant="ghost" onClick={() => write(null)}>
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
