import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";
import {
  ALL_LEVEL_FOLDERS,
  DEFAULT_TAGS,
  NODE_TEMPLATE_FILE,
  TEMPLATES_FOLDER,
  VAULT_MARKER,
} from "./constants.js";
import { saveTags } from "./tags.js";
import { VaultNotInitializedError, FilesystemError } from "../util/errors.js";

/**
 * Resolve the vault path. If the given path is relative, resolve against cwd.
 */
export function resolveVaultPath(vaultOpt: string): string {
  return resolve(vaultOpt);
}

/**
 * Check whether a directory is an initialized lattice vault.
 * Looks for the .lattice marker file.
 */
export async function isVaultInitialized(vaultPath: string): Promise<boolean> {
  try {
    await access(join(vaultPath, VAULT_MARKER));
    return true;
  } catch {
    return false;
  }
}

/**
 * Require the vault to be initialized. Throws VaultNotInitializedError if not.
 * Call this at the top of every command except `init`.
 */
export async function requireVault(vaultPath: string): Promise<void> {
  const initialized = await isVaultInitialized(vaultPath);
  if (!initialized) {
    throw new VaultNotInitializedError(vaultPath);
  }
}

/**
 * Initialize a new lattice vault at the given path.
 * Creates: level folders, tags.json, Templates/New-Node.md, .lattice marker.
 * Idempotent: creates only what is missing, never overwrites existing files.
 */
export async function initializeVault(vaultPath: string): Promise<void> {
  // Ensure root exists
  try {
    await mkdir(vaultPath, { recursive: true });
  } catch (err) {
    throw new FilesystemError(
      `Cannot create vault directory at '${vaultPath}': ${(err as Error).message}`,
    );
  }

  // Create level folders
  for (const folder of ALL_LEVEL_FOLDERS) {
    await mkdir(join(vaultPath, folder), { recursive: true });
  }

  // Create Templates folder
  const templatesDir = join(vaultPath, TEMPLATES_FOLDER);
  await mkdir(templatesDir, { recursive: true });

  // Write template file (only if missing)
  const templatePath = join(templatesDir, NODE_TEMPLATE_FILE);
  if (!(await fileExists(templatePath))) {
    const templateContent = [
      "---",
      'title: ""',
      'level: ""',
      "reduces_to: []",
      "status: Tentative/Hypothesis",
      "tags: []",
      'created: ""',
      "---",
      "",
      "**Proposition:** ",
      "",
    ].join("\n");
    await writeFile(templatePath, templateContent, "utf-8");
  }

  // Write tags.json (only if missing)
  const tagsJsonPath = join(vaultPath, "tags.json");
  if (!(await fileExists(tagsJsonPath))) {
    await saveTags(vaultPath, DEFAULT_TAGS);
  }

  // Write .lattice marker
  const markerPath = join(vaultPath, VAULT_MARKER);
  if (!(await fileExists(markerPath))) {
    await writeFile(
      markerPath,
      JSON.stringify({ version: "1.0.0", created: new Date().toISOString() }) +
        "\n",
      "utf-8",
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
