import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "NOX OS — Sites personalizados para negócios locais",
    template: "%s · NOX OS",
  },
  description:
    "A NOX OS cria sites personalizados que transformam negócios locais: presença digital, contatos, catálogo, reservas e vendas.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: siteUrl,
    siteName: "NOX OS",
    title: "NOX OS — Sites personalizados para negócios locais",
    description:
      "Sites personalizados que transformam negócios locais com presença digital, geração de contatos e autoridade.",
  },
  twitter: {
    card: "summary_large_image",
    title: "NOX OS",
    description: "Sites personalizados que transformam negócios locais.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${display.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
