import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TAGS_JSON_FILE } from "./constants.js";
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
 * Save the master tag list to tags.json.
 */
export async function saveTags(
  vaultPath: string,
  tags: string[],
): Promise<void> {
  const sorted = [...new Set(tags.map((t) => t.toLowerCase().trim()))].sort();
  const jsonPath = join(vaultPath, TAGS_JSON_FILE);
  await writeFile(jsonPath, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
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
