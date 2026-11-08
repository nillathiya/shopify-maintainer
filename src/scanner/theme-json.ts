// Shopify OS 2.0 JSON templates (templates/*.json, sections/*-group.json) often start
// with an auto-generated /* ... */ banner. Parse while keeping that header for write-back.

export interface ParsedThemeJson {
  header: string;
  doc: any;
}

export function parseThemeJson(raw: string): ParsedThemeJson {
  const m = raw.match(/^\s*(\/\*[\s\S]*?\*\/\s*)/);
  const header = m ? m[1] : "";
  const body = raw.slice(header.length);
  return { header, doc: JSON.parse(body) };
}

export function stringifyThemeJson(p: ParsedThemeJson): string {
  return p.header + JSON.stringify(p.doc, null, 2);
}
