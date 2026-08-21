import type { Metadata } from "next";
import Link from "next/link";
import { ensureDefaultSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Política de privacidade",
};

export default async function PrivacyPage() {
  const settings = await ensureDefaultSettings();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-nox-muted">
      <Link href="/" className="text-sm text-nox-cyan">
        ← Voltar
      </Link>
      <h1 className="mt-6 text-3xl font-semibold text-white">Política de privacidade</h1>
      <p className="mt-4 text-sm">Última atualização: {new Date().toISOString().slice(0, 10)}</p>
      <div className="mt-8 space-y-4 text-sm leading-relaxed">
        <p>
          A {settings.brandName} trata dados de prospecção B2B com finalidade comercial legítima,
          a partir de fontes públicas autorizadas e importações controladas pelo usuário.
        </p>
        <p>
          Telefones só são usados para contato manual via WhatsApp quando existir opt-in
          registrado (`verified`). Não realizamos disparos automáticos ou em massa.
        </p>
        <p>
          Você pode solicitar exclusão ou restrição de tratamento pelo e-mail{" "}
          <a className="text-nox-cyan" href={`mailto:${settings.privacyEmail}`}>
            {settings.privacyEmail}
          </a>
          . A retenção padrão é de {settings.retentionDays} dias, configurável no painel.
        </p>
        <p>
          Dados de geolocalização do navegador só são obtidos com autorização explícita do
          usuário do painel.
        </p>
      </div>
    </main>
  );
}
