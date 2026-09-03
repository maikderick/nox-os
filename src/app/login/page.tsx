"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, FolderKanban, Loader2, Search, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: String(form.get("email")),
      password: String(form.get("password")),
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("E-mail ou senha incorretos.");
      return;
    }
    router.push("/leads");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="nox-glow relative hidden overflow-hidden border-r border-nox-border lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="nox-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_75%)]" aria-hidden="true" />
        <Link href="/" className="relative inline-flex items-center gap-2 text-sm text-nox-muted hover:text-white">
          <ArrowLeft size={15} aria-hidden="true" /> Voltar ao site
        </Link>
        <div className="relative max-w-md">
          <p className="nox-eyebrow">Painel operacional</p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-white">
            Da oportunidade ao site publicado, em um só lugar.
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-nox-muted">
            <li className="flex gap-3">
              <Search size={18} className="mt-0.5 shrink-0 text-nox-cyan" aria-hidden="true" />
              <span><strong className="font-medium text-white">Prospecção</strong> de negócios sem site, com score de oportunidade.</span>
            </li>
            <li className="flex gap-3">
              <FolderKanban size={18} className="mt-0.5 shrink-0 text-nox-cyan" aria-hidden="true" />
              <span><strong className="font-medium text-white">Projetos</strong> com briefing confirmado, prévia e publicação controlada.</span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-nox-cyan" aria-hidden="true" />
              <span><strong className="font-medium text-white">Contato responsável</strong>: WhatsApp só com opt-in registrado.</span>
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-nox-muted">Área privada. Não indexada por buscadores.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-nox-cyan/40 bg-nox-cyan/10">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-nox-cyan" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M5 19V5l14 14V5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span><span className="text-nox-cyan">NOX</span> OS</span>
          </Link>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-white">Entrar no painel</h1>
          <p className="mt-2 text-sm text-nox-muted">Use o e-mail e a senha da sua conta.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate={false}>
            <div>
              <label htmlFor="email" className="text-sm font-medium text-white">E-mail</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username"
                className="nox-input mt-1.5"
                placeholder="voce@empresa.com.br"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium text-white">Senha</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="nox-input mt-1.5"
                placeholder="••••••••"
              />
            </div>
            {error ? (
              <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={loading} className="nox-btn-primary w-full py-3">
              {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>
          <p className="mt-8 text-center text-xs text-nox-muted">
            Sem acesso? Peça ao administrador da sua organização.
          </p>
        </div>
      </section>
    </main>
  );
}
