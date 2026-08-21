import { test, expect } from "@playwright/test";

test("landing is public and professional", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Sites personalizados que transformam negócios locais",
  );
  await expect(page.getByRole("link", { name: /Solicitar análise/i })).toBeVisible();
});

test("private routes require auth", async ({ page }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/login/);
});

test("login and leads dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@noxos.local");
  await page.getByLabel("Senha").fill("noxos-admin-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/leads/);
  await expect(page.getByRole("heading", { name: "Prospecção" })).toBeVisible();
});
