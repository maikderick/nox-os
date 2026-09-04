"use client";

import { useCallback, useEffect, useState } from "react";

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  active: boolean;
  createdAt: string;
};

async function responsePayload(response: Response): Promise<{ error?: string; users?: ManagedUser[]; currentUserId?: string }> {
  return (await response.json().catch(() => ({}))) as {
    error?: string;
    users?: ManagedUser[];
    currentUserId?: string;
  };
}

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/users", { cache: "no-store" });
    const payload = await responsePayload(response);
    if (!response.ok) {
      setNotice({ error: true, text: payload.error ?? "Não foi possível carregar os usuários." });
      return;
    }
    setUsers(payload.users ?? []);
    setCurrentUserId(payload.currentUserId ?? "");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
          role: String(data.get("role") ?? "operator"),
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível criar o usuário.");
      form.reset();
      setNotice({ error: false, text: "Usuário criado com sucesso." });
      await load();
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Não foi possível criar o usuário.",
      });
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(id: string, change: Record<string, unknown>, success: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...change }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível atualizar o usuário.");
      setNotice({ error: false, text: success });
      await load();
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Não foi possível atualizar o usuário.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(user: ManagedUser) {
    const password = resetPasswords[user.id] ?? "";
    if (password.length < 12) {
      setNotice({ error: true, text: "A senha temporária precisa ter pelo menos 12 caracteres." });
      return;
    }
    await updateUser(user.id, { password }, `Senha de ${user.name} redefinida.`);
    setResetPasswords((previous) => ({ ...previous, [user.id]: "" }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Usuários</h1>
        <p className="text-sm text-nox-muted">
          Crie acessos, escolha o perfil, redefina senhas e desative contas.
        </p>
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
        onSubmit={(event) => void createUser(event)}
        className="grid gap-3 rounded-xl border border-nox-border bg-nox-surface p-4 md:grid-cols-2 xl:grid-cols-5"
      >
        <input
          required
          name="name"
          placeholder="Nome"
          className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
        />
        <input
          required
          name="email"
          type="email"
          placeholder="E-mail"
          className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
        />
        <input
          required
          minLength={12}
          maxLength={128}
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Senha temporária (12+)"
          className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
        />
        <select
          name="role"
          defaultValue="operator"
          className="rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
        >
          <option value="operator">Operador</option>
          <option value="admin">Administrador</option>
        </select>
        <button
          type="submit"
          disabled={creating}
          className="nox-btn-primary disabled:opacity-50"
        >
          {creating ? "Criando…" : "Criar usuário"}
        </button>
      </form>

      <div className="space-y-3">
        {users.map((user) => {
          const isCurrent = user.id === currentUserId;
          const busy = busyId === user.id;
          return (
            <article
              key={user.id}
              className={`rounded-xl border border-nox-border bg-nox-surface p-4 ${
                user.active ? "" : "opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium text-white">
                    {user.name} {isCurrent && <span className="text-xs text-nox-cyan">(você)</span>}
                  </h2>
                  <p className="text-sm text-nox-muted">{user.email}</p>
                  <p className="mt-1 text-xs text-nox-muted">
                    Criado em {new Date(user.createdAt).toLocaleString("pt-BR")} · {user.active ? "Ativo" : "Desativado"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={user.role}
                    disabled={busy}
                    onChange={(event) =>
                      void updateUser(
                        user.id,
                        { role: event.target.value },
                        `Perfil de ${user.name} atualizado.`,
                      )
                    }
                    className="rounded-lg border border-nox-border bg-nox-bg px-3 py-1.5 text-sm"
                  >
                    <option value="operator">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy || isCurrent}
                    onClick={() =>
                      void updateUser(
                        user.id,
                        { active: !user.active },
                        `${user.name} ${user.active ? "desativado" : "ativado"}.`,
                      )
                    }
                    className="rounded-lg border border-nox-border px-3 py-1.5 text-sm disabled:opacity-40"
                  >
                    {user.active ? "Desativar" : "Ativar"}
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  minLength={12}
                  maxLength={128}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Nova senha temporária (12+)"
                  value={resetPasswords[user.id] ?? ""}
                  onChange={(event) =>
                    setResetPasswords((previous) => ({
                      ...previous,
                      [user.id]: event.target.value,
                    }))
                  }
                  className="min-w-64 flex-1 rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resetPassword(user)}
                  className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan disabled:opacity-40"
                >
                  Redefinir senha
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
