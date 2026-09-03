import { test, expect } from "@playwright/test";

test("landing is public and professional", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Sites profissionais para negócios locais",
  );
  await expect(page.getByRole("link", { name: /Falar (no WhatsApp|com a equipe)/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Acessar painel/i })).toBeVisible();
});

test("private routes require auth", async ({ page }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/login/);
});

test("login and leads dashboard", async ({ page }) => {
  await page.goto("/login");
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error("Defina E2E_ADMIN_EMAIL e E2E_ADMIN_PASSWORD para executar o E2E autenticado.");
  }
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/leads/);
  await expect(page.getByRole("heading", { name: "Prospecção" })).toBeVisible();
});
