"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function IntegrationModePicker({
  provider,
  mode,
  available,
}: {
  provider: string;
  mode: string;
  available: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    if (next === mode) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/organizations/integrations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, mode: next }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
        setError(
          typeof payload?.error === "string" ? payload.error : "Não foi possível alterar o modo.",
        );
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Não foi possível alterar o modo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label={"Modo de " + provider}>
        {available.map((option) => (
          <button
            key={option}
            type="button"
            disabled={saving || pending}
            aria-pressed={option === mode}
            onClick={() => change(option)}
            className={`rounded-xl border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
              option === mode
                ? "border-nox-cyan bg-nox-cyan/10 text-white"
                : "border-nox-border text-nox-muted hover:text-white"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
