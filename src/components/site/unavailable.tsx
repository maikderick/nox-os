export function SiteUnavailable({ reason }: { reason: "missing" | "expired" | "unavailable" }) {
  const title = reason === "expired" ? "Esta prévia expirou" : "Site indisponível";
  const text =
    reason === "expired"
      ? "O endereço era uma prévia temporária e saiu do ar. Peça uma nova versão a quem enviou o link."
      : "Este endereço não está disponível no momento.";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07070b] px-6 text-[#f8fafc]">
      <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/40 sm:p-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-slate-400 sm:text-base">{text}</p>
        <p className="mt-8 text-xs uppercase tracking-[0.16em] text-slate-500">Criado com NOX OS</p>
      </section>
    </main>
  );
}
