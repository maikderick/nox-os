"use client";

import { useEffect, useState } from "react";
import { CATEGORY_GROUPS } from "@/lib/categories";
import { DEFAULT_RADII_KM } from "@/lib/funnel";

type Job = {
  id: string;
  provider: string;
  status: string;
  foundCount: number;
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  currentRadiusKm: number | null;
  progressJson: string;
  errorMessage: string | null;
};

type GeoResult = { label: string; lat: number; lng: number };
type BusyAction = "geolocation" | "geocode" | "overpass" | "csv";
type Notice = { tone: "info" | "success" | "error"; text: string };
type JobProgress = {
  phase?: string;
  radiusKm?: number;
  attribution?: string;
  message?: string;
};

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando início",
  running: "Em execução",
  processing: "Consultando dados",
  paused: "Pausado",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function apiError(payload: unknown, status: number): string {
  if (status === 401) return "Sua sessão expirou. Entre novamente para continuar.";

  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const flattened = error as { formErrors?: unknown; fieldErrors?: unknown };
      const details = [flattened.formErrors, flattened.fieldErrors]
        .filter(Boolean)
        .map((value) => JSON.stringify(value))
        .join(" ");
      if (details) return `Dados inválidos: ${details}`;
    }
  }

  return `A operação falhou (HTTP ${status}). Tente novamente.`;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const raw = await response.text();
  let payload: unknown = null;

  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(
        response.ok
          ? "O servidor devolveu uma resposta inválida."
          : `A operação falhou (HTTP ${response.status}).`,
      );
    }
  }

  if (!response.ok) throw new Error(apiError(payload, response.status));
  return payload as T;
}

function validGeoResults(value: unknown): GeoResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (result): result is GeoResult =>
      Boolean(result) &&
      typeof result === "object" &&
      typeof (result as GeoResult).label === "string" &&
      Number.isFinite((result as GeoResult).lat) &&
      Number.isFinite((result as GeoResult).lng),
  );
}

function parseProgress(value: string): JobProgress {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as JobProgress) : {};
  } catch {
    return {};
  }
}

function progressText(job: Job, progress: JobProgress): string {
  const radius = progress.radiusKm ?? job.currentRadiusKm;
  if (progress.message) return progress.message;
  if (job.status === "pending") return "Job criado e aguardando o processamento.";
  if (job.status === "paused") return "Processamento pausado. Clique em Continuar para retomar.";
  if (job.status === "completed") return "Busca concluída. Os leads aceitos já estão no painel.";
  if (job.status === "cancelled") return "Processamento cancelado.";
  if (job.status === "failed") return "A busca não foi concluída. Consulte o erro abaixo.";
  if (progress.phase === "search" && radius != null) {
    return `Consultando estabelecimentos em um raio de ${radius} km…`;
  }
  if (progress.phase === "radius_done" && radius != null) {
    return `Raio de ${radius} km concluído; avançando se a meta ainda não foi atingida.`;
  }
  return "Processando a busca de estabelecimentos…";
}

