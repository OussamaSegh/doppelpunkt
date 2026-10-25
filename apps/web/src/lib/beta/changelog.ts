/** The newest "## …" section of CHANGELOG.md: its heading text and body. */
export function latestChangelogSection(md: string): { title: string; body: string } | undefined {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^##\s+/.test(l));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s+/.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return { title: lines[start]!.replace(/^##\s+/, '').trim(), body };
}
