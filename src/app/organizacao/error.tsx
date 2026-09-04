"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * The factory pages resolve permissions server-side, and a refusal arrives here
 * as a thrown error. Next's `forbidden()` would be the natural answer, but it
 * needs `experimental.authInterrupts`; until that is turned on, this boundary is
 * what keeps a refusal from looking like a crash.
 */
export default function OrganizationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Server errors reach the client stripped of their message, so the copy has to
  // work for a refusal and for a genuine fault alike.
  return (
    <div className="mx-auto max-w-2xl py-16">
      <section className="rounded-3xl border border-nox-border bg-nox-surface p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">
          Organização
        </p>
        <h1 className="mt-3 flex items-start gap-3 text-2xl font-semibold tracking-tight text-white">
          <ShieldAlert className="mt-1 shrink-0 text-amber-300" size={22} aria-hidden="true" />
          Não foi possível abrir esta tela.
        </h1>
        <p className="mt-4 text-sm leading-6 text-nox-muted">
          Ou a sua conta não tem autorização para esta parte da fábrica, ou algo falhou ao
          carregar. Se você precisa deste acesso, peça a um administrador da organização.
        </p>
        {error.digest ? (
          <p className="mt-4 text-xs text-nox-muted">
            Código para suporte: <code className="text-nox-cyan">{error.digest}</code>
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-nox-bg transition hover:bg-cyan-100"
          >
            Tentar de novo
          </button>
          <Link
            href="/leads"
            className="rounded-xl border border-nox-border px-4 py-2 text-sm text-nox-muted transition hover:text-white"
          >
            Ir para Prospecção
          </Link>
        </div>
      </section>
    </div>
  );
}
