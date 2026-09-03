import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Building2, FileText, MapPin, Phone, Server } from "lucide-react";

import { SitePanel, type SiteDto } from "@/components/projetos/site-panel";
import { requirePermission } from "@/lib/authz/dal";
import { getDemoAiConfig } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { toDemoLandingDto } from "@/lib/demo-landing";
import { markExpiredIfNeeded } from "@/lib/demo-landing-store";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";
import { getSiteProject } from "@/lib/site-factory/project-service";
import { isSiteProjectState, SITE_PROJECT_STATE_LABELS } from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

type PageProps = { params: Promise<{ id: string }> };

/** The origin the visitor is actually on, so the copied link matches the API's. */
async function siteOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function parseBrief(json: string | undefined): SiteBrief | null {
  if (!json) return null;
  try {
    return siteBriefSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

export default async function ProjectPage({ params }: PageProps) {
  await requireUser();
  const actor = await requirePermission("project:read");
  const { id } = await params;
  const project = await getSiteProject(actor, id);

  const canWrite = actor.permissions.includes("project:write");
  const canProvision = actor.permissions.includes("provisioning:read");
  const businessId = project.client.businessId;
  const stored = businessId ? await prisma.demoLanding.findUnique({ where: { businessId } }) : null;
  const landing = stored ? await markExpiredIfNeeded(stored) : null;
  const site = landing ? (toDemoLandingDto(landing, await siteOrigin()) as unknown as SiteDto) : null;

  const current =
    project.briefVersions.find((version) => version.id === project.currentBriefVersionId) ??
    project.briefVersions[0];
  const brief = parseBrief(current?.contentJson);
  const state = isSiteProjectState(project.status) ? project.status : "RASCUNHO";
  const services = brief?.schemaVersion === 2 ? brief.services : [];
  const contact = brief?.schemaVersion === 2 ? brief.publicContact : null;
  const address = contact?.address?.value ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/projetos" className="inline-flex items-center gap-1.5 text-xs text-nox-muted hover:text-white">
            <ArrowLeft size={13} aria-hidden="true" /> Projetos
          </Link>
          <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight text-white">{project.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-nox-muted">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} aria-hidden="true" /> {project.client.name}
            </span>
            {project.sector ? <span>· {project.sector}</span> : null}
            <span className="rounded-full border border-nox-border px-2.5 py-0.5 text-xs text-white">
              {SITE_PROJECT_STATE_LABELS[state]}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {businessId ? (
            <Link href={`/leads/${businessId}`} className="nox-btn-secondary">
              Ficha do lead
            </Link>
          ) : null}
          {canProvision ? (
            <Link href={`/projetos/${project.id}/provisionamento`} className="nox-btn-secondary">
              <Server size={15} aria-hidden="true" /> Provisionamento
            </Link>
          ) : null}
        </div>
      </div>

      <Suspense fallback={null}>
        <SitePanel
          projectId={project.id}
          initialSite={site}
          canWrite={canWrite}
          leadId={businessId}
          aiConfigured={getDemoAiConfig().configured}
        />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="nox-card p-6" aria-label="Briefing">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <FileText size={16} className="text-nox-cyan" aria-hidden="true" /> Briefing confirmado
            </h2>
            <span className="font-mono text-xs text-nox-muted">v{current?.version ?? "—"}</span>
          </div>
          {brief ? (
            <dl className="mt-4 space-y-4 text-sm">
              <Item label="Negócio" value={`${brief.businessName.value} · ${brief.sector.value}${brief.city?.value ? ` · ${brief.city.value}` : ""}`} />
              <Item label="Objetivo" value={brief.objective.value} />
              <Item label="Posicionamento" value={brief.positioning.value} />
              <Item label="Público" value={brief.audience.value} />
              <Item label="Direção visual" value={brief.visualDirection.value} />
              {brief.differentiators.length ? (
                <Item label="Diferenciais" value={brief.differentiators.map((fact) => fact.value).join(" · ")} />
              ) : null}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-nox-muted">Este projeto ainda não tem briefing confirmado.</p>
          )}
        </section>

        <div className="space-y-4">
          <section className="nox-card p-6" aria-label="Serviços">
            <h2 className="text-base font-semibold text-white">
              Serviços <span className="font-mono text-xs text-nox-muted">({services.length})</span>
            </h2>
            {services.length ? (
              <ul className="mt-3 space-y-2 text-sm">
                {services.map((service) => (
                  <li key={service.id} className="rounded-xl border border-nox-border bg-nox-bg/40 px-3 py-2">
                    <p className="font-medium text-white">{service.name.value}</p>
                    <p className="mt-0.5 text-xs text-nox-muted">{service.summary.value}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-nox-muted">Nenhum serviço confirmado. O site sai sem a seção de serviços.</p>
            )}
          </section>

          <section className="nox-card p-6" aria-label="Contato público">
            <h2 className="text-base font-semibold text-white">Contato público</h2>
            <ul className="mt-3 space-y-2 text-sm text-nox-muted">
              <li className="flex items-center gap-2">
                <Phone size={14} className="text-nox-cyan" aria-hidden="true" />
                {contact?.whatsapp?.value
                  ? `WhatsApp ${contact.whatsapp.value}`
                  : contact?.phone?.value
                    ? `Telefone ${contact.phone.value}`
                    : "Sem telefone confirmado"}
              </li>
              <li className="flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 text-nox-cyan" aria-hidden="true" />
                {address
                  ? [address.street, address.number, address.neighborhood, address.city, address.state].filter(Boolean).join(", ")
                  : "Sem endereço confirmado"}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nox-muted">{label}</dt>
      <dd className="mt-1 leading-6 text-white/90">{value}</dd>
    </div>
  );
}
