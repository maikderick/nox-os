"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
      setError("Credenciais inválidas.");
      return;
    }
    router.push("/leads");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-nox-border bg-nox-surface p-8">
        <Link href="/" className="text-lg font-semibold">
          <span className="text-nox-cyan">NOX</span> OS
        </Link>
        <h1 className="mt-6 text-2xl font-semibold text-white">Acesso ao painel</h1>
        <p className="mt-2 text-sm text-nox-muted">Área privada de prospecção. Não indexada.</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block text-sm">
            E-mail
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2"
              defaultValue="admin@noxos.local"
            />
          </label>
          <label className="block text-sm">
            Senha
            <input
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2"
              defaultValue="noxos-admin-123"
            />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-nox-purple px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
