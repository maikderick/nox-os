import { z } from "zod";

/**
 * Text primitives shared by every schema in the app.
 *
 * They live outside any one domain so the site factory does not have to import
 * from the legacy demo-landing module to get a trimmed, control-character-free
 * string.
 */
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Preencha este campo")
    .max(max, `Use no máximo ${max} caracteres`)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), {
      message: "O texto contém caracteres de controle inválidos",
    });

export const optionalPlainText = (max: number) => plainText(max).optional();
export const nullablePlainText = (max: number) => plainText(max).nullable();

/** An https URL with no embedded credentials. */
export function isSafeHttpsUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(isSafeHttpsUrl, { message: "Informe um endereço https válido" });
