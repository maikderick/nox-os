"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FUNNEL_LABELS } from "@/lib/funnel";

const PAGE_SIZE = 25;

type Opportunity = {
  id: string;
  name: string;
  category: string;
  city: string | null;
  neighborhood: string | null;
  distanceKm: number | null;
  opportunityScore: number;
  confidenceScore: number;
  phoneE164: string | null;
  funnelStage: string;
  scoreReasons: string[];
  optInStatus: string;
};

type OpportunitiesResponse = {
  total: number;
  items: Opportunity[];
};

type StatsResponse = {
  byCategory?: { name: string; count: number }[];
};

export default function OpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      best: "true",
      sort: "closing_desc",
    });
    if (category) params.set("category", category);
    return params.toString();
  }, [category, page]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [leadsResponse, statsResponse] = await Promise.all([
          fetch(`/api/leads?${query}`, { signal: controller.signal }),
          fetch("/api/leads/stats", { signal: controller.signal }),
        ]);

        if (!leadsResponse.ok) {
          throw new Error("Não foi possível carregar as oportunidades.");
        }

        const leads = (await leadsResponse.json()) as OpportunitiesResponse;
        setItems(leads.items ?? []);
        setTotal(leads.total ?? 0);

        if (statsResponse.ok) {
          const stats = (await statsResponse.json()) as StatsResponse;
          setCategories(
            Array.from(
              new Set((stats.byCategory ?? []).map((entry) => entry.name).filter(Boolean)),
            ).sort((a, b) => a.localeCompare(b, "pt-BR")),
          );
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setItems([]);
        setTotal(0);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar as oportunidades.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [query]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRank = (page - 1) * PAGE_SIZE + 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-nox-cyan">
            Prioridade comercial
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Melhores oportunidades</h1>
          <p className="mt-1 max-w-3xl text-sm text-nox-muted">
            Leads reais com maior prioridade estimada para abordagem, ordenados por score,
            confiança dos dados e proximidade. A posição ajuda a decidir por onde começar, mas
            não garante o fechamento.
          </p>
        </div>
        <Link
          href="/leads"
          className="rounded-lg border border-nox-border px-4 py-2 text-sm text-nox-muted hover:border-nox-cyan hover:text-white"
        >
          Ver todos os leads
        </Link>
      </div>

      <section
        className="grid gap-3 rounded-xl border border-nox-border bg-nox-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Como o ranking funciona"
      >
        <RankingFactor label="Score" detail="Necessidade e oportunidade digital" />
        <RankingFactor label="Confiança" detail="Qualidade e atualidade dos dados" />
        <RankingFactor label="Telefone" detail="Somente negócios com contato disponível" />
        <RankingFactor label="Proximidade" detail="Menor distância como desempate" />
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[240px] flex-1 sm:max-w-sm">
            <label htmlFor="opportunity-category" className="mb-1 block text-xs text-nox-muted">
              Separar por categoria
            </label>
            <select
              id="opportunity-category"
              className="w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm text-white"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas as categorias</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-right">
            <p className="text-3xl font-semibold tracking-tight text-white">{loading ? "—" : total}</p>
            <p className="text-xs text-nox-muted">
              {category ? `oportunidades em ${category}` : "oportunidades priorizadas"}
            </p>
          </div>
        </div>

        {category && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="rounded-full border border-nox-cyan/50 bg-nox-cyan/10 px-3 py-1 text-nox-cyan">
              {category}
            </span>
            <button
              type="button"
              className="text-nox-muted underline-offset-2 hover:text-white hover:underline"
              onClick={() => {
                setCategory("");
                setPage(1);
              }}
            >
              Limpar filtro
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-5 rounded-lg border border-red-900/70 bg-red-950/30 p-4">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              className="mt-2 text-xs text-nox-cyan hover:underline"
              onClick={() => window.location.reload()}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!error && loading && (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Carregando">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-44 animate-pulse rounded-xl border border-nox-border bg-nox-panel"
              />
            ))}
          </div>
        )}

        {!error && !loading && items.length === 0 && (
          <div className="mt-5 rounded-xl border border-dashed border-nox-border p-8 text-center">
            <p className="font-medium text-white">Nenhuma oportunidade nesta categoria.</p>
            <p className="mt-1 text-sm text-nox-muted">
              Limpe o filtro ou importe mais estabelecimentos para ampliar a prospecção.
            </p>
          </div>
        )}

        {!error && !loading && items.length > 0 && (
          <ol className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item, index) => (
              <OpportunityCard key={item.id} item={item} rank={firstRank + index} />
            ))}
          </ol>
        )}

        {!error && !loading && total > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-nox-border pt-4">
            <p className="text-sm text-nox-muted">
              Página {page} de {pageCount}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                className="rounded-lg border border-nox-border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= pageCount}
                className="rounded-lg border border-nox-border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RankingFactor({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-lg bg-nox-panel px-3 py-2">
      <p className="text-xs font-semibold text-nox-cyan">{label}</p>
      <p className="mt-0.5 text-xs text-nox-muted">{detail}</p>
    </div>
  );
}

function OpportunityCard({ item, rank }: { item: Opportunity; rank: number }) {
  const funnelLabel =
    FUNNEL_LABELS[item.funnelStage as keyof typeof FUNNEL_LABELS] ?? item.funnelStage;

  return (
    <li className="relative overflow-hidden rounded-xl border border-nox-border bg-nox-panel p-4 transition hover:border-nox-purple">
      <div className="absolute right-0 top-0 rounded-bl-xl bg-nox-purple px-3 py-1.5 font-mono text-sm font-semibold text-white">
        #{rank}
      </div>
      <div className="pr-12">
        <p className="text-[11px] uppercase tracking-wide text-nox-muted">{item.category}</p>
        <h2 className="mt-1 line-clamp-2 font-semibold text-white">
          <Link href={`/leads/${item.id}`} className="hover:text-nox-cyan">
            {item.name}
          </Link>
        </h2>
        <p className="mt-1 text-xs text-nox-muted">
          {[item.neighborhood, item.city].filter(Boolean).join(" · ") || "Localidade não informada"}
          {item.distanceKm != null ? ` · ${formatDistance(item.distanceKm)} km` : ""}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Score" value={item.opportunityScore} highlight />
        <Metric label="Confiança" value={item.confidenceScore} />
        <Metric label="Telefone" value={item.phoneE164 ? "Sim" : "Não"} />
      </div>

      {item.scoreReasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {item.scoreReasons.slice(0, 3).map((reason) => (
            <span
              key={reason}
              className="rounded-full border border-nox-border px-2 py-0.5 text-[10px] text-nox-muted"
            >
              {reason}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-nox-border pt-3">
        <span className="text-xs text-nox-muted">Funil: {funnelLabel}</span>
        <Link
          href={`/leads/${item.id}#whatsapp`}
          className="rounded-lg border border-nox-cyan/60 px-3 py-1.5 text-xs font-medium text-nox-cyan hover:bg-nox-cyan hover:text-nox-bg"
        >
          Ver e contatar
        </Link>
      </div>
    </li>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg bg-nox-bg px-2 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-nox-muted">{label}</p>
      <p className={`mt-0.5 font-mono font-semibold ${highlight ? "text-emerald-300" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function formatDistance(distance: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(distance);
}
