import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { BriefEditor } from "@/components/projetos/brief-editor";
import { requirePermission } from "@/lib/authz/dal";
import {
  briefDraftLosses,
  briefToDraft,
  initialBriefDraft,
} from "@/lib/site-factory/brief-draft";
import { parseSiteBrief } from "@/lib/site-factory/brief-schema";
import { getSiteProject } from "@/lib/site-factory/project-service";
import {
  canTransition,
  isSiteProjectState,
  SITE_PROJECT_STATE_LABELS,
} from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Briefing",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ id: string }> };

/**
 * The briefing of an existing project, open for a second answer.
 *
 * A briefing used to be answerable exactly once, in the wizard, at the moment
 * the project was created. Projects created with a short one — no services, no
 * contact — therefore produced an empty site forever: there was no screen that
 * could add the missing facts. This is that screen.
 *
 * Saving does not rewrite anything. It appends version N+1 and points the
 * project at it, which is why the sentence under the title says so: the site
 * the client can already open keeps serving the previous version until someone
 * generates again.
 */
export default async function ProjectBriefingPage({ params }: PageProps) {
  await requireUser();
  // `brief:write` rather than `project:read`: this page exists to write a new
  // version, and someone who cannot save should learn that before filling in
  // twenty fields, not after.
  const actor = await requirePermission("brief:write");
  const { id } = await params;
  // Refuses a project from another organization the same way every other read
  // does — there is no briefing here to find.
  const project = await getSiteProject(actor, id);

  const state = isSiteProjectState(project.status) ? project.status : "RASCUNHO";
  const currentBrief = project.briefVersions.find(
    (version) => version.id === project.currentBriefVersionId,
  );
  const brief = currentBrief ? parseSiteBrief(currentBrief.contentJson) : null;
  // `briefVersions` arrives newest first, and a version is never deleted, so
  // this is the number the next save will actually receive.
  const nextVersion = (project.briefVersions[0]?.version ?? 0) + 1;

  /*
   * The same gate the API applies, applied before the form instead of after
   * it. `createSiteBriefVersion` accepts a project already in
   * `BRIEFING_PRONTO` or one the machine can move there; while an agent is
   * building, it refuses. Showing the form anyway would mean an operator fills
   * the whole briefing to be told at the end that it cannot be saved.
   */
  const editable = state === "BRIEFING_PRONTO" || canTransition(state, "BRIEFING_PRONTO");

  // A v1 briefing loads with its new fields empty; anything the form cannot
  // represent is named here rather than normalised in silence.
  const losses = brief ? briefDraftLosses(brief) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          href={`/projetos/${project.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-nox-muted hover:text-white"
        >
          <ArrowLeft size={13} aria-hidden="true" /> {project.name}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Briefing de {project.name}
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-nox-muted">
          Salvar cria a versão v{nextVersion} e volta o projeto para “
          {SITE_PROJECT_STATE_LABELS.BRIEFING_PRONTO}” — o site publicado continua o anterior até
          você gerar de novo.
        </p>
        {currentBrief ? (
          <p className="mt-1 text-xs text-nox-muted">
            Editando a partir da v{currentBrief.version}
            {brief && brief.schemaVersion === 1
              ? " — briefing antigo: apresentação, contato e conteúdo dos serviços chegam em branco para você preencher."
              : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs text-nox-muted">
            Este projeto não tem briefing confirmado. O formulário começa vazio.
          </p>
        )}
      </div>

      {losses.length > 0 ? (
        <section
          className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5"
          aria-label="O que este formulário não guarda"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
            <TriangleAlert size={16} aria-hidden="true" />O briefing guarda algo que este
            formulário não mostra
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100">
            {losses.map((loss) => (
              <li key={loss}>{loss}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {editable ? (
        <BriefEditor
          projectId={project.id}
          initialDraft={brief ? briefToDraft(brief) : initialBriefDraft()}
        />
      ) : (
        <section className="nox-card p-6" aria-label="Briefing indisponível">
          <h2 className="text-base font-semibold text-white">
            Este briefing não pode ser editado agora
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-nox-muted">
            O projeto está em “{SITE_PROJECT_STATE_LABELS[state]}”, e a partir daí uma nova versão
            do briefing não é aceita. Volte ao projeto para acompanhar ou reabrir o ciclo.
          </p>
          <Link href={`/projetos/${project.id}`} className="nox-btn-secondary mt-5">
            Voltar ao projeto
          </Link>
        </section>
      )}
    </div>
  );
}
