// Resolución de imágenes (art: para demo, mzimg: para fotos guardadas en el dispositivo) y compresión.
import { useEffect, useState } from "react";
import { artDataUri } from "./art";

let localResolver: ((id: string) => Promise<Blob | null>) | null = null;
const objectUrls = new Map<string, string>();

export function setLocalImageResolver(fn: (id: string) => Promise<Blob | null>) { localResolver = fn; }

export function syncSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("art:")) return artDataUri(url);
  if (url.startsWith("mzimg:")) return objectUrls.get(url) ?? null;
  return url;
}

export async function resolveSrc(url: string | null | undefined): Promise<string | null> {
  const s = syncSrc(url);
  if (s || !url || !url.startsWith("mzimg:")) return s;
  const blob = localResolver ? await localResolver(url.slice(6)) : null;
  if (!blob) return null;
  const obj = URL.createObjectURL(blob);
  objectUrls.set(url, obj);
  return obj;
}

export function useImageSrc(url: string | null | undefined) {
  const [src, setSrc] = useState(() => syncSrc(url));
  useEffect(() => {
    let alive = true;
    const s = syncSrc(url);
    setSrc(s);
    if (!s && url) void resolveSrc(url).then((r) => { if (alive) setSrc(r); });
    return () => { alive = false; };
  }, [url]);
  return src;
}

/** Devuelve el Blob de una imagen (local o remota) para enviarlo a la IA. */
export async function blobFor(url: string): Promise<Blob | null> {
  if (url.startsWith("mzimg:")) return localResolver ? localResolver(url.slice(6)) : null;
  const src = syncSrc(url);
  if (!src) return null;
  try { return await (await fetch(src)).blob(); } catch { return null; }
}

async function decode(file: Blob): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void } | null> {
  try {
    if ("createImageBitmap" in globalThis) {
      const bmp = await createImageBitmap(file);
      return { w: bmp.width, h: bmp.height, draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h) };
    }
  } catch { /* se intenta con <img> */ }
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    URL.revokeObjectURL(url);
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h) };
  } catch { return null; }
}

/** Reduce y convierte a JPEG (carga rápida en móvil). Si no se puede decodificar, devuelve el archivo original. */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const d = await decode(file);
  if (!d) return file;
  const scale = Math.min(1, maxSide / Math.max(d.w, d.h));
  const w = Math.max(1, Math.round(d.w * scale));
  const h = Math.max(1, Math.round(d.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  d.draw(ctx, w, h);
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  return out ?? file;
}

export async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
