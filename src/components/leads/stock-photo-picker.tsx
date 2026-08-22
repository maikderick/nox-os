"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails come from runtime provider URLs */
import { useCallback, useState } from "react";

export type PickerPhoto = {
  url: string;
  alt: string;
  credit: string;
  creditUrl: string;
};

type Props = {
  category: string;
  galleryFull: boolean;
  onAddToGallery: (photo: PickerPhoto) => void;
  onUseAsHero: (photo: PickerPhoto) => void;
};

type Status = "idle" | "loading" | "ready" | "error";

export function StockPhotoPicker({
  category,
  galleryFull,
  onAddToGallery,
  onUseAsHero,
}: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [photos, setPhotos] = useState<PickerPhoto[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const search = useCallback(
    async (nextPage: number, customTerm?: string) => {
      setStatus("loading");
      setMessage(null);
      try {
        const params = new URLSearchParams({
          category,
          page: String(nextPage),
        });
        const trimmed = (customTerm ?? term).trim();
        if (trimmed) params.set("q", trimmed);

        const response = await fetch(`/api/stock-photos?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          photos?: PickerPhoto[];
          query?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Não foi possível buscar fotos ilustrativas.");
        }
        setPhotos(payload.photos ?? []);
        setPage(nextPage);
        if (!term.trim() && payload.query) setTerm(payload.query);
        setStatus("ready");
      } catch (cause) {
        setStatus("error");
        setMessage(cause instanceof Error ? cause.message : "Ocorreu um erro inesperado.");
      }
    },
    [category, term],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (status === "idle") void search(1);
        }}
        className="mt-3 rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan hover:border-nox-cyan"
      >
        Buscar fotos ilustrativas
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-nox-border bg-nox-bg/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-white">Fotos ilustrativas licenciadas</h4>
          <p className="mt-1 max-w-xl text-xs leading-5 text-nox-muted">
            Fotos de banco com licença aberta, exibidas na página com o rótulo{" "}
            <strong className="text-nox-cyan">Imagem ilustrativa</strong>. Elas não são fotos do
            estabelecimento e o crédito do fotógrafo aparece no rodapé.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-nox-border px-3 py-2 text-xs text-nox-muted hover:border-nox-cyan"
        >
          Fechar
        </button>
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search(1);
        }}
      >
        <label className="min-w-0 flex-1 text-sm text-nox-muted">
          Termo de busca
          <span className="ml-1 text-xs">· funciona melhor em inglês</span>
          <input
            value={term}
            maxLength={120}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="bakery interior bread"
            className="mt-1 block w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-white"
          />
        </label>
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-lg border border-nox-border px-4 py-2 text-sm text-nox-cyan hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "loading" ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {status === "error" && message && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {message}
        </p>
      )}

      {status === "ready" && photos.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-nox-border p-4 text-sm text-nox-muted">
          Nenhuma foto encontrada para este termo. Tente uma palavra mais genérica em inglês.
        </p>
      )}

      {photos.length > 0 && (
        <>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo) => (
              <li
                key={photo.url}
                className="overflow-hidden rounded-lg border border-nox-border bg-nox-surface"
              >
                <img
                  src={photo.url}
                  alt={photo.alt}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="h-32 w-full object-cover"
                />
                <div className="p-3">
                  <p className="truncate text-xs text-nox-muted" title={photo.credit}>
                    {photo.credit}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={galleryFull}
                      onClick={() => onAddToGallery(photo)}
                      className="rounded-md border border-nox-border px-2.5 py-1 text-xs text-nox-cyan hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {galleryFull ? "Galeria cheia" : "Adicionar à galeria"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUseAsHero(photo)}
                      className="rounded-md border border-nox-border px-2.5 py-1 text-xs text-nox-muted hover:border-nox-cyan"
                    >
                      Usar no topo
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={page <= 1 || status === "loading"}
              onClick={() => void search(page - 1)}
              className="rounded-lg border border-nox-border px-3 py-2 text-xs text-nox-muted hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Anteriores
            </button>
            <span className="text-xs text-nox-muted">Página {page}</span>
            <button
              type="button"
              disabled={page >= 5 || status === "loading"}
              onClick={() => void search(page + 1)}
              className="rounded-lg border border-nox-border px-3 py-2 text-xs text-nox-muted hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              Mais fotos →
            </button>
          </div>
          <p className="mt-3 text-xs text-nox-muted">Fotos via Pexels.</p>
        </>
      )}
    </div>
  );
}
