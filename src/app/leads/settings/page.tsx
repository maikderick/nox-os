"use client";

import { FormEvent, useEffect, useState } from "react";

type Settings = {
  brandName: string;
  sellerName: string;
  defaultCity: string;
  leadGoal: number;
  initialRadiusKm: number;
  maxRadiusKm: number;
  privacyEmail: string;
  portfolioUrl: string;
  whatsappPhone: string;
  whatsappTemplate: string;
  originLat: number | null;
  originLng: number | null;
  originLabel: string | null;
  franchisePenalty: number;
  modernSitePenalty: number;
  staleDataPenalty: number;
  enabledCategories: string[];
  retentionDays: number;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retentionBusy, setRetentionBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as
          | { settings?: Settings; error?: unknown }
          | null;
        if (!response.ok || !data?.settings) {
          throw new Error(`Não foi possível carregar as configurações (HTTP ${response.status}).`);
        }
        setSettings(data.settings);
      } catch (error) {
        setMsg(error instanceof Error ? error.message : "Falha ao carregar as configurações.");
      }
    })();
  }, []);

  function responseError(error: unknown, status: number): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      return `Dados inválidos: ${JSON.stringify(error)}`;
    }
    return `Falha ao salvar (HTTP ${status}).`;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMsg("Salvando configurações…");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = (await res.json().catch(() => null)) as
        | { settings?: Settings; error?: unknown }
        | null;
      if (!res.ok) {
        setMsg(responseError(data?.error, res.status));
        return;
      }
      if (data?.settings) setSettings(data.settings);
      setMsg("Configurações salvas.");
    } catch {
      setMsg("Falha de rede ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function runRetention() {
    setRetentionBusy(true);
    setMsg("Executando retenção…");
    try {
      const res = await fetch("/api/audit/retention", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { deleted?: number; error?: unknown }
        | null;
      setMsg(
        res.ok
          ? `Retenção: ${data?.deleted ?? 0} registros removidos.`
          : responseError(data?.error, res.status),
      );
    } catch {
      setMsg("Falha de rede ao executar a retenção.");
    } finally {
      setRetentionBusy(false);
    }
  }

  if (!settings) {
    return <p className={msg ? "text-red-300" : "text-nox-muted"}>{msg ?? "Carregando…"}</p>;
  }

  function field<K extends keyof Settings>(key: K, label: string, type: "text" | "number" = "text") {
    return (
      <label className="block text-sm">
        {label}
        <input
          type={type}
          className="mt-1 w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2"
          value={settings![key] ?? ""}
          onChange={(e) =>
            setSettings({
              ...settings!,
              [key]:
                type === "number"
                  ? Number(e.target.value)
                  : (e.target.value as Settings[K]),
            })
          }
        />
      </label>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Configurações</h1>
        <p className="text-sm text-nox-muted">
          Marca, consultor, meta, raios e mensagens. Segredos ficam apenas no `.env` do servidor.
        </p>
      </div>
      {msg && (
        <p role="status" aria-live="polite" className="text-sm text-nox-cyan">
          {msg}
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-nox-border bg-nox-surface p-4">
        {field("brandName", "Marca")}
        {field("sellerName", "Consultor")}
        {field("defaultCity", "Cidade padrão")}
        {field("leadGoal", "Meta de leads", "number")}
        {field("initialRadiusKm", "Raio inicial (km)", "number")}
        {field("maxRadiusKm", "Raio máximo (km)", "number")}
        {field("privacyEmail", "E-mail de privacidade")}
        {field("portfolioUrl", "Portfólio")}
        {field("whatsappPhone", "Telefone NOX OS")}
        {field("franchisePenalty", "Penalidade franquia", "number")}
        {field("modernSitePenalty", "Penalidade site moderno", "number")}
        {field("staleDataPenalty", "Penalidade dados antigos", "number")}
        {field("retentionDays", "Retenção (dias)", "number")}
        <label className="block text-sm">
          Template WhatsApp
          <textarea
            className="mt-1 min-h-32 w-full rounded-lg border border-nox-border bg-nox-bg p-3 text-sm"
            value={settings.whatsappTemplate}
            onChange={(e) => setSettings({ ...settings, whatsappTemplate: e.target.value })}
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void runRetention()}
        disabled={retentionBusy}
        className="rounded-lg border border-nox-border px-4 py-2 text-sm disabled:cursor-wait disabled:opacity-60"
      >
        {retentionBusy ? "Executando retenção…" : "Executar retenção/exclusão agora"}
      </button>
      <div className="rounded-xl border border-dashed border-nox-border p-4 text-sm text-nox-muted">
        <p className="font-medium text-white">Variáveis de ambiente (servidor)</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
          <li>DATABASE_URL</li>
          <li>NEXTAUTH_SECRET / NEXTAUTH_URL</li>
          <li>DEMO_MODE</li>
          <li>BRAND_NAME, SELLER_NAME, DEFAULT_CITY, LEAD_GOAL…</li>
        </ul>
        <p className="mt-2">Nunca use NEXT_PUBLIC_* para segredos.</p>
      </div>
    </div>
  );
}
