import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  JetBrains_Mono,
  Plus_Jakarta_Sans,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

/** Public demo pages only: a heavier, tighter display voice than the panel's. */
const demoDisplay = Bricolage_Grotesque({
  variable: "--font-demo-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const demoBody = Plus_Jakarta_Sans({
  variable: "--font-demo-body",
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
    "A NOX OS organiza informações confirmadas de negócios locais em sites próprios, com prévia e revisão antes da publicação.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: siteUrl,
    siteName: "NOX OS",
    title: "NOX OS — Sites personalizados para negócios locais",
    description:
      "Sites para negócios locais, construídos a partir de informações confirmadas e revisados antes da publicação.",
  },
  twitter: {
    card: "summary_large_image",
    title: "NOX OS",
    description: "Sites para negócios locais, com briefing factual e revisão antes da publicação.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${display.variable} ${mono.variable} ${demoDisplay.variable} ${demoBody.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
