"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FUNNEL_LABELS, FUNNEL_STAGES } from "@/lib/funnel";
import { cn, opportunityBand } from "@/lib/utils";
import { hasOwnWebsite } from "@/lib/website";

type Stats = {
  total: number;
  realTotal: number;
  demoMode: boolean;
  high: number;
  mid: number;
  low: number;
  apto: number;
  contatados: number;
  respostas: number;
  reunioes: number;
  clientes: number;
  goal: number;
  progressPct: number;
  byCategory: { name: string; count: number }[];
  byCity: { name: string; count: number }[];
};

type LeadItem = {
  id: string;
  name: string;
  category: string;
  city: string | null;
  neighborhood: string | null;
  distanceKm: number | null;
  opportunityScore: number;
  confidenceScore: number;
  websiteStatus: string;
  website: string | null;
  phoneE164: string | null;
  funnelStage: string;
  source: string;
  lastVerifiedAt: string;
  optInStatus: string;
  scoreReasons: string[];
  isDemo: boolean;
  doNotContact: boolean;
};

export default function LeadsDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<LeadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "cards">("table");
  const [includeWithWebsite, setIncludeWithWebsite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    q: "",
    category: "",
    city: "",
    funnelStage: "",
    source: "",
    hasPhone: "",
    optIn: "",
    sort: "score_desc",
    maxDistance: "",
  });

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("pageSize", "25");
    Object.entries(filters).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    if (includeWithWebsite) sp.set("includeWithWebsite", "true");
    return sp.toString();
  }, [filters, includeWithWebsite, page]);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, lRes] = await Promise.all([
      fetch(
        includeWithWebsite
          ? "/api/leads/stats?includeWithWebsite=true"
          : "/api/leads/stats",
      ),
      fetch(`/api/leads?${query}`),
    ]);
    const s = (await sRes.json()) as Stats;
    const l = (await lRes.json()) as { total: number; items: LeadItem[] };
    setStats(s);
    setTotal(l.total);
    setItems(l.items);
    setLoading(false);
  }, [includeWithWebsite, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Prospecção</h1>
          <p className="text-sm text-nox-muted">
            {stats
              ? `${stats.realTotal} empresas reais encontradas · meta ${stats.goal}`
              : "Carregando…"}
            {stats?.demoMode ? " · Dados de demonstração ativos" : ""}
          </p>
          <p className="mt-1 text-xs text-emerald-300">
            Fila padrão: somente empresas sem site próprio
          </p>
        </div>
        <Link
          href="/leads/import"
          className="rounded-lg bg-nox-cyan px-4 py-2 text-sm font-semibold text-nox-bg"
        >
          Buscar / importar
        </Link>
      </div>

      {stats && (
        <>
          <div className="h-3 overflow-hidden rounded-full bg-nox-panel">
            <div
              className="h-full bg-gradient-to-r from-nox-purple to-nox-cyan transition-all"
              style={{ width: `${stats.progressPct}%` }}
              role="progressbar"
              aria-valuenow={stats.progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            {[
              ["Total", stats.total],
              ["Alta", stats.high],
              ["Média", stats.mid],
              ["Baixa", stats.low],
              ["Aptos WA", stats.apto],
              ["Contatados", stats.contatados],
              ["Respostas", stats.respostas],
              ["Clientes", stats.clientes],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-nox-border bg-nox-surface p-4">
                <p className="text-xs text-nox-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Por categoria" data={stats.byCategory} />
            <ChartCard title="Por cidade" data={stats.byCity} />
          </div>
        </>
      )}

      <div className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-nox-border bg-nox-bg/50 p-3">
          <div>
            <p className="text-sm font-medium text-white">Presença de site</p>
            <p className="text-xs text-nox-muted">
              Redes sociais e páginas de diretórios não contam como site próprio.
            </p>
          </div>
          <div
            className="inline-flex rounded-lg border border-nox-border p-1"
            role="group"
            aria-label="Filtrar empresas pela presença de site"
          >
            <button
              type="button"
              aria-pressed={!includeWithWebsite}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                !includeWithWebsite
                  ? "bg-emerald-400/15 text-emerald-200"
                  : "text-nox-muted hover:text-white",
              )}
              onClick={() => {
                setPage(1);
                setIncludeWithWebsite(false);
              }}
            >
              Somente sem site
            </button>
            <button
              type="button"
              aria-pressed={includeWithWebsite}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                includeWithWebsite
                  ? "bg-nox-purple text-white"
                  : "text-nox-muted hover:text-white",
              )}
              onClick={() => {
                setPage(1);
                setIncludeWithWebsite(true);
              }}
            >
              Incluir leads com site
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          <input
            placeholder="Buscar nome…"
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.q}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, q: e.target.value }));
            }}
          />
          <input
            placeholder="Categoria"
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.category}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, category: e.target.value }));
            }}
          />
          <input
            placeholder="Cidade"
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.city}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, city: e.target.value }));
            }}
          />
          <select
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.funnelStage}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, funnelStage: e.target.value }));
            }}
          >
            <option value="">Funil</option>
            {FUNNEL_STAGES.map((s) => (
              <option key={s} value={s}>
                {FUNNEL_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
          >
            <option value="score_desc">Score ↓</option>
            <option value="score_asc">Score ↑</option>
            <option value="distance_asc">Distância ↑</option>
            <option value="confidence_desc">Confiança ↓</option>
            <option value="name_asc">Nome</option>
            <option value="verified_desc">Última verificação</option>
          </select>
          <select
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.hasPhone}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, hasPhone: e.target.value }));
            }}
          >
            <option value="">Telefone</option>
            <option value="true">Com telefone</option>
            <option value="false">Sem telefone</option>
          </select>
          <select
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.optIn}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, optIn: e.target.value }));
            }}
          >
            <option value="">Opt-in</option>
            <option value="unknown">unknown</option>
            <option value="pending">pending</option>
            <option value="verified">verified</option>
            <option value="refused">refused</option>
          </select>
          <input
            placeholder="Raio máx. km"
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.maxDistance}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, maxDistance: e.target.value }));
            }}
          />
          <select
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            value={filters.source}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, source: e.target.value }));
            }}
          >
            <option value="">Fonte</option>
            <option value="overpass">overpass</option>
            <option value="csv">csv</option>
            <option value="demo">demo</option>
          </select>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-nox-muted">
            {loading
              ? "Carregando…"
              : `${total} resultados ${
                  includeWithWebsite ? "com e sem site" : "sem site próprio"
                } · página ${page}/${pageCount}`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1 text-sm",
                view === "table" ? "bg-nox-purple text-white" : "border border-nox-border",
              )}
              onClick={() => setView("table")}
            >
              Tabela
            </button>
            <button
              type="button"
              className={cn(
                "rounded-lg px-3 py-1 text-sm",
                view === "cards" ? "bg-nox-purple text-white" : "border border-nox-border",
              )}
              onClick={() => setView("cards")}
            >
              Cards
            </button>
          </div>
        </div>

        {view === "table" ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-nox-muted">
                <tr>
                  <th className="p-2">Nome</th>
                  <th className="p-2">Categoria</th>
                  <th className="p-2">Cidade</th>
                  <th className="p-2">km</th>
                  <th className="p-2">Score</th>
                  <th className="p-2">Conf.</th>
                  <th className="p-2">Funil</th>
                  <th className="p-2">Site</th>
                  <th className="p-2">Opt-in</th>
                </tr>
              </thead>
              <tbody>
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-nox-muted">
                      Nenhum lead encontrado com os filtros atuais.
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-nox-border/70 hover:bg-nox-panel/50">
                    <td className="p-2">
                      <Link href={`/leads/${item.id}`} className="text-nox-cyan hover:underline">
                        {item.name}
                      </Link>
                      {item.isDemo && (
                        <span className="ml-2 text-xs text-amber-300">demo</span>
                      )}
                    </td>
                    <td className="p-2">{item.category}</td>
                    <td className="p-2">{item.city ?? "—"}</td>
                    <td className="p-2">{item.distanceKm ?? "—"}</td>
                    <td className="p-2">
                      <ScorePill score={item.opportunityScore} />
                    </td>
                    <td className="p-2">{item.confidenceScore}</td>
                    <td className="p-2">
                      {FUNNEL_LABELS[item.funnelStage as keyof typeof FUNNEL_LABELS] ??
                        item.funnelStage}
                    </td>
                    <td className="p-2">
                      <WebsiteBadge item={item} />
                    </td>
                    <td className="p-2">{item.optInStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {!loading && items.length === 0 && (
              <p className="py-8 text-center text-sm text-nox-muted md:col-span-2 xl:col-span-3">
                Nenhum lead encontrado com os filtros atuais.
              </p>
            )}
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/leads/${item.id}`}
                className="rounded-xl border border-nox-border bg-nox-panel p-4 hover:border-nox-purple"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-white">{item.name}</h3>
                  <ScorePill score={item.opportunityScore} />
                </div>
                <p className="mt-1 text-xs text-nox-muted">
                  {item.category} · {item.city ?? "—"} · {item.distanceKm ?? "?"} km
                </p>
                <div className="mt-2">
                  <WebsiteBadge item={item} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {item.scoreReasons.slice(0, 3).map((r) => (
                    <span
                      key={r}
                      className="rounded-full border border-nox-border px-2 py-0.5 text-[11px] text-nox-muted"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-between">
          <button
            type="button"
            disabled={page <= 1}
            className="rounded-lg border border-nox-border px-3 py-1 text-sm disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page >= pageCount}
            className="rounded-lg border border-nox-border px-3 py-1 text-sm disabled:opacity-40"
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const band = opportunityBand(score);
  const color =
    band === "alta" ? "text-emerald-300" : band === "media" ? "text-amber-300" : "text-nox-muted";
  return <span className={cn("font-mono font-semibold", color)}>{score}</span>;
}

function WebsiteBadge({ item }: { item: LeadItem }) {
  const hasWebsite = hasOwnWebsite(item.website);
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px]",
        hasWebsite
          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
          : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
      )}
    >
      {hasWebsite ? "Com site" : "Sem site próprio"}
    </span>
  );
}

function ChartCard({
  title,
  data,
}: {
  title: string;
  data: { name: string; count: number }[];
}) {
  return (
    <div className="rounded-xl border border-nox-border bg-nox-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-white">{title}</h2>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3d" />
            <XAxis dataKey="name" hide />
            <YAxis stroke="#9aa3b5" fontSize={11} />
            <Tooltip
              contentStyle={{ background: "#151822", border: "1px solid #2a2f3d" }}
              labelStyle={{ color: "#fff" }}
            />
            <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
