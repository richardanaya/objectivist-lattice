import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import YAML from "yaml";
import {
  LEVELS,
  LEVEL_FOLDERS,
  STATUSES,
  MAX_SLUG_LENGTH,
  type Level,
  type Status,
} from "./constants.js";
import {
  InvalidLevelError,
  InvalidStatusError,
  FilesystemError,
  DuplicateSlugError,
  LatticeError,
} from "../util/errors.js";
import { EXIT } from "./constants.js";

// ─── Types ───────────────────────────────────────────────────────────

/** Parsed representation of a lattice node. */
export interface LatticeNode {
  /** Filename without .md extension — the canonical ID for this node. */
  slug: string;
  /** Full human-readable title (stored in YAML, not truncated). */
  title: string;
  /** Reduction level in the hierarchy. */
  level: Level;
  /** Slugs (without .md) of nodes this reduces to. Empty for percepts. */
  reduces_to: string[];
  /** Validation status. */
  status: Status;
  /** Tags from the master list. */
  tags: string[];
  /** Full proposition text (body of the markdown file). */
  proposition: string;
  /** Absolute path to the file on disk. */
  filePath: string;
  /** Node creation time (stored in YAML frontmatter, not filesystem). */
  created: Date;
}

/**
 * YAML frontmatter shape as stored on disk.
 * `created` is stored as ISO 8601 string to avoid Linux birthtime unreliability.
 */
interface NodeFrontmatter {
  title: string;
  level: string;
  reduces_to: string | string[];
  status: string;
  tags: string | string[];
  created?: string;
}

// ─── Slug generation ─────────────────────────────────────────────────

/**
 * Generate a slug from a title string.
 * Rules: lowercase, spaces/underscores → hyphens, strip non-alphanumeric
 * except hyphens, collapse multiple hyphens, trim hyphens from ends,
 * truncate to MAX_SLUG_LENGTH characters.
 *
 * If the slug is empty after processing (e.g. all-unicode title),
 * returns a random 8-char hex string as fallback.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);

  if (slug.length === 0) {
    // Fallback for titles with no latin characters (unicode, emoji, etc.)
    return Math.random().toString(16).slice(2, 10);
  }

  return slug;
}

/**
 * Generate the full filename (without path) for a node.
 * Format: YYYYMMDDHHMMss-slugified-title.md
 *
 * Includes seconds to reduce collision risk when adding nodes rapidly.
 */
export function generateFilename(title: string, date?: Date): string {
  const d = date ?? new Date();
  const timestamp = [
    d.getFullYear().toString(),
    (d.getMonth() + 1).toString().padStart(2, "0"),
    d.getDate().toString().padStart(2, "0"),
    d.getHours().toString().padStart(2, "0"),
    d.getMinutes().toString().padStart(2, "0"),
    d.getSeconds().toString().padStart(2, "0"),
  ].join("");

  const slug = slugify(title);
  return `${timestamp}-${slug}.md`;
}

/**
 * Extract the slug (filename without .md) from a filename.
 */
export function filenameToSlug(filename: string): string {
  return filename.replace(/\.md$/, "");
}

// ─── Frontmatter helpers ─────────────────────────────────────────────

/**
 * Normalize a reduces_to value from YAML.
 * Handles: bare string (not wrapped in array), strings with .md extension,
 * [[wiki-link]] format, and proper arrays.
 * Always returns a clean string[] of slugs without .md.
 */
function normalizeReducesTo(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];

  // Bare string (someone wrote `reduces_to: some-slug` instead of array)
  if (typeof raw === "string") {
    const cleaned = cleanSlugRef(raw);
    return cleaned ? [cleaned] : [];
  }

  if (!Array.isArray(raw)) return [];

  return raw
    .map((r) => cleanSlugRef(String(r)))
    .filter((s): s is string => s.length > 0);
}

/**
 * Clean a single slug reference: strip .md, strip [[]] wiki-link wrappers, trim.
 */
function cleanSlugRef(s: string): string {
  return s
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/\.md$/, "");
}

/**
 * Normalize tags from YAML. Handles bare string and array forms.
 */
function normalizeTags(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];

  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  if (!Array.isArray(raw)) return [];

  return raw
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean);
}

// ─── Parsing ─────────────────────────────────────────────────────────

/**
 * Parse a single markdown file into a LatticeNode.
 * Extracts YAML frontmatter (between --- delimiters) and the body.
 *
 * Handles both LF and CRLF line endings.
 */
