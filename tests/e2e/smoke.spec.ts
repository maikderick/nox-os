import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Defina E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD ou ADMIN_EMAIL/ADMIN_PASSWORD para executar o E2E autenticado.",
    );
  }
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/leads/);
  return adminEmail;
}

test("landing is public and professional", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Um site próprio para o seu negócio local ser encontrado e contatado.",
  );
  await expect(page.getByRole("link", { name: /Entender o processo/i })).toBeVisible();
  await expect(page.getByText("O canal de contato ainda não foi configurado.")).toBeVisible();
});

test("landing keeps its navigation available on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await page.getByText("Menu", { exact: true }).click();
  const mobileNav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Acessar painel" })).toBeVisible();
});

test("private routes require auth", async ({ page }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/login/);
});

test("login and leads dashboard", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/leads/);
  await expect(page.getByRole("heading", { name: "Prospecção" })).toBeVisible();
});

test("briefing pronto oferece geração e a revisão pronta abre como site", async ({ page }) => {
  const prisma = new PrismaClient();
  let projectId: string | null = null;
  let clientId: string | null = null;

  try {
    const adminEmail = await loginAsAdmin(page);
    const user = await prisma.user.findUnique({
      where: { email: adminEmail },
      include: { memberships: { where: { active: true }, take: 1 } },
    });
    const membership = user?.memberships[0];
    if (!user || !membership) throw new Error("O administrador E2E não possui organização ativa.");

    const suffix = Date.now().toString(36);
    const client = await prisma.client.create({
      data: {
        organizationId: membership.organizationId,
        name: "Cliente E2E",
        slug: `cliente-e2e-${suffix}`,
      },
    });
    clientId = client.id;

    const project = await prisma.siteProject.create({
      data: {
        organizationId: membership.organizationId,
        clientId: client.id,
        name: "Site E2E confirmado",
        slug: `site-e2e-${suffix}`,
        sector: "Serviços locais",
        status: "BRIEFING_PRONTO",
        createdById: user.id,
      },
    });
    projectId = project.id;

    const confirmedAt = new Date().toISOString();
    const fact = (value: string) => ({ value, source: "OPERADOR", confirmedAt });
    const brief = await prisma.siteBriefVersion.create({
      data: {
        siteProjectId: project.id,
        version: 1,
        factsHash: `e2e-${suffix}`,
        createdById: user.id,
        contentJson: JSON.stringify({
          schemaVersion: 2,
          businessName: fact("Site E2E confirmado"),
          sector: fact("Serviços locais"),
          city: fact("Fortaleza"),
          objective: fact("Apresentar informações confirmadas sobre o negócio."),
          audience: fact("Pessoas que procuram informações objetivas antes do contato."),
          positioning: fact("Informações organizadas para facilitar uma decisão consciente."),
          differentiators: [],
          desiredSections: ["Início", "Serviços", "Contato"],
          visualDirection: fact("Layout escuro, legível e com contraste elevado."),
          notes: null,
          services: [
            {
              id: "atendimento",
              name: fact("Atendimento"),
              summary: fact("Informações confirmadas sobre o atendimento disponível."),
              body: [fact("Consulte os canais informados para confirmar os detalhes.")],
              relatedIds: [],
              featured: true,
            },
          ],
          publicContact: {
            phone: null,
            whatsapp: null,
            email: null,
            address: null,
            coordinates: null,
            openingHours: null,
            socialLinks: [],
          },
          metaDescription: fact("Informações confirmadas sobre o negócio e seus serviços."),
        }),
      },
    });
    await prisma.siteProject.update({
      where: { id: project.id },
      data: { currentBriefVersionId: brief.id },
    });

    await page.goto("/projetos");
    const card = page.getByRole("article").filter({ hasText: "Site E2E confirmado" });
    await expect(card.getByRole("link", { name: /Preparar e gerar/i })).toBeVisible();
    await card.getByRole("link", { name: /Preparar e gerar/i }).click();
    await expect(page.getByRole("button", { name: "Preparar e gerar site" })).toBeVisible();

    await prisma.siteProject.update({
      where: { id: project.id },
      data: { status: "PREVIA_PRONTA" },
    });
    await page.context().clearCookies();
    await page.goto(`/sites/${project.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Site E2E confirmado" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navegação do site" })).toBeVisible();
  } finally {
    if (projectId) await prisma.siteProject.deleteMany({ where: { id: projectId } });
    if (clientId) await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();
  }
});
