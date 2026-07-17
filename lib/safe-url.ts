export function normalizeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function requireHttpUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeHttpUrl(trimmed);
  if (!normalized) throw new Error('资料链接只支持 http:// 或 https:// 地址');
  return normalized;
}