export async function parseNodeFile(filePath: string): Promise<LatticeNode> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new FilesystemError(
      `Cannot read node file '${filePath}': ${(err as Error).message}`,
    );
  }

  // Normalize CRLF → LF before parsing
  raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new FilesystemError(
      `Malformed node file '${filePath}': missing YAML frontmatter (--- delimiters)`,
    );
  }

  let frontmatter: NodeFrontmatter;
  try {
    const parsed = YAML.parse(fmMatch[1]);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("YAML parsed to non-object");
    }
    frontmatter = parsed as NodeFrontmatter;
  } catch (err) {
    throw new FilesystemError(
      `Malformed YAML in '${filePath}': ${(err as Error).message}`,
    );
  }

  const body = fmMatch[2].trim();
  // Extract proposition from body (strip **Proposition:** prefix if present)
  const proposition = body
    .replace(/^\*\*Proposition:\*\*\s*/i, "")
    .trim();

  const filename = basename(filePath);
  const slug = filenameToSlug(filename);

  // Validate level
  const levelStr = String(frontmatter.level ?? "").trim();
  if (!LEVELS.includes(levelStr as Level)) {
    throw new InvalidLevelError(levelStr);
  }
  const level = levelStr as Level;

  // Validate status.
  // Bedrock nodes (axiom, percept) are always Integrated/Validated regardless
  // of what is written on disk — their presence in the vault is their validation.
  const isBedrock = level === "percept" || level === "axiom";
  let status: Status;
  if (isBedrock) {
    status = "Integrated/Validated";
  } else {
    const statusStr = String(frontmatter.status ?? "").trim();
    if (!STATUSES.includes(statusStr as Status)) {
      throw new InvalidStatusError(statusStr);
    }
    status = statusStr as Status;
  }

  // Parse created timestamp from YAML (reliable across all platforms)
  let created: Date;
  if (frontmatter.created) {
    const parsed = new Date(frontmatter.created);
    created = isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    // Legacy file without created field — use current time
    created = new Date();
  }

  return {
    slug,
    title: frontmatter.title ? String(frontmatter.title) : slug,
    level,
    reduces_to: normalizeReducesTo(frontmatter.reduces_to),
    status,
    tags: normalizeTags(frontmatter.tags),
    proposition,
    filePath,
    created,
  };
}

// ─── Loading all nodes ───────────────────────────────────────────────

/**
 * Load all lattice nodes from all level folders in the vault.
 * Returns a Map keyed by slug for O(1) lookup.
 */
export async function loadAllNodes(
  vaultPath: string,
): Promise<Map<string, LatticeNode>> {
  const nodes = new Map<string, LatticeNode>();

  for (const level of LEVELS) {
    const folderPath = join(vaultPath, LEVEL_FOLDERS[level]);
    let entries: string[];
    try {
      entries = await readdir(folderPath);
    } catch {
      // Folder might not exist or be empty — skip
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = join(folderPath, entry);
      try {
        const node = await parseNodeFile(filePath);
        nodes.set(node.slug, node);
      } catch (err) {
        // Log parse errors but don't crash the whole load
        process.stderr.write(
          `Warning: skipping malformed node '${entry}': ${(err as Error).message}\n`,
        );
      }
    }
  }

  return nodes;
}

// ─── Creating nodes ──────────────────────────────────────────────────

export interface CreateNodeOptions {
  title: string;
  level: Level;
  reduces_to: string[];
  status: Status;
  tags: string[];
  proposition: string;
}

/**
 * YAML frontmatter shape as written to disk (includes created).
 */
interface NodeFrontmatterOnDisk {
  title: string;
  level: string;
  reduces_to: string[];
  status: string;
  tags: string[];
  created: string;
}

/**
 * Create a new node file on disk. Returns the created node's slug and filepath.
 * Does NOT validate reduction chains or tags — caller must do that first.
 *
 * Includes `created` ISO timestamp in YAML for reliable cross-platform dating.
 * Uses writeFile with flag 'wx' (exclusive create) to prevent race-condition overwrites.
 */
export async function createNodeFile(
  vaultPath: string,
  opts: CreateNodeOptions,
  existingSlugs?: Set<string>,
): Promise<{ slug: string; filePath: string }> {
  const now = new Date();
  const filename = generateFilename(opts.title, now);
  const slug = filenameToSlug(filename);

  // Check for duplicate slug against known nodes
  if (existingSlugs?.has(slug)) {
    throw new DuplicateSlugError(slug);
  }

  // Validate slug is non-empty (after timestamp prefix)
  const slugPart = slug.replace(/^\d+-/, "");
  if (!slugPart) {
    throw new LatticeError(
      `Title '${opts.title}' produces an empty slug. Use Latin characters in the title.`,
      EXIT.BAD_INPUT,
    );
  }

  const folder = LEVEL_FOLDERS[opts.level];
  const filePath = join(vaultPath, folder, filename);

  const frontmatter: NodeFrontmatterOnDisk = {
    title: opts.title,
    level: opts.level,
    reduces_to: opts.reduces_to,
    status: opts.status,
    tags: opts.tags,
    created: now.toISOString(),
  };

  const yamlStr = YAML.stringify(frontmatter, {
    lineWidth: 0,
    defaultKeyType: "PLAIN",
    defaultStringType: "PLAIN",
  }).trim();

  const content = [
    "---",
    yamlStr,
    "---",
    "",
    `**Proposition:** ${opts.proposition}`,
    "",
  ].join("\n");

  try {
    // 'wx' flag: create exclusively — fails if file already exists (race protection)
    await writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new DuplicateSlugError(slug);
    }
    throw new FilesystemError(
      `Cannot write node file '${filePath}': ${(err as Error).message}`,
    );
  }

  return { slug, filePath };
}

