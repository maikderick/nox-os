import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value);
}

export function opportunityBand(score: number): "alta" | "media" | "baixa" {
  if (score >= 70) return "alta";
  if (score >= 40) return "media";
  return "baixa";
}
