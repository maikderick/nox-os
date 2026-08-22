export function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function settingsForClient<T extends { enabledCategories: string }>(
  settings: T,
): Omit<T, "enabledCategories"> & { enabledCategories: string[] } {
  return {
    ...settings,
    enabledCategories: parseStringArray(settings.enabledCategories),
  };
}