/**
 * Update specific fields of an existing node file on disk.
 * Reads the file, modifies the YAML frontmatter, and writes it back.
 * Only updates fields that are explicitly provided (non-undefined).
 */
export async function updateNodeFile(
  node: LatticeNode,
  updates: {
    status?: Status;
    tags?: string[];
    reduces_to?: string[];
    title?: string;
  },
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(node.filePath, "utf-8");
  } catch (err) {
    throw new FilesystemError(
      `Cannot read node file '${node.filePath}': ${(err as Error).message}`,
    );
  }

  // Normalize line endings
  raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new FilesystemError(
      `Malformed node file '${node.filePath}': missing YAML frontmatter`,
    );
  }

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = YAML.parse(fmMatch[1]) as Record<string, unknown>;
  } catch (err) {
    throw new FilesystemError(
      `Malformed YAML in '${node.filePath}': ${(err as Error).message}`,
    );
  }

  // Apply updates
  if (updates.status !== undefined) frontmatter.status = updates.status;
  if (updates.tags !== undefined) frontmatter.tags = updates.tags;
  if (updates.reduces_to !== undefined) frontmatter.reduces_to = updates.reduces_to;
  if (updates.title !== undefined) frontmatter.title = updates.title;

  const yamlStr = YAML.stringify(frontmatter, {
    lineWidth: 0,
    defaultKeyType: "PLAIN",
    defaultStringType: "PLAIN",
  }).trim();

  const body = fmMatch[2];
  const content = `---\n${yamlStr}\n---\n${body}`;

  try {
    await writeFile(node.filePath, content, "utf-8");
  } catch (err) {
    throw new FilesystemError(
      `Cannot write node file '${node.filePath}': ${(err as Error).message}`,
    );
  }
}

/**
 * Find a node by slug or partial slug match.
 *
 * Match priority:
 *   1. Exact slug match
 *   2. Single prefix match on slug
 *   3. Single substring match on slug
 *   4. Single substring match on title
 *
 * If a step produces multiple matches, it is skipped (ambiguous).
 * Returns { slug, ambiguous: false } on unique match,
 * { slug: null, ambiguous: true, candidates: [...] } on ambiguous,
 * { slug: null, ambiguous: false } on no match.
 */
export function findNodeBySlug(
  query: string,
  nodes: Map<string, LatticeNode>,
): { slug: string | null; ambiguous: boolean; candidates: string[] } {
  const q = query.toLowerCase().trim();

  // Exact match
  if (nodes.has(q)) return { slug: q, ambiguous: false, candidates: [] };

  // Strip .md if provided
  const qNoMd = q.replace(/\.md$/, "");
  if (nodes.has(qNoMd)) return { slug: qNoMd, ambiguous: false, candidates: [] };

  // Prefix match
  const prefixMatches: string[] = [];
  for (const slug of nodes.keys()) {
    if (slug.toLowerCase().startsWith(qNoMd)) {
      prefixMatches.push(slug);
    }
  }
  if (prefixMatches.length === 1) return { slug: prefixMatches[0], ambiguous: false, candidates: [] };

  // Substring match on slug
  const slugSubMatches: string[] = [];
  for (const slug of nodes.keys()) {
    if (slug.toLowerCase().includes(qNoMd)) {
      slugSubMatches.push(slug);
    }
  }
  if (slugSubMatches.length === 1) return { slug: slugSubMatches[0], ambiguous: false, candidates: [] };

  // Substring match on title
  const titleSubMatches: string[] = [];
  for (const [slug, node] of nodes) {
    if (node.title.toLowerCase().includes(qNoMd)) {
      titleSubMatches.push(slug);
    }
  }
  if (titleSubMatches.length === 1) return { slug: titleSubMatches[0], ambiguous: false, candidates: [] };

  // Ambiguous: multiple matches found
  const allCandidates = [
    ...new Set([...prefixMatches, ...slugSubMatches, ...titleSubMatches]),
  ];
  if (allCandidates.length > 0) {
    return { slug: null, ambiguous: true, candidates: allCandidates.slice(0, 10) };
  }

  // No match
  return { slug: null, ambiguous: false, candidates: [] };
}
