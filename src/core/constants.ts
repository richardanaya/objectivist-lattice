/**
 * Core constants for the Objectivist Knowledge Lattice.
 *
 * LEVEL HIERARCHY:
 *   axiom    (0) — Philosophical bedrock. Self-evident, irreducible.
 *                  Cannot be proven, only validated. No reduces_to.
 *   percept  (0) — Empirical bedrock. Directly observed fact.
 *                  Cannot be reduced further. No reduces_to.
 *   principle (1) — Induced general rule. Reduces to axioms and/or percepts.
 *   application (2) — Concrete action/decision. Reduces to principles
 *                     (and/or axioms/percepts).
 *
 * Axioms and percepts are co-equal bedrock at rank 0. Neither reduces to
 * the other — that would violate their irreducibility. Principles reduce
 * to one or both bedrock types. Applications reduce to principles.
 *
 * A node at rank N may only have reduces_to links pointing to nodes
 * at rank < N. Same-level or upward reduction is always rejected.
 */

export const LEVELS = ["percept", "axiom", "principle", "application"] as const;
export type Level = (typeof LEVELS)[number];

/**
 * Numeric rank for each level. Higher number = higher in the hierarchy.
 * Used for enforcing reduction direction: a node can only reduce to
 * nodes with a LOWER rank number.
 *
 * Axioms and percepts share rank 0 — both are irreducible bedrock.
 * Neither can reduce to the other.
 */
export const LEVEL_RANK: Record<Level, number> = {
  percept: 0,
  axiom: 0,
  principle: 1,
  application: 2,
};

/**
 * Maps each level to its filesystem folder name.
 * Folders are number-prefixed to enforce visual ordering in file browsers.
 */
export const LEVEL_FOLDERS: Record<Level, string> = {
  axiom: "01-Axioms",
  percept: "02-Percepts",
  principle: "03-Principles",
  application: "04-Applications",
};

/** All folder names that constitute the vault level structure. */
export const ALL_LEVEL_FOLDERS = Object.values(LEVEL_FOLDERS);

export const STATUSES = [
  "Integrated/Validated",
  "Tentative/Hypothesis",
] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Default master tag list for a rational adult or AI agent.
 * These are domain-neutral life categories — not philosophical jargon.
 * The tag list is stored in tags.json and enforced on every node.
 */
export const DEFAULT_TAGS: string[] = [
  "health",
  "fitness",
  "career",
  "money",
  "relationships",
  "family",
  "friendships",
  "learning",
  "productivity",
  "decisions",
  "habits",
  "emotions",
  "communication",
  "creativity",
  "goals",
  "risk",
  "failure",
  "success",
  "ethics",
  "self-knowledge",
];

/** Maximum character length for the slugified portion of a node filename. */
export const MAX_SLUG_LENGTH = 60;

/** Name of the machine-readable tag master list file in the vault root. */
export const TAGS_JSON_FILE = "tags.json";

/** Name of the human-readable tag list (generated from tags.json). */
export const TAGS_MD_FILE = "Tags.md";

/** Templates folder name. */
export const TEMPLATES_FOLDER = "Templates";

/** Template file for new nodes. */
export const NODE_TEMPLATE_FILE = "New-Node.md";

/** Sentinel file that marks a directory as an initialized lattice vault. */
export const VAULT_MARKER = ".lattice";

/** Exit codes for the CLI. */
export const EXIT = {
  SUCCESS: 0,
  VALIDATION_ERROR: 1,
  FILESYSTEM_ERROR: 2,
  BAD_INPUT: 3,
} as const;
