"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LayoutGrid,
  MessageCircle,
  Plus,
  Search,
  Table2,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
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

const SELECT_CLASS = "nox-input py-2.5";

export default function LeadsDashboardPage() {
  const resultsRef = useRef<HTMLDivElement>(null);
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
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / 25));

  const selectCategory = useCallback((category: string) => {
    setPage(1);
    setFilters((current) => ({
      ...current,
      category: current.category === category ? "" : category,
    }));
    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  const toggleScoreSort = useCallback(() => {
    setPage(1);
    setFilters((current) => ({
      ...current,
      sort: current.sort === "score_desc" ? "score_asc" : "score_desc",
    }));
  }, []);

  const conversion = stats && stats.contatados > 0 ? Math.round((stats.respostas / stats.contatados) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="nox-eyebrow">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Prospecção</h1>
          <p className="mt-1.5 text-sm text-nox-muted">
            {stats
              ? `${stats.realTotal} empresas reais na base · meta de ${stats.goal}`
              : "Carregando…"}
            {stats?.demoMode ? " · dados de demonstração ativos" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/leads/import" className="nox-btn-secondary">
            <Search size={15} aria-hidden="true" /> Buscar negócios
          </Link>
          <Link href="/projetos/novo" className="nox-btn-primary">
            <Plus size={15} aria-hidden="true" /> Novo projeto
          </Link>
        </div>
      </div>

      {stats && (
        <>
          <section className="nox-card p-5" aria-label="Meta de leads">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Target size={16} className="text-nox-cyan" aria-hidden="true" />
                <span className="font-medium text-white">Meta de leads</span>
                <span className="text-nox-muted">
                  {stats.realTotal} de {stats.goal}
                </span>
              </div>
              <span className="font-mono text-sm text-nox-cyan">{stats.progressPct}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-nox-panel">
              <div
                className="h-full rounded-full bg-gradient-to-r from-nox-purple to-nox-cyan transition-all"
                style={{ width: `${stats.progressPct}%` }}
                role="progressbar"
                aria-valuenow={stats.progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={<Users size={16} />}
              label="Leads na fila"
              value={stats.total}
              detail={`${stats.high} alta · ${stats.mid} média · ${stats.low} baixa`}
            />
            <Kpi
              icon={<MessageCircle size={16} />}
              label="Aptos para WhatsApp"
              value={stats.apto}
              detail="Telefone válido e opt-in verificado"
            />
            <Kpi
              icon={<TrendingUp size={16} />}
              label="Contatados"
              value={stats.contatados}
              detail={`${stats.respostas} respostas · ${conversion}% de retorno`}
            />
            <Kpi
              icon={<Target size={16} />}
              label="Clientes"
              value={stats.clientes}
              detail={`${stats.reunioes} reuniões marcadas`}
              accent
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Por categoria"
              data={stats.byCategory}
              selectedName={filters.category}
              onSelect={selectCategory}
            />
            <ChartCard title="Por cidade" data={stats.byCity} />
          </div>
        </>
      )}

      <div ref={resultsRef} className="nox-card scroll-mt-20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Oportunidades</h2>
            <p className="text-xs text-nox-muted">
              Redes sociais e páginas de diretórios não contam como site próprio.
            </p>
          </div>
          <div
            className="inline-flex rounded-xl border border-nox-border bg-nox-bg p-1"
            role="group"
            aria-label="Filtrar empresas pela presença de site"
          >
            <button
              type="button"
              aria-pressed={!includeWithWebsite}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                !includeWithWebsite ? "bg-emerald-400/15 text-emerald-200" : "text-nox-muted hover:text-white",
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
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                includeWithWebsite ? "bg-nox-cyan/15 text-nox-cyan" : "text-nox-muted hover:text-white",
              )}
              onClick={() => {
                setPage(1);
                setIncludeWithWebsite(true);
              }}
            >
              Incluir com site
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 md:grid-cols-3 lg:grid-cols-5">
          <div className="relative md:col-span-2 lg:col-span-2">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-nox-muted" aria-hidden="true" />
            <input
              placeholder="Buscar por nome"
              aria-label="Buscar por nome"
              className={cn(SELECT_CLASS, "pl-10")}
              value={filters.q}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, q: e.target.value }));
              }}
            />
          </div>
          <input
            placeholder="Categoria"
            aria-label="Categoria"
            className={SELECT_CLASS}
            value={filters.category}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, category: e.target.value }));
            }}
          />
          <input
            placeholder="Cidade"
            aria-label="Cidade"
            className={SELECT_CLASS}
            value={filters.city}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, city: e.target.value }));
            }}
          />
          <select
            aria-label="Etapa do funil"
            className={SELECT_CLASS}
            value={filters.funnelStage}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, funnelStage: e.target.value }));
            }}
          >
            <option value="">Funil: todos</option>
            {FUNNEL_STAGES.map((s) => (
              <option key={s} value={s}>
                {FUNNEL_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Ordenação"
            className={SELECT_CLASS}
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
          >
            <option value="score_desc">Maior score</option>
            <option value="score_asc">Menor score</option>
            <option value="distance_asc">Mais próximos</option>
            <option value="confidence_desc">Maior confiança</option>
            <option value="name_asc">Nome (A–Z)</option>
            <option value="verified_desc">Última verificação</option>
          </select>
          <select
            aria-label="Telefone"
            className={SELECT_CLASS}
            value={filters.hasPhone}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, hasPhone: e.target.value }));
            }}
          >
            <option value="">Telefone: todos</option>
            <option value="true">Com telefone</option>
            <option value="false">Sem telefone</option>
          </select>
          <select
            aria-label="Opt-in"
            className={SELECT_CLASS}
            value={filters.optIn}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, optIn: e.target.value }));
            }}
          >
            <option value="">Opt-in: todos</option>
            <option value="unknown">Desconhecido</option>
            <option value="pending">Pendente</option>
            <option value="verified">Verificado</option>
            <option value="refused">Recusado</option>
          </select>
          <input
            placeholder="Raio máx. (km)"
            aria-label="Raio máximo em km"
            className={SELECT_CLASS}
            value={filters.maxDistance}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, maxDistance: e.target.value }));
            }}
          />
          <select
            aria-label="Fonte"
            className={SELECT_CLASS}
            value={filters.source}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, source: e.target.value }));
            }}
          >
            <option value="">Fonte: todas</option>
            <option value="overpass">OpenStreetMap</option>
            <option value="csv">CSV</option>
            <option value="demo">Demonstração</option>
          </select>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-nox-muted">
            {loading
              ? "Carregando…"
              : `${total} resultados ${includeWithWebsite ? "com e sem site" : "sem site próprio"} · página ${page} de ${pageCount}`}
          </p>
          <div className="inline-flex rounded-xl border border-nox-border bg-nox-bg p-1" role="group" aria-label="Modo de exibição">
            <button
              type="button"
              aria-pressed={view === "table"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                view === "table" ? "bg-nox-panel text-white" : "text-nox-muted hover:text-white",
              )}
              onClick={() => setView("table")}
            >
              <Table2 size={13} aria-hidden="true" /> Tabela
            </button>
            <button
              type="button"
              aria-pressed={view === "cards"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                view === "cards" ? "bg-nox-panel text-white" : "text-nox-muted hover:text-white",
              )}
              onClick={() => setView("cards")}
            >
              <LayoutGrid size={13} aria-hidden="true" /> Cards
            </button>
          </div>
        </div>

        {view === "table" ? (
          <div className="nox-scroll mt-4 overflow-x-auto">
            <table className="nox-table min-w-[960px]">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Categoria</th>
                  <th>Cidade</th>
                  <th>km</th>
                  <th
                    aria-sort={
                      filters.sort === "score_desc"
                        ? "descending"
                        : filters.sort === "score_asc"
                          ? "ascending"
                          : "none"
                    }
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-[0.14em] hover:text-white"
                      onClick={toggleScoreSort}
                      title="Ordenar pelo score"
                      aria-label={
                        filters.sort === "score_desc"
                          ? "Score em ordem decrescente. Clique para ordenar do menor para o maior."
                          : filters.sort === "score_asc"
                            ? "Score em ordem crescente. Clique para ordenar do maior para o menor."
                            : "Ordenar pelo score do maior para o menor."
                      }
                    >
                      Score
                      <span aria-hidden="true">
                        {filters.sort === "score_desc" ? (
                          <ArrowDown size={12} />
                        ) : filters.sort === "score_asc" ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowUpDown size={12} />
                        )}
                      </span>
                    </button>
                  </th>
                  <th>Conf.</th>
                  <th>Funil</th>
                  <th>Site</th>
                  <th>Opt-in</th>
                  <th>Contato</th>
                </tr>
              </thead>
              <tbody>
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-nox-muted">
                      Nenhum lead encontrado com os filtros atuais.
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/leads/${item.id}`} className="font-medium text-white hover:text-nox-cyan">
                        {item.name}
                      </Link>
                      {item.isDemo && <span className="ml-2 text-xs text-amber-300">demo</span>}
                    </td>
                    <td className="text-nox-muted">{item.category}</td>
                    <td className="text-nox-muted">{item.city ?? "—"}</td>
                    <td className="font-mono text-nox-muted">{item.distanceKm ?? "—"}</td>
                    <td>
                      <ScorePill score={item.opportunityScore} />
                    </td>
                    <td className="font-mono text-nox-muted">{item.confidenceScore}</td>
                    <td className="text-nox-muted">
                      {FUNNEL_LABELS[item.funnelStage as keyof typeof FUNNEL_LABELS] ?? item.funnelStage}
                    </td>
                    <td>
                      <WebsiteBadge item={item} />
                    </td>
                    <td>
                      <OptInBadge status={item.optInStatus} />
                    </td>
                    <td>
                      <Link href={`/leads/${item.id}#whatsapp`} className="nox-btn-secondary px-2.5 py-1.5 text-xs">
                        <MessageCircle size={12} aria-hidden="true" />
                        {item.phoneE164 && item.optInStatus === "verified" && !item.doNotContact
                          ? "WhatsApp"
                          : "Preparar"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {!loading && items.length === 0 && (
              <p className="py-10 text-center text-sm text-nox-muted md:col-span-2 xl:col-span-3">
                Nenhum lead encontrado com os filtros atuais.
              </p>
            )}
            {items.map((item) => (
              <article key={item.id} className="nox-card-raised p-4 transition hover:border-nox-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-white">
                    <Link href={`/leads/${item.id}`} className="hover:text-nox-cyan">
                      {item.name}
                    </Link>
                  </h3>
                  <ScorePill score={item.opportunityScore} />
                </div>
                <p className="mt-1 text-xs text-nox-muted">
                  {item.category} · {item.city ?? "—"} · {item.distanceKm ?? "?"} km
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <WebsiteBadge item={item} />
                  <OptInBadge status={item.optInStatus} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {item.scoreReasons.slice(0, 3).map((r) => (
                    <span key={r} className="rounded-full border border-nox-border px-2 py-0.5 text-[11px] text-nox-muted">
                      {r}
                    </span>
                  ))}
                </div>
                <Link href={`/leads/${item.id}#whatsapp`} className="nox-btn-secondary mt-4 px-3 py-1.5 text-xs">
                  <MessageCircle size={12} aria-hidden="true" />
                  {item.phoneE164 && item.optInStatus === "verified" && !item.doNotContact
                    ? "Abrir WhatsApp"
                    : "Preparar contato"}
                </Link>
              </article>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={page <= 1}
            className="nox-btn-secondary px-3 py-1.5 text-xs"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span className="text-xs text-nox-muted">
            Página {page} de {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            className="nox-btn-secondary px-3 py-1.5 text-xs"
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  detail,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={cn("nox-kpi", accent && "border-nox-cyan/30 bg-nox-cyan/5")}>
      <div className="flex items-center justify-between">
        <p className="nox-kpi-label">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent ? "bg-nox-cyan text-nox-bg" : "bg-nox-panel text-nox-cyan")}>
          {icon}
        </span>
      </div>
      <p className="nox-kpi-value">{value}</p>
      <p className="mt-1.5 text-xs text-nox-muted">{detail}</p>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const band = opportunityBand(score);
  const color =
    band === "alta"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : band === "media"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
        : "border-nox-border bg-nox-panel text-nox-muted";
  return (
    <span className={cn("inline-flex min-w-[2.75rem] justify-center rounded-lg border px-2 py-0.5 font-mono text-xs font-semibold", color)}>
      {score}
    </span>
  );
}

function WebsiteBadge({ item }: { item: LeadItem }) {
  const hasWebsite = hasOwnWebsite(item.website);
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
        hasWebsite
          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
          : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
      )}
    >
      {hasWebsite ? "Com site" : "Sem site próprio"}
    </span>
  );
}

