"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Alert } from "@/components/ui/Alert";
import { PRODUCT_MAX_IMAGES } from "@/constants/media";

type FileState = { name: string; status: "uploading" | "done" | "error"; message?: string };

/**
 * The image gallery + uploader (E20–E26). A controlled child of
 * `ProductForm`: it uploads and removes images through its own endpoint
 * IMMEDIATELY (design.md § 4c — "se guarda al subirla, no al pulsar Guardar
 * cambios"), and reports the resulting array up through `onChange` so the
 * product form's own `PUT` — which replaces `imageUrls` too — never sends a
 * stale array back and undoes an upload that just happened.
 */
export function ImageUploader({
  storeId,
  storeProductId,
  imageUrls,
  onChange,
  disabled = false,
}: {
  storeId: string;
  storeProductId: string;
  imageUrls: string[];
  onChange: (next: string[]) => void;
  /** A soft-deleted product "no permite editarlo" (spec.md § Casos límite) —
   *  the caller passes `Boolean(product.deletedAt)` so this stays true even
   *  though the uploader lives outside `ProductForm`'s own `<fieldset>`. */
  disabled?: boolean;
}) {
  const [files, setFiles] = useState<FileState[]>([]);
  const [banner, setBanner] = useState<{
    tone: "positive" | "warning" | "danger";
    text: string;
  } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(selected: FileList) {
    const list = Array.from(selected);
    setBanner(null);
    setFiles(list.map((file) => ({ name: file.name, status: "uploading" })));

    let succeeded = 0;
    let current = imageUrls;
    for (const [index, file] of list.entries()) {
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await fetch(
          `/api/admin/stores/${storeId}/products/${storeProductId}/images`,
          { method: "POST", body: form },
        );
        if (response.ok) {
          const data = (await response.json()) as { url: string; imageUrls: string[] };
          current = data.imageUrls;
          onChange(current);
          succeeded += 1;
          setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: "done" } : f)));
        } else {
          const message = await uploadErrorMessage(response);
          setFiles((prev) =>
            prev.map((f, i) => (i === index ? { ...f, status: "error", message } : f)),
          );
        }
      } catch {
        setFiles((prev) =>
          prev.map((f, i) =>
            i === index ? { ...f, status: "error", message: "Se cortó la conexión." } : f,
          ),
        );
      }
    }

    if (succeeded === list.length) {
      setBanner({
        tone: "positive",
        text: succeeded === 1 ? "Subimos 1 imagen." : `Subimos ${succeeded} imágenes.`,
      });
    } else if (succeeded > 0) {
      setBanner({ tone: "warning", text: `Subimos ${succeeded} de ${list.length} imágenes.` });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleRemove(url: string) {
    setRemoving(null);
    onChange(imageUrls.filter((u) => u !== url));
    setBanner({ tone: "positive", text: "Quitamos la imagen de tu producto." });
  }

  const atLimit = imageUrls.length >= PRODUCT_MAX_IMAGES;

  return (
    // A native <fieldset disabled>, not a prop threaded onto every <button>
    // and the <input type="file"> by hand: the browser disables every
    // control inside for free, which is what keeps a soft-deleted product's
    // gallery from staying clickable just because it lives outside
    // ProductForm's own <fieldset> (spec.md § Casos límite — "no permite
    // editarlo").
    <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
      <h2 className="text-lg font-semibold">Imágenes</h2>

      {banner && (
        <Alert tone={banner.tone} className="mt-3">
          {banner.text}
        </Alert>
      )}

      {imageUrls.length === 0 ? (
        <div className="bg-surface-muted mt-3 flex aspect-square max-w-40 items-center justify-center rounded text-sm">
          Sin imagen
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
          {imageUrls.map((url, index) => (
            <div key={url} className="relative">
              <div className="bg-surface-muted relative aspect-square overflow-hidden rounded">
                <Image
                  src={url}
                  alt={`Imagen ${index + 1} de ${imageUrls.length}`}
                  fill
                  sizes="120px"
                  className="object-cover"
                />
              </div>
              {index === 0 && (
                <span className="bg-brand text-brand-contrast absolute top-1 left-1 rounded px-1.5 py-0.5 text-[10px]">
                  Principal
                </span>
              )}
              <div className="mt-1 flex justify-between text-xs">
                {index !== 0 && (
                  <button
                    type="button"
                    className="text-brand hover:underline"
                    onClick={() => onChange([url, ...imageUrls.filter((u) => u !== url)])}
                  >
                    Hacer principal
                  </button>
                )}
                {removing === url ? (
                  <span className="flex gap-1">
                    <button type="button" className="text-danger" onClick={() => handleRemove(url)}>
                      Sí, quitar
                    </button>
                    <button type="button" onClick={() => setRemoving(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setRemoving(url)}>
                    Quitar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-fg-muted mt-2 text-xs">
        JPG, PNG, WebP o AVIF. Hasta 4 MB cada una y 8 en total.
      </p>
      <p className="text-fg-muted text-xs">
        Quitar una imagen la saca de tu tienda; el archivo se queda guardado en el almacenamiento.
      </p>

      <div className="mt-3">
        {/* A `<label>`, not a `<Button>`: a real button cannot nest inside
            one and still trigger the native file picker (design.md § 4c). */}
        <label
          className={`bg-surface-muted text-fg border-border hover:bg-surface inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 text-base font-medium ${atLimit || disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          Agregar imágenes
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            disabled={atLimit}
            className="sr-only"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </label>
        {atLimit && (
          <p className="text-fg-muted mt-1 text-xs">
            Ya tienes 8 imágenes, que es el máximo. Quita alguna para agregar otra.
          </p>
        )}
      </div>

      {files.length > 0 && (
        <ul role="status" className="mt-3 space-y-1 text-sm">
          {files.map((file) => (
            <li key={file.name}>
              {file.name} —{" "}
              {file.status === "uploading"
                ? "Subiendo…"
                : file.status === "done"
                  ? "Lista"
                  : file.message}
            </li>
          ))}
        </ul>
      )}

      <noscript>
        <p className="text-warning mt-2 text-sm">
          Para subir imágenes necesitas activar JavaScript.
        </p>
      </noscript>
    </fieldset>
  );
}

async function uploadErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; reason?: string };
    if (response.status === 400 && body.reason === "mime")
      return "Ese archivo no es una imagen. Solo JPG, PNG, WebP o AVIF.";
    if (response.status === 400 && body.reason === "too_large")
      return "Pesa más de 4 MB. Manda una foto más pequeña.";
    if (response.status === 409) return "Ya tienes 8 imágenes, que es el máximo.";
    if (response.status === 503)
      return "No pudimos guardar la imagen: el almacenamiento no está disponible.";
    return "No se pudo subir esta imagen.";
  } catch {
    return "No se pudo subir esta imagen.";
  }
}
