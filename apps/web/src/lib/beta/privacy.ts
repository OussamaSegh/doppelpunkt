/** The learner-facing part of docs/PRIVACY.md: without its h1 and the operator notes at the end. */
export function learnerPrivacyText(md: string): string {
  const text = md.replace(/\r\n/g, '\n');
  const cut = text.search(/^(?:---\s*\n+)?## Notes for the operator/m);
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/^# .*\n/, '').trim();
}
