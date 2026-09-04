"use client";

import { useState } from "react";

export default function AccountPage() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");

    if (newPassword.length < 12) {
      setNotice({ error: true, text: "A nova senha precisa ter pelo menos 12 caracteres." });
      return;
    }
    if (newPassword !== confirmation) {
      setNotice({ error: true, text: "A confirmação não corresponde à nova senha." });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível alterar a senha.");

      form.reset();
      setNotice({ error: false, text: "Senha alterada com sucesso." });
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Não foi possível alterar a senha.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Minha conta</h1>
        <p className="text-sm text-nox-muted">Altere sua senha de acesso ao painel NOX OS.</p>
      </div>

      {notice && (
        <p
          role={notice.error ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.error
              ? "border-red-400/40 bg-red-950/30 text-red-200"
              : "border-emerald-400/40 bg-emerald-950/30 text-emerald-200"
          }`}
        >
          {notice.text}
        </p>
      )}

      <form
        onSubmit={(event) => void changePassword(event)}
        className="space-y-4 rounded-xl border border-nox-border bg-nox-surface p-5"
      >
        <label className="block text-sm">
          Senha atual
          <input
            required
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Nova senha
          <input
            required
            minLength={12}
            maxLength={128}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2"
          />
          <span className="mt-1 block text-xs text-nox-muted">Mínimo de 12 caracteres.</span>
        </label>
        <label className="block text-sm">
          Confirmar nova senha
          <input
            required
            minLength={12}
            maxLength={128}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Alterando…" : "Alterar senha"}
        </button>
      </form>
    </div>
  );
}
