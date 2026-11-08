// Read-only theme access. Phase 1 never writes to the store.
import { gql } from "./client.ts";

export interface Theme {
  id: string;
  name: string;
  role: string;
  processing?: boolean;
  updatedAt?: string;
}

export async function listThemes(): Promise<Theme[]> {
  const data = await gql<{ themes: { nodes: Theme[] } }>(
    `query { themes(first: 50) { nodes { id name role processing updatedAt } } }`,
  );
  return data.themes.nodes;
}

export async function mainTheme(): Promise<Theme> {
  const main = (await listThemes()).find((t) => t.role === "MAIN");
  if (!main) throw new Error("No published (MAIN) theme found");
  return main;
}

export interface ThemeFile {
  filename: string;
  checksumMd5?: string;
  content: string | null; // null for binary files
}

/** Fetch theme files. Pass glob-ish patterns Shopify supports, e.g. "templates/*.json". */
export async function getThemeFiles(themeId: string, filenames: string[]): Promise<ThemeFile[]> {
  const out: ThemeFile[] = [];
  let after: string | null = null;
  do {
    const data: any = await gql(
      `query($id: ID!, $filenames: [String!], $after: String) {
        theme(id: $id) {
          files(first: 50, filenames: $filenames, after: $after) {
            nodes { filename checksumMd5 body { ... on OnlineStoreThemeFileBodyText { content } } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: themeId, filenames, after },
    );
    const files = data.theme?.files;
    if (!files) break;
    for (const n of files.nodes) out.push({ filename: n.filename, checksumMd5: n.checksumMd5, content: n.body?.content ?? null });
    after = files.pageInfo.hasNextPage ? files.pageInfo.endCursor : null;
  } while (after);
  return out;
}

export async function getThemeFile(themeId: string, filename: string): Promise<ThemeFile | null> {
  return (await getThemeFiles(themeId, [filename]))[0] ?? null;
}
