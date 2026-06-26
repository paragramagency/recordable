// Tiny, dependency-free helpers shared across layers.

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function truncate(text: string, max = 40): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}
