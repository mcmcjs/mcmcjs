/** Fill `<%= key %>` placeholders from `slots`; throws on an unknown placeholder. */
export function renderTemplate(template: string, slots: Record<string, string | number>): string {
  return template.replace(/<%=\s*([A-Za-z_][A-Za-z0-9_]*)\s*%>/g, (_match, key: string) => {
    if (!(key in slots)) {
      throw new Error(`renderTemplate: missing slot "${key}"`);
    }
    return String(slots[key]);
  });
}