const OPT_IN_LABELS: Record<string, string> = {
  unknown: "Desconhecido",
  pending: "Pendente",
  verified: "Verificado",
  refused: "Recusado",
};

function OptInBadge({ status }: { status: string }) {
  const tone =
    status === "verified"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : status === "refused"
        ? "border-red-400/30 bg-red-400/10 text-red-200"
        : status === "pending"
          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
          : "border-nox-border bg-nox-panel text-nox-muted";
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", tone)}>
      {OPT_IN_LABELS[status] ?? status}
    </span>
  );
}

function ChartCard({
  title,
  data,
  selectedName,
  onSelect,
}: {
  title: string;
  data: { name: string; count: number }[];
  selectedName?: string;
  onSelect?: (name: string) => void;
}) {
  return (
    <div className="nox-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {onSelect && <p className="text-xs text-nox-muted">Clique para filtrar</p>}
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#232735" vertical={false} />
            <XAxis dataKey="name" hide />
            <YAxis stroke="#8b93a7" fontSize={11} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{ background: "#151821", border: "1px solid #232735", borderRadius: 12 }}
              labelStyle={{ color: "#fff" }}
              itemStyle={{ color: "#22d3ee" }}
            />
            <Bar
              dataKey="count"
              name="Leads"
              fill="#8b5cf6"
              radius={[6, 6, 0, 0]}
              className={onSelect ? "cursor-pointer" : undefined}
              onClick={
                onSelect
                  ? (entry) => {
                      const name = entry.payload?.name;
                      if (typeof name === "string") onSelect(name);
                    }
                  : undefined
              }
            >
              {data.map((item) => {
                const selected = selectedName === item.name;
                return (
                  <Cell
                    key={item.name}
                    fill={selected ? "#22d3ee" : "#8b5cf6"}
                    stroke={selected ? "#a5f3fc" : undefined}
                    strokeWidth={selected ? 2 : undefined}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {onSelect && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Filtrar por categoria">
          {data.map((item) => {
            const selected = selectedName === item.name;
            return (
              <button
                key={item.name}
                type="button"
                aria-pressed={selected}
                className={cn("nox-chip", selected && "nox-chip-active")}
                onClick={() => onSelect(item.name)}
              >
                {item.name} <span className="opacity-70">({item.count})</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
