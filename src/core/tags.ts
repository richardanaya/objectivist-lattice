import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TAGS_JSON_FILE, TAGS_MD_FILE } from "./constants.js";
import { FilesystemError, RogueTagError } from "../util/errors.js";

/**
 * Load the master tag list from tags.json in the vault root.
 * Returns a sorted, deduplicated array of lowercase tag strings.
 */
export async function loadTags(vaultPath: string): Promise<string[]> {
  const filePath = join(vaultPath, TAGS_JSON_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new FilesystemError(
        `tags.json is malformed: expected a JSON array of strings`,
      );
    }
    return parsed.map((t: unknown) => String(t).toLowerCase().trim()).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FilesystemError(
        `tags.json not found at '${filePath}'. Is the vault initialized?`,
      );
    }
    throw err;
  }
}

/**
 * Save the master tag list to tags.json and regenerate Tags.md.
 */
export async function saveTags(
  vaultPath: string,
  tags: string[],
): Promise<void> {
  const sorted = [...new Set(tags.map((t) => t.toLowerCase().trim()))].sort();

  // Write tags.json (machine-readable source of truth)
  const jsonPath = join(vaultPath, TAGS_JSON_FILE);
  await writeFile(jsonPath, JSON.stringify(sorted, null, 2) + "\n", "utf-8");

  // Generate Tags.md (human-readable, for Obsidian browsing)
  const mdPath = join(vaultPath, TAGS_MD_FILE);
  const mdContent = [
    "# Master Tag List",
    "",
    `> Auto-generated from ${TAGS_JSON_FILE}. Do not edit directly.`,
    `> Use \`lattice tags add <tag> --reason <node>\` to add new tags.`,
    "",
    ...sorted.map((t) => `- ${t}`),
    "",
  ].join("\n");
  await writeFile(mdPath, mdContent, "utf-8");
}

/**
 * Validate that every tag in the given list exists in the master tag list.
 * Throws RogueTagError on the first mismatch.
 */
export function validateTags(
  tags: string[],
  masterTags: string[],
): void {
  const masterSet = new Set(masterTags);
  for (const tag of tags) {
    if (!masterSet.has(tag.toLowerCase().trim())) {
      throw new RogueTagError(tag);
    }
  }
}
