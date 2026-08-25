/**
 * The rules a JSON Schema cannot express.
 *
 * The site-kit validates a snapshot with Zod, and its cross-field rules live in
 * `superRefine` blocks — slug uniqueness, references that must resolve, calls to
 * action that need a confirmed channel. None of that survives the export to
 * JSON Schema, so a consumer that validated only against the schema would
 * approve snapshots the real parser rejects.
 *
 * This module closes that gap on the NOX OS side. It is pinned by a contract
 * test that runs every negative fixture the kit publishes in
 * `contracts/site-kit/invalid/`: each one has to be refused here, at the same
 * path the kit reports.
 */

export type SnapshotIssue = {
  /** Dotted path, matching what the site-kit parser reports. */
  path: string;
  message: string;
};

const INTERNAL_PATH_PATTERN = /^\/(?![/\\])[A-Za-z0-9\-._~/]*$/;

/** Mirrors `isInternalPath` in the site-kit: exactly one leading slash, no backslash. */
export function isInternalPath(value: unknown): boolean {
  return typeof value === "string" && INTERNAL_PATH_PATTERN.test(value) && !value.includes("\\");
}

export function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || !/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function checkAsset(asset: unknown, base: string, issues: SnapshotIssue[]): void {
  if (!isRecord(asset)) return;

  const src = asset.src;
  if (!isInternalPath(src) && !isHttpsUrl(src)) {
    issues.push({
      path: `${base}.src`,
      message: "Use um caminho interno com uma única barra inicial ou um endereço https",
    });
  }

  if (asset.license === "LICENCIADA" && !asset.credit) {
    issues.push({ path: `${base}.credit`, message: "Imagem licenciada exige crédito do autor" });
  }

  if (asset.source === "BANCO_DE_IMAGENS" && asset.license !== "LICENCIADA") {
    issues.push({
      path: `${base}.license`,
      message: "Imagem de banco precisa ser marcada como licenciada",
    });
  }

  if (asset.creditUrl !== null && asset.creditUrl !== undefined && !isHttpsUrl(asset.creditUrl)) {
    issues.push({ path: `${base}.creditUrl`, message: "Informe um endereço https válido" });
  }
}

/**
 * Every page a snapshot produces.
 *
 * Mirrors `siteRoutes` in the site-kit. The information architecture belongs to
 * the contract rather than to one template, because whoever writes a call to
 * action has to know which destinations are real before writing it.
 */
export function snapshotRoutes(content: Record<string, unknown>): string[] {
  const services = asArray(content.services);
  const gallery = asArray(content.gallery);

  const routes = ["/", "/sobre", "/contato", "/privacidade"];
  if (services.length > 0) {
    routes.push("/servicos");
    for (const service of services) {
      if (isRecord(service) && typeof service.slug === "string") {
        routes.push(`/servicos/${service.slug}`);
      }
    }
  }
  if (gallery.length > 0) routes.push("/galeria");
  return routes;
}

export function validateSnapshotInvariants(content: unknown): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  if (!isRecord(content)) return [{ path: "(raiz)", message: "Snapshot precisa ser um objeto" }];

  const contact = isRecord(content.contact) ? content.contact : {};
  const seo = isRecord(content.seo) ? content.seo : {};
  const analytics = isRecord(content.analytics) ? content.analytics : {};

  // --- Serviços -----------------------------------------------------------
  const services = asArray(content.services);
  const slugs = new Set<string>();

  services.forEach((service, index) => {
    if (!isRecord(service)) return;
    const slug = typeof service.slug === "string" ? service.slug : "";
    if (slugs.has(slug)) {
      issues.push({ path: `services.${index}.slug`, message: `Slug repetido: ${slug}` });
    }
    slugs.add(slug);
  });

  services.forEach((service, index) => {
    if (!isRecord(service)) return;
    asArray(service.relatedSlugs).forEach((related, relatedIndex) => {
      const path = `services.${index}.relatedSlugs.${relatedIndex}`;
      if (related === service.slug) {
        issues.push({ path, message: "Um serviço não se relaciona consigo mesmo" });
        return;
      }
      if (typeof related !== "string" || !slugs.has(related)) {
        issues.push({ path, message: `Serviço relacionado inexistente: ${String(related)}` });
      }
    });

    if (isRecord(service.image)) checkAsset(service.image, `services.${index}.image`, issues);
  });

  // --- Chamadas de ação ---------------------------------------------------
  const routes = new Set(snapshotRoutes(content));
  asArray(content.callsToAction).forEach((cta, index) => {
    if (!isRecord(cta)) return;
    const kind = cta.kind;

    const missingChannel =
      (kind === "WHATSAPP" && !contact.whatsapp) ||
      (kind === "TELEFONE" && !contact.phone) ||
      (kind === "EMAIL" && !contact.email);

    if (missingChannel) {
      issues.push({
        path: `callsToAction.${index}.kind`,
        message: `Sem dado confirmado para a ação ${String(kind)}`,
      });
    }

    if (kind === "INTERNO") {
      if (!cta.target) {
        issues.push({
          path: `callsToAction.${index}.target`,
          message: "Uma ação interna precisa de um caminho de destino",
        });
      } else if (!isInternalPath(cta.target)) {
        issues.push({
          path: `callsToAction.${index}.target`,
          message: "Informe um caminho interno começando com uma única barra",
        });
      } else if (!routes.has(cta.target as string)) {
        // A well-formed path is still a 404 when the snapshot has no such page.
        issues.push({
          path: `callsToAction.${index}.target`,
          message: `Rota inexistente neste snapshot: ${String(cta.target)}`,
        });
      }
    } else if (cta.target) {
      issues.push({
        path: `callsToAction.${index}.target`,
        message: "Ações de contato usam o dado confirmado, não um destino livre",
      });
    }
  });

  // --- Imagens ------------------------------------------------------------
  asArray(content.gallery).forEach((asset, index) => {
    checkAsset(asset, `gallery.${index}`, issues);
  });
  if (isRecord(content.business) && isRecord(content.business.logo)) {
    checkAsset(content.business.logo, "business.logo", issues);
  }
  if (isRecord(seo.ogImage)) checkAsset(seo.ogImage, "seo.ogImage", issues);

  // --- Dados estruturados -------------------------------------------------
  if (seo.localBusinessType && !contact.address) {
    issues.push({
      path: "seo.localBusinessType",
      message: "LocalBusiness exige endereço confirmado",
    });
  }

  // --- Medição ------------------------------------------------------------
  if (analytics.provider === "ga4" && !analytics.measurementId) {
    issues.push({ path: "analytics.measurementId", message: "O GA4 exige um measurementId" });
  }
  if (analytics.provider === "none" && analytics.measurementId) {
    issues.push({
      path: "analytics.measurementId",
      message: "Sem provedor ativo, não guarde um measurementId",
    });
  }

  // --- Horários -----------------------------------------------------------
  if (isRecord(contact.openingHours)) {
    asArray(contact.openingHours.value).forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const opens = String(entry.opens ?? "");
      const closes = String(entry.closes ?? "");
      if (opens >= closes) {
        issues.push({
          path: `contact.openingHours.value.${index}`,
          message: "O horário de abertura precisa ser anterior ao de fechamento",
        });
      }
    });
  }

  return issues;
}
