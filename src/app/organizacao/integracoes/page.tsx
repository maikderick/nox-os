import { CircleSlash, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";

import { requirePermission } from "@/lib/authz/dal";
import { IntegrationModePicker } from "@/components/organizacao/integration-mode-picker";
import {
  INTEGRATION_MODE_LABELS,
  INTEGRATION_PROVIDER_LABELS,
  environmentForcesDisabled,
} from "@/lib/integrations/modes";
import { SECRET_PURPOSE_LABELS, type SecretPurpose } from "@/lib/integrations/secret-ref";
import { listIntegrations } from "@/lib/integrations/settings-service";
import { requireUser } from "@/lib/session";

const MODE_STYLES: Record<string, string> = {
  DESLIGADO: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  FALSO: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  SANDBOX: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  LIVE: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
};

export default async function IntegrationsPage() {
  await requireUser();
  const actor = await requirePermission("org:read");
  const integrations = await listIntegrations(actor);
  const canManage = actor.permissions.includes("integration:manage");
  const forcedOff = environmentForcesDisabled();

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">
          Organização
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Integrações</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-nox-muted">
          Toda integração nasce desligada. <strong className="text-white">Falso</strong> roda em
          memória, <strong className="text-white">Sandbox</strong> reproduz respostas gravadas, e
          nenhum dos dois toca a rede.
        </p>
      </section>

      <section className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
          <TriangleAlert size={16} aria-hidden="true" />
          Live não é opção nesta fase
        </h2>
        <p className="mt-2 text-sm leading-6 text-amber-100/80">
          Ligar um provedor real cria repositórios, projetos e cobranças de verdade. É uma decisão
          separada, aprovada e auditada, feita um provedor por vez — e só depois que este caminho
          inteiro estiver exercitado contra falso e sandbox.
        </p>
      </section>

      {forcedOff ? (
        <section className="rounded-2xl border border-nox-border bg-nox-panel p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <CircleSlash size={16} className="text-slate-300" aria-hidden="true" />
            Desligado pelo ambiente
          </h2>
          <p className="mt-2 text-sm leading-6 text-nox-muted">
            <code className="text-nox-cyan">NOX_INTEGRATIONS=disabled</code> está definido. Todo
            provedor opera como desligado, qualquer que seja o modo salvo abaixo.
          </p>
        </section>
      ) : null}

      <div className="space-y-4">
        {integrations.map((integration) => (
          <section
            key={integration.provider}
            className="rounded-2xl border border-nox-border bg-nox-surface p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {INTEGRATION_PROVIDER_LABELS[integration.provider]}
                </h2>
                <p className="mt-1 text-xs text-nox-muted">
                  Salvo: {INTEGRATION_MODE_LABELS[integration.storedMode]}
                  {integration.forcedOffByEnvironment ? " · sobreposto pelo ambiente" : ""}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  MODE_STYLES[integration.effectiveMode] ?? MODE_STYLES.DESLIGADO
                }`}
              >
                {INTEGRATION_MODE_LABELS[integration.effectiveMode]}
              </span>
            </div>

            {integration.pendingPhase ? (
              <p className="mt-4 text-sm leading-6 text-nox-muted">
                Ainda não é operável: depende da fila durável e do controle de créditos, que
                chegam em uma fase posterior. Nenhum modo além de desligado é aceito.
              </p>
            ) : canManage ? (
              <IntegrationModePicker
                provider={integration.provider}
                mode={integration.storedMode}
                available={[...integration.availableModes]}
              />
            ) : (
              <p className="mt-4 text-xs text-nox-muted">
                Alterar o modo exige <code className="text-nox-cyan">integration:manage</code>.
              </p>
            )}

            {integration.secrets.length > 0 ? (
              <dl className="mt-5 space-y-2 border-t border-nox-border pt-4">
                {integration.secrets.map((secret) => (
                  <div
                    key={secret.purpose}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <dt className="flex items-center gap-2 text-nox-muted">
                      <KeyRound size={14} aria-hidden="true" />
                      {SECRET_PURPOSE_LABELS[secret.purpose as SecretPurpose] ?? secret.purpose}
                      <code className="text-xs text-nox-muted/70">{secret.envVarName}</code>
                    </dt>
                    <dd
                      className={
                        secret.configured
                          ? "flex items-center gap-1 text-emerald-300"
                          : "text-slate-400"
                      }
                    >
                      {secret.configured ? (
                        <>
                          <ShieldCheck size={14} aria-hidden="true" />
                          {secret.rotated ? "Definido · rotacionado" : "Definido"}
                        </>
                      ) : (
                        "Não definido"
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-5 border-t border-nox-border pt-4 text-xs text-nox-muted">
                Nenhuma credencial registrada para este provedor.
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