export default function ImportPage() {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [geoQ, setGeoQ] = useState("");
  const [defaultCity, setDefaultCity] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [categories, setCategories] = useState<string[]>(CATEGORY_GROUPS.map((c) => c.id));
  const [csvText, setCsvText] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [geoDenied, setGeoDenied] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [busyJob, setBusyJob] = useState<{ id: string; action: string } | null>(null);
  const [jobsRefreshing, setJobsRefreshing] = useState(false);

  async function refreshJobs(showFeedback = false) {
    if (showFeedback) setJobsRefreshing(true);
    try {
      const data = await requestJson<{ jobs?: unknown }>("/api/import", { cache: "no-store" });
      if (!Array.isArray(data.jobs)) throw new Error("A lista de jobs veio em formato inválido.");
      setJobs(data.jobs as Job[]);
      setJobsError(null);
      if (showFeedback) setNotice({ tone: "success", text: "Status dos jobs atualizado." });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Não foi possível atualizar os jobs.";
      setJobsError(text);
      if (showFeedback) setNotice({ tone: "error", text });
    } finally {
      if (showFeedback) setJobsRefreshing(false);
    }
  }

  async function loadSettings() {
    try {
      const data = await requestJson<{
        settings?: {
          defaultCity?: unknown;
          originLat?: unknown;
          originLng?: unknown;
          originLabel?: unknown;
          enabledCategories?: unknown;
        } | null;
      }>("/api/settings", { cache: "no-store" });
      const settings = data.settings;
      if (!settings) return;

      if (typeof settings.defaultCity === "string" && settings.defaultCity.trim()) {
        const city = settings.defaultCity.trim();
        setDefaultCity(city);
        setGeoQ((current) => current.trim() || city);
      }

      if (Number.isFinite(settings.originLat) && Number.isFinite(settings.originLng)) {
        setLat((current) => current ?? (settings.originLat as number));
        setLng((current) => current ?? (settings.originLng as number));
        if (typeof settings.originLabel === "string") {
          const savedLabel = settings.originLabel.trim();
          setLabel((current) => current || savedLabel || "Localização salva");
        }
      }

      if (Array.isArray(settings.enabledCategories) && settings.enabledCategories.length > 0) {
        const allowed = settings.enabledCategories.filter(
          (category): category is string =>
            typeof category === "string" && CATEGORY_GROUPS.some((group) => group.id === category),
        );
        if (allowed.length > 0) setCategories(allowed);
      }
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof Error
            ? `Não foi possível carregar a cidade padrão: ${error.message}`
            : "Não foi possível carregar a cidade padrão.",
      });
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadSettings();
      void refreshJobs();
    }, 0);
    const interval = window.setInterval(() => void refreshJobs(), 4000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, []);

  function requestGeo() {
    if (!navigator.geolocation) {
      setGeoDenied(true);
      setNotice({ tone: "error", text: "Geolocalização não suportada neste navegador." });
      return;
    }

    setBusyAction("geolocation");
    setNotice({ tone: "info", text: "Aguardando autorização de localização do navegador…" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setLabel("Minha localização (navegador)");
        setGeoDenied(false);
        setBusyAction(null);
        setNotice({ tone: "success", text: "Localização autorizada e selecionada." });
      },
      (error) => {
        setGeoDenied(true);
        setBusyAction(null);
        setNotice({
          tone: "error",
          text:
            error.code === error.TIMEOUT
              ? "A localização demorou demais. Busque por cidade, endereço ou CEP."
              : "Geolocalização negada. Busque por cidade, endereço ou CEP.",
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function lookupPlace(query: string): Promise<GeoResult[]> {
    const data = await requestJson<{ results?: unknown }>(
      `/api/geocode?q=${encodeURIComponent(query)}`,
      { cache: "no-store" },
    );
    return validGeoResults(data.results);
  }

  async function searchPlace() {
    const query = geoQ.trim();
    if (query.length < 2) {
      setNotice({ tone: "error", text: "Informe uma cidade, endereço ou CEP para buscar." });
      return;
    }

    setBusyAction("geocode");
    setNotice({ tone: "info", text: `Buscando “${query}”…` });
    try {
      const results = await lookupPlace(query);
      setGeoResults(results);
      setNotice(
        results.length > 0
          ? {
              tone: "success",
              text: `${results.length} local${results.length === 1 ? " encontrado" : "izações encontradas"}. Selecione uma opção abaixo.`,
            }
          : { tone: "error", text: "Nenhuma localização encontrada. Tente detalhar a busca." },
      );
    } catch (error) {
      setGeoResults([]);
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Falha ao buscar a localização.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function startOverpass() {
    if (categories.length === 0) {
      setNotice({ tone: "error", text: "Selecione pelo menos uma categoria de estabelecimento." });
      return;
    }

    setBusyAction("overpass");
    try {
      let originLat = lat;
      let originLng = lng;
      let originLabel = label;

      if (originLat == null || originLng == null) {
        const query = (geoQ.trim() || defaultCity.trim()).trim();
        if (query.length < 2) {
          throw new Error("Informe uma cidade, endereço ou CEP antes de gerar os leads.");
        }

        setNotice({ tone: "info", text: `Localizando “${query}” antes de gerar os leads…` });
        const results = await lookupPlace(query);
        setGeoResults(results);
        const first = results[0];
        if (!first) throw new Error("Nenhuma localização foi encontrada para iniciar a busca.");

        originLat = first.lat;
        originLng = first.lng;
        originLabel = first.label;
        setLat(first.lat);
        setLng(first.lng);
        setLabel(first.label);
      }

      setNotice({ tone: "info", text: "Criando o job de geração de leads…" });
      const data = await requestJson<{ jobId?: unknown; status?: unknown }>("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "overpass",
          lat: originLat,
          lng: originLng,
          label: originLabel,
          categoryIds: categories,
          radiiKm: [...DEFAULT_RADII_KM],
        }),
      });
      if (typeof data.jobId !== "string") throw new Error("O servidor não confirmou o job criado.");

      if (data.status === "already_running") {
        setNotice({
          tone: "info",
          text: `Já existe uma coleta em andamento (job ${data.jobId.slice(0, 8)}…). Acompanhe o progresso abaixo.`,
        });
        await refreshJobs();
        return;
      }

      setNotice({
        tone: "success",
        text: `Geração iniciada (job ${data.jobId.slice(0, 8)}…). Acompanhe o progresso abaixo.`,
      });
      await refreshJobs();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Não foi possível iniciar a geração de leads.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function startCsv() {
    if (categories.length === 0) {
      setNotice({ tone: "error", text: "Selecione pelo menos uma categoria antes de importar." });
      return;
    }

    const normalizedCsv = csvText.trim();
    const lines = normalizedCsv.split(/\r?\n/).filter((line) => line.trim());
    if (!normalizedCsv || lines.length < 2) {
      setNotice({
        tone: "error",
        text: "Cole um CSV com cabeçalho e pelo menos uma linha de estabelecimento.",
      });
      return;
    }

    setBusyAction("csv");
    setNotice({ tone: "info", text: "Validando e importando o CSV…" });
    try {
      const data = await requestJson<{
        stats?: { accepted?: unknown; duplicate?: unknown; rejected?: unknown };
      }>("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "csv",
          lat: lat ?? undefined,
          lng: lng ?? undefined,
          label,
          csvText: normalizedCsv,
          categoryIds: categories,
        }),
      });
      const stats = data.stats;
      if (!stats) throw new Error("O servidor não retornou o resultado da importação.");

      setNotice({
        tone: "success",
        text: `CSV concluído: ${Number(stats.accepted) || 0} aceitos, ${Number(stats.duplicate) || 0} duplicados e ${Number(stats.rejected) || 0} rejeitados.`,
      });
      await refreshJobs();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Não foi possível importar o CSV.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function control(jobId: string, action: "pause" | "resume" | "cancel") {
    setBusyJob({ id: jobId, action });
    const actionLabel = action === "pause" ? "pausar" : action === "resume" ? "retomar" : "cancelar";
    setNotice({ tone: "info", text: `Solicitando ${actionLabel} do job…` });
    try {
      await requestJson<{ ok?: boolean }>("/api/import", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      setNotice({ tone: "success", text: `Job atualizado: ação “${actionLabel}” concluída.` });
      await refreshJobs();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Não foi possível atualizar o job.",
      });
    } finally {
      setBusyJob(null);
    }
  }

  const actionIsBusy = busyAction !== null;
  const activeOverpassJob = jobs.find(
    (job) =>
      job.provider === "overpass" && ["pending", "running", "processing"].includes(job.status),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Importação</h1>
        <p className="text-sm text-nox-muted">
          OpenStreetMap/Overpass + CSV. Sem scraping. Expansão 5→80 km até a meta ou limite.
          Empresas nunca são inventadas.
        </p>
        <p className="mt-2 text-xs text-nox-muted">
          © OpenStreetMap contributors — ODbL. Atribuição obrigatória.
        </p>
        <p className="mt-1 text-xs text-amber-300">
          Mantenha esta página aberta durante a coleta para acompanhar e acionar as próximas
          etapas com segurança.
        </p>
      </div>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "border-red-400/40 bg-red-950/30 text-red-200"
              : notice.tone === "success"
                ? "border-emerald-400/40 bg-emerald-950/30 text-emerald-200"
                : "border-nox-cyan/40 bg-cyan-950/30 text-nox-cyan"
          }`}
        >
          {notice.text}
        </div>
      )}
      {geoDenied && (
        <p className="text-sm text-amber-300">
          Geolocalização indisponível — use a busca manual por cidade, endereço ou CEP.
        </p>
      )}

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Localização</h2>
        <p className="mt-1 text-xs text-nox-muted">
          Se nenhuma opção estiver selecionada, “Gerar leads” usará automaticamente a primeira
          correspondência da cidade informada{defaultCity ? ` (padrão: ${defaultCity})` : ""}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={requestGeo}
            disabled={actionIsBusy}
            className="nox-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === "geolocation" ? "Obtendo localização…" : "Usar minha localização"}
          </button>
          <input
            className="min-w-[240px] flex-1 rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm disabled:opacity-50"
            placeholder="Cidade, endereço ou CEP"
            value={geoQ}
            disabled={actionIsBusy}
            onChange={(event) => {
              setGeoQ(event.target.value);
              setLat(null);
              setLng(null);
              setLabel("");
              setGeoResults([]);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchPlace();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void searchPlace()}
            disabled={actionIsBusy}
            className="rounded-lg border border-nox-border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === "geocode" ? "Buscando…" : "Buscar"}
          </button>
        </div>
        {lat != null && lng != null && (
          <p className="mt-3 rounded-lg bg-nox-bg px-3 py-2 text-sm text-nox-muted">
            Origem selecionada: <span className="text-white">{label || "manual"}</span> ·{" "}
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </p>
        )}
        {geoResults.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="Resultados de localização">
            {geoResults.map((result, index) => (
              <li key={`${result.label}-${result.lat}-${result.lng}`}>
                <button
                  type="button"
                  disabled={actionIsBusy}
                  className="w-full rounded-lg border border-nox-border px-3 py-2 text-left text-sm text-nox-cyan hover:border-nox-cyan disabled:opacity-50"
                  onClick={() => {
                    setLat(result.lat);
                    setLng(result.lng);
                    setLabel(result.label);
                    setGeoDenied(false);
                    setNotice({
                      tone: "success",
                      text: `Localização ${index + 1} selecionada. Agora você pode gerar os leads.`,
                    });
                  }}
                >
                  {index + 1}. {result.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-white">Categorias</h2>
          <span className="text-xs text-nox-muted">{categories.length} selecionada(s)</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {CATEGORY_GROUPS.map((group) => (
            <label key={group.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={categories.includes(group.id)}
                disabled={busyAction === "overpass"}
                onChange={(event) => {
                  setCategories((previous) =>
                    event.target.checked
                      ? [...previous, group.id]
                      : previous.filter((id) => id !== group.id),
                  );
                }}
              />
              <span>{group.label}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="mt-4 nox-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void startOverpass()}
          disabled={actionIsBusy || Boolean(activeOverpassJob)}
        >
          {busyAction === "overpass"
            ? "Iniciando geração…"
            : activeOverpassJob
              ? "Coleta em andamento…"
              : "Gerar leads pelo Overpass"}
        </button>
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Importar CSV</h2>
        <p className="mt-1 text-xs text-nox-muted">
          Colunas: name/nome, category/categoria, address/endereco, city/cidade, state/uf,
          latitude/lat, longitude/lng, phone/telefone, website/site, id/externalId
        </p>
        <textarea
          className="mt-3 min-h-40 w-full rounded-lg border border-nox-border bg-nox-bg p-3 font-mono text-xs disabled:opacity-50"
          value={csvText}
          disabled={busyAction === "csv"}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="name,category,city,phone,website&#10;Padaria Central,Padarias,São Paulo,11999990000,"
        />
        <button
          type="button"
          className="mt-3 rounded-lg border border-nox-border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void startCsv()}
          disabled={actionIsBusy}
        >
          {busyAction === "csv" ? "Importando…" : "Importar CSV"}
        </button>
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-white">Progresso dos jobs</h2>
          <button
            type="button"
            className="rounded-lg border border-nox-border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            disabled={jobsRefreshing}
            onClick={() => void refreshJobs(true)}
          >
            {jobsRefreshing ? "Atualizando…" : "Atualizar agora"}
          </button>
        </div>
        {jobsError && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            Não foi possível atualizar o progresso: {jobsError}
          </p>
        )}
        <ul className="mt-3 space-y-3 text-sm">
          {jobs.length === 0 && <li className="text-nox-muted">Nenhum job iniciado ainda.</li>}
          {jobs.map((job) => {
            const progress = parseProgress(job.progressJson);
            const isThisJobBusy = busyJob?.id === job.id;
            const canPause = ["pending", "running", "processing"].includes(job.status);
            const canResume = job.status === "paused" || job.status === "failed";
            const canCancel = ["pending", "running", "processing", "paused"].includes(job.status);
            return (
              <li key={job.id} className="rounded-lg border border-nox-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p>
                      <span className="font-medium text-white">
                        {job.provider === "overpass" ? "Overpass" : "CSV"}
                      </span>{" "}
                      · {JOB_STATUS_LABELS[job.status] ?? job.status}
                      {["running", "processing"].includes(job.status) && (
                        <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-nox-cyan" />
                      )}
                    </p>
                    <p className="mt-1 text-xs text-nox-muted">{progressText(job, progress)}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {canPause && (
                      <button
                        type="button"
                        disabled={busyJob !== null}
                        className="text-xs text-nox-cyan disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void control(job.id, "pause")}
                      >
                        {isThisJobBusy && busyJob.action === "pause" ? "Pausando…" : "Pausar"}
                      </button>
                    )}
                    {canResume && (
                      <button
                        type="button"
                        disabled={busyJob !== null}
                        className="text-xs text-nox-cyan disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void control(job.id, "resume")}
                      >
                        {isThisJobBusy && busyJob.action === "resume" ? "Retomando…" : "Continuar"}
                      </button>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        disabled={busyJob !== null}
                        className="text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void control(job.id, "cancel")}
                      >
                        {isThisJobBusy && busyJob.action === "cancel" ? "Cancelando…" : "Cancelar"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded bg-nox-bg p-2">
                    <span className="block text-nox-muted">Encontrados</span>
                    <span className="text-base text-white">{job.foundCount}</span>
                  </div>
                  <div className="rounded bg-nox-bg p-2">
                    <span className="block text-nox-muted">Aceitos</span>
                    <span className="text-base text-emerald-300">{job.acceptedCount}</span>
                  </div>
                  <div className="rounded bg-nox-bg p-2">
                    <span className="block text-nox-muted">Duplicados</span>
                    <span className="text-base text-white">{job.duplicateCount}</span>
                  </div>
                  <div className="rounded bg-nox-bg p-2">
                    <span className="block text-nox-muted">Rejeitados</span>
                    <span className="text-base text-white">{job.rejectedCount}</span>
                  </div>
                </div>
                {progress.attribution && (
                  <p className="mt-2 text-xs text-nox-muted">Fonte: {progress.attribution}</p>
                )}
                {job.errorMessage && (
                  <p role="alert" className="mt-2 rounded bg-red-950/30 p-2 text-red-300">
                    {job.errorMessage}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
