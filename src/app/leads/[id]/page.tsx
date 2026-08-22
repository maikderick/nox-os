"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FUNNEL_LABELS, FUNNEL_STAGES } from "@/lib/funnel";
import { DemoLandingPanel } from "@/components/leads/demo-landing-panel";
import { hasOwnWebsite } from "@/lib/website";

type LeadDetail = {
  id: string;
  name: string;
  category: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  distanceKm: number | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  website: string | null;
  websiteStatus: string;
  socialLinks: string;
  source: string;
  sourceUrl: string | null;
  collectedAt: string;
  lastVerifiedAt: string;
  opportunityScore: number;
  confidenceScore: number;
  scoreReasons: string[];
  notesText: string | null;
  funnelStage: string;
  doNotContact: boolean;
  latitude: number | null;
  longitude: number | null;
  isDemo: boolean;
  consents: Array<{
    id: string;
    optInStatus: string;
    source: string | null;
    purpose: string | null;
    evidence: string | null;
    optedInAt: string | null;
    refusedAt: string | null;
  }>;
  contacts: Array<{
    id: string;
    channel: string;
    messagePreview: string | null;
    confirmedSent: boolean;
    outcome: string | null;
    createdAt: string;
  }>;
  notes: Array<{ id: string; body: string; createdAt: string }>;
  suppressions: Array<{ id: string; reason: string }>;
};

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [message, setMessage] = useState("");
  const [waLink, setWaLink] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [optInEvidence, setOptInEvidence] = useState("");
  const [optInSource, setOptInSource] = useState("registro manual");

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads/${params.id}`);
    if (!res.ok) return;
    const data = (await res.json()) as LeadDetail;
    setLead({
      ...data,
      scoreReasons: Array.isArray(data.scoreReasons)
        ? data.scoreReasons
        : JSON.parse(String(data.scoreReasons || "[]")),
    });
    const preview = await fetch(`/api/leads/${params.id}?action=preview-message`, {
      method: "POST",
    });
    if (preview.ok) {
      const pj = (await preview.json()) as { message: string };
      setMessage(pj.message);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!lead) {
    return <p className="text-nox-muted">Carregando ficha…</p>;
  }

  const consent = lead.consents[0];
  const optIn = consent?.optInStatus ?? "unknown";
  const social = JSON.parse(lead.socialLinks || "[]") as string[];
  const waBlocked =
    lead.doNotContact ||
    lead.suppressions.length > 0 ||
    optIn !== "verified" ||
    !lead.phoneE164;
  const demoEligible = !hasOwnWebsite(lead.website);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/leads/${lead!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      setStatusMsg(err.error ?? "Falha ao salvar");
      return;
    }
    setStatusMsg("Atualizado.");
    await load();
  }

  async function prepareWhatsApp() {
    if (!lead) return;
    if (!confirm("Confirmar abertura manual de uma única conversa no WhatsApp?")) return;
    const leadId = lead.id;
    const res = await fetch(`/api/leads/${leadId}?action=whatsapp-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, confirmPreview: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatusMsg(data.error ?? "Bloqueado");
      return;
    }
    setWaLink(data.link);
    window.open(data.link, "_blank", "noopener,noreferrer");
    const sent = confirm("A mensagem foi realmente enviada no WhatsApp?");
    await fetch(`/api/leads/${leadId}?action=confirm-sent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sent }),
    });
    await load();
  }

  async function removeLead() {
    if (!lead) return;
    if (!confirm("Excluir este estabelecimento?")) return;
    await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
    router.push("/leads");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/leads" className="text-sm text-nox-cyan">
            ← Voltar
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-white">{lead.name}</h1>
          <p className="text-sm text-nox-muted">
            {lead.category} · {lead.neighborhood ?? "—"} · {lead.city ?? "—"}/{lead.state ?? "—"}
            {lead.isDemo ? " · Dados de demonstração" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-red-500/50 px-3 py-2 text-sm text-red-300"
            onClick={() => void patch({ doNotContact: true, funnelStage: "nao_contatar" })}
          >
            Não contatar
          </button>
          <button
            type="button"
            className="rounded-lg border border-nox-border px-3 py-2 text-sm"
            onClick={() => void removeLead()}
          >
            Excluir
          </button>
        </div>
      </div>

      {statusMsg && <p className="text-sm text-nox-cyan">{statusMsg}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-xl border border-nox-border bg-nox-surface p-4 lg:col-span-2">
          <h2 className="font-medium text-white">Dados comerciais</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Item label="Endereço" value={lead.address} />
            <Item label="Distância" value={lead.distanceKm != null ? `${lead.distanceKm} km` : null} />
            <Item label="Telefone original" value={lead.phoneRaw} />
            <Item label="Telefone E.164" value={lead.phoneE164} />
            <Item
              label="Site (fonte)"
              value={
                lead.website
                  ? `${lead.website} (${lead.websiteStatus})`
                  : "Site não identificado na fonte"
              }
            />
            <Item label="Fonte" value={`${lead.source} · coletado ${new Date(lead.collectedAt).toLocaleString("pt-BR")}`} />
            <Item label="Última verificação" value={new Date(lead.lastVerifiedAt).toLocaleString("pt-BR")} />
            <Item label="Redes" value={social.join(", ") || "—"} />
          </dl>
          {lead.sourceUrl && (
            <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-nox-cyan">
              Abrir fonte
            </a>
          )}
          {lead.latitude != null && lead.longitude != null && (
            <a
              className="ml-4 text-sm text-nox-cyan"
              href={`https://www.openstreetmap.org/?mlat=${lead.latitude}&mlon=${lead.longitude}#map=18/${lead.latitude}/${lead.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir mapa
            </a>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-nox-border bg-nox-surface p-4">
          <h2 className="font-medium text-white">Oportunidade</h2>
          <p className="text-3xl font-semibold text-nox-cyan">{lead.opportunityScore}</p>
          <p className="text-sm text-nox-muted">Confiança: {lead.confidenceScore}</p>
          <div className="flex flex-wrap gap-1">
            {lead.scoreReasons.map((r) => (
              <span key={r} className="rounded-full border border-nox-border px-2 py-0.5 text-xs">
                {r}
              </span>
            ))}
          </div>
          <label className="block text-sm">
            Etapa do funil
            <select
              className="mt-1 w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2"
              value={lead.funnelStage}
              onChange={(e) => void patch({ funnelStage: e.target.value })}
            >
              {FUNNEL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {FUNNEL_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </section>
      </div>

      <DemoLandingPanel
        leadId={lead.id}
        leadName={lead.name}
        eligible={demoEligible}
        whatsappBlocked={waBlocked}
        message={message}
        onMessageChange={setMessage}
      />

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Opt-in WhatsApp</h2>
        <p className="mt-1 text-sm text-nox-muted">
          Status atual: <strong className="text-white">{optIn}</strong>
          {consent?.source ? ` · fonte: ${consent.source}` : ""}
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            placeholder="Fonte do opt-in"
            value={optInSource}
            onChange={(e) => setOptInSource(e.target.value)}
          />
          <input
            className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm md:col-span-2"
            placeholder="Evidência / observação"
            value={optInEvidence}
            onChange={(e) => setOptInEvidence(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["pending", "verified", "refused"] as const).map((status) => (
            <button
              key={status}
              type="button"
              className="rounded-lg border border-nox-border px-3 py-1 text-sm"
              onClick={() =>
                void patch({
                  optInStatus: status,
                  optInSource,
                  optInEvidence,
                  optInPurpose: "contato comercial sobre site personalizado NOX OS",
                })
              }
            >
              Marcar {status}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-nox-border bg-nox-surface p-4">
        <h2 className="font-medium text-white">Contato WhatsApp (manual)</h2>
        <p className="mt-1 text-xs text-amber-300">
          Nenhum disparo automático. O botão só libera com opt-in verified e fora da lista de
          supressão.
        </p>
        {consent && optIn === "verified" && (
          <p className="mt-2 text-sm text-nox-muted">
            Opt-in registrado: {consent.purpose ?? "—"} · {consent.evidence ?? "sem evidência"}
          </p>
        )}
        <textarea
          className="mt-3 min-h-28 w-full rounded-lg border border-nox-border bg-nox-bg p-3 text-sm"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={waBlocked}
        />
        <button
          type="button"
          disabled={waBlocked}
          className="mt-3 rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void prepareWhatsApp()}
        >
          Abrir WhatsApp
        </button>
        {waLink && (
          <p className="mt-2 break-all text-xs text-nox-muted">Link gerado: {waLink}</p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-nox-border bg-nox-surface p-4">
          <h2 className="font-medium text-white">Histórico de contatos</h2>
          <ul className="mt-3 space-y-2 text-sm text-nox-muted">
            {lead.contacts.length === 0 && <li>Nenhum contato.</li>}
            {lead.contacts.map((c) => (
              <li key={c.id}>
                {new Date(c.createdAt).toLocaleString("pt-BR")} · {c.channel} ·{" "}
                {c.confirmedSent ? "enviado" : c.outcome}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-nox-border bg-nox-surface p-4">
          <h2 className="font-medium text-white">Observações</h2>
          <p className="mt-2 text-sm text-nox-muted">{lead.notesText || "—"}</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void patch({ note: String(fd.get("note")), notesText: String(fd.get("note")) });
              e.currentTarget.reset();
            }}
          >
            <input
              name="note"
              required
              placeholder="Nova observação"
              className="flex-1 rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-lg border border-nox-border px-3 text-sm">
              Salvar
            </button>
          </form>
          <ul className="mt-3 space-y-1 text-xs text-nox-muted">
            {lead.notes.map((n) => (
              <li key={n.id}>
                {new Date(n.createdAt).toLocaleString("pt-BR")}: {n.body}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Item({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-nox-muted">{label}</dt>
      <dd className="text-white">{value || "—"}</dd>
    </div>
  );
}
