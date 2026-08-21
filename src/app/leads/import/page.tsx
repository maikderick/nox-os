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

export default function ImportPage() {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [geoQ, setGeoQ] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [categories, setCategories] = useState<string[]>(CATEGORY_GROUPS.map((c) => c.id));
  const [csvText, setCsvText] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [geoDenied, setGeoDenied] = useState(false);

  async function refreshJobs() {
    const res = await fetch("/api/import");
    const data = (await res.json()) as { jobs: Job[] };
    setJobs(data.jobs);
  }

  useEffect(() => {
    void refreshJobs();
    const t = setInterval(() => void refreshJobs(), 4000);
    return () => clearInterval(t);
  }, []);

  function requestGeo() {
    if (!navigator.geolocation) {
      setGeoDenied(true);
      setMsg("Geolocalização não suportada neste navegador.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLabel("Minha localização (navegador)");
        setGeoDenied(false);
        setMsg("Localização autorizada.");
      },
      () => {
        setGeoDenied(true);
        setMsg("Geolocalização negada. Informe cidade, endereço ou CEP.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function searchPlace() {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(geoQ)}`);
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? "Falha no geocode");
      return;
    }
    setGeoResults(data.results);
  }

  async function startOverpass() {
    if (lat == null || lng == null) {
      setMsg("Defina uma localização antes de buscar.");
      return;
    }
    setMsg("Iniciando importação Overpass…");
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "overpass",
        lat,
        lng,
        label,
        categoryIds: categories,
        radiiKm: [...DEFAULT_RADII_KM],
      }),
    });
    const data = await res.json();
    setMsg(res.ok ? `Job ${data.jobId} iniciado.` : data.error ?? "Erro");
    await refreshJobs();
  }

  async function startCsv() {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "csv",
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        label,
        csvText,
        categoryIds: categories,
      }),
    });
    const data = await res.json();
    setMsg(
      res.ok
        ? `CSV: aceitos ${data.stats.accepted}, duplicados ${data.stats.duplicate}, rejeitados ${data.stats.rejected}`
        : data.error ?? "Erro",
    );
    await refreshJobs();
  }

  async function control(jobId: string, action: "pause" | "resume" | "cancel") {
    await fetch("/api/import", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, action }),
    });
    await refreshJobs();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Importação</h1>
        <p className="text-sm text-nox-muted">
          OpenStreetMap/Overpass + CSV. Sem scraping. Expansão 5→80 km até a meta ou limite.
          Empresas nunca são inventadas.
        </p>
        <p className="mt-2 text-xs text-nox-muted">
          © OpenStreetMap contributors — ODbL. Atribuição obrigatória.
        </p>
      </div>

      {msg && <p className="text-sm text-nox-cyan">{msg}</p>}
      {geoDenied && (
        <p className="text-sm text-amber-300">
          Geolocalização negada — use busca manual por cidade/endereço/CEP.
        </p>
      )}

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Localização</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={requestGeo}
            className="rounded-lg bg-nox-cyan px-3 py-2 text-sm font-semibold text-nox-bg"
          >
            Usar minha localização
          </button>
          <input
            className="min-w-[240px] flex-1 rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            placeholder="Cidade, endereço ou CEP"
            value={geoQ}
            onChange={(e) => setGeoQ(e.target.value)}
          />
          <button
            type="button"
            onClick={() => void searchPlace()}
            className="rounded-lg border border-nox-border px-3 py-2 text-sm"
          >
            Buscar
          </button>
        </div>
        {lat != null && lng != null && (
          <p className="mt-2 text-sm text-nox-muted">
            Origem: {label || "manual"} · {lat.toFixed(5)}, {lng.toFixed(5)}
          </p>
        )}
        <ul className="mt-2 space-y-1">
          {geoResults.map((r) => (
            <li key={r.label}>
              <button
                type="button"
                className="text-left text-sm text-nox-cyan hover:underline"
                onClick={() => {
                  setLat(r.lat);
                  setLng(r.lng);
                  setLabel(r.label);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Categorias</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {CATEGORY_GROUPS.map((g) => (
            <label key={g.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={categories.includes(g.id)}
                onChange={(e) => {
                  setCategories((prev) =>
                    e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id),
                  );
                }}
              />
              <span>{g.label}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="mt-4 rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium"
          onClick={() => void startOverpass()}
        >
          Buscar no Overpass (5–80 km)
        </button>
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Importar CSV</h2>
        <p className="mt-1 text-xs text-nox-muted">
          Colunas: name/nome, category/categoria, address/endereco, city/cidade, state/uf,
          latitude/lat, longitude/lng, phone/telefone, website/site, id/externalId
        </p>
        <textarea
          className="mt-3 min-h-40 w-full rounded-lg border border-nox-border bg-nox-bg p-3 font-mono text-xs"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="name,category,city,phone,website&#10;Padaria Central,Padarias,São Paulo,11999990000,"
        />
        <button
          type="button"
          className="mt-3 rounded-lg border border-nox-border px-4 py-2 text-sm"
          onClick={() => void startCsv()}
        >
          Importar CSV
        </button>
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Jobs</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {jobs.length === 0 && <li className="text-nox-muted">Nenhum job ainda.</li>}
          {jobs.map((j) => (
            <li key={j.id} className="rounded-lg border border-nox-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="text-white">{j.provider}</span> · {j.status}
                  {j.currentRadiusKm != null ? ` · r=${j.currentRadiusKm}km` : ""}
                </p>
                <div className="flex gap-2">
                  <button type="button" className="text-xs text-nox-cyan" onClick={() => void control(j.id, "pause")}>
                    Pausar
                  </button>
                  <button type="button" className="text-xs text-nox-cyan" onClick={() => void control(j.id, "resume")}>
                    Continuar
                  </button>
                  <button type="button" className="text-xs text-red-300" onClick={() => void control(j.id, "cancel")}>
                    Cancelar
                  </button>
                </div>
              </div>
              <p className="mt-1 text-nox-muted">
                encontrados {j.foundCount} · aceitos {j.acceptedCount} · duplicados{" "}
                {j.duplicateCount} · rejeitados {j.rejectedCount}
              </p>
              {j.errorMessage && <p className="text-red-300">{j.errorMessage}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
