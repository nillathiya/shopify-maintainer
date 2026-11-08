// Deeper, read-only scan through the Admin API (only when the operator connects admin access):
// reads the live theme's JSON templates to find exactly which texts/images are editable,
// and finds images that are built into the theme's code.
import { mainTheme, getThemeFiles } from "../shopify/themes.ts";
import { buildThemeMap, SCANNED_FILE_PATTERNS, type ThemeMap } from "./theme-scan.ts";
import type { AdminScan, ScannedPage } from "./types.ts";
import { fileName } from "./storefront.ts";

export async function adminScan(pages: ScannedPage[]): Promise<{ admin: AdminScan; map: ThemeMap }> {
  const theme = await mainTheme();
  const jsonFiles = await getThemeFiles(theme.id, SCANNED_FILE_PATTERNS);
  const liquid = await getThemeFiles(theme.id, ["sections/*.liquid", "snippets/*.liquid", "layout/*.liquid"]);
  const map = buildThemeMap(jsonFiles);

  // Attach editable slots to the sections we saw on the storefront.
  for (const page of pages) {
    for (const s of page.sections) {
      const exact = map.slots.filter((x) => x.sectionId === s.key && x.file === s.groupFile);
      const loose = exact.length ? exact : map.slots.filter((x) => x.sectionId === s.key && x.file.startsWith(s.groupFile?.replace(/\.json$/, "") ?? "\0"));
      if (loose.length) {
        s.groupFile = loose[0].file;
        s.editable = loose.map((x) => ({ id: x.id, kind: x.kind, setting: x.setting, value: x.value, blockId: x.blockId }));
      }
    }
  }

  // Which theme-file images are referenced from code (and therefore not swappable in the theme editor)?
  const themeImages = new Set<string>();
  for (const p of pages) for (const s of p.sections) for (const i of s.images) if (i.source === "theme-file") themeImages.add(fileName(i.src));
  const hardcoded: Record<string, string[]> = {};
  for (const img of themeImages) {
    const stem = img.replace(/\.[a-z0-9]+$/i, "");
    const users = [...liquid, ...jsonFiles].filter((f) => f.content && (f.content.includes(img) || f.content.includes(`'${stem}`) || f.content.includes(`"${stem}`))).map((f) => f.filename);
    hardcoded[img] = users;
  }

  return {
    map,
    admin: {
      themeId: theme.id,
      themeName: theme.name,
      fileCount: jsonFiles.length + liquid.length,
      templates: jsonFiles.filter((f) => f.filename.startsWith("templates/")).map((f) => f.filename),
      editableSlotCount: map.slots.length,
      palette: map.palette,
      fonts: map.fonts,
      hardcodedImages: hardcoded,
    },
  };
}
