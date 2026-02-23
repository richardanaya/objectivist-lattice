import { Command, Option } from "commander";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadTags, validateTags } from "../core/tags.js";
import {
  loadAllNodes,
  createNodeFile,
  filenameToSlug,
  generateFilename,
} from "../core/node.js";
import { validateReductionLinks } from "../core/graph.js";
import {
  LEVELS,
  STATUSES,
  EXIT,
  type Level,
  type Status,
} from "../core/constants.js";
import {
  LatticeError,
  InvalidLevelError,
  InvalidStatusError,
  MissingReductionError,
} from "../util/errors.js";
import { resolveFormat, formatCreated } from "../util/format.js";
import { handleError } from "../util/cli-helpers.js";

export function makeAddCommand(): Command {
  const cmd = new Command("add");

  cmd
    .description("Create one atomic node with enforced validation")
    .requiredOption(
      "--level <level>",
      "percept | axiom | principle | application",
    )
    .requiredOption(
      "--title <title>",
      "Human-readable title (stored in YAML; filename auto-slugified)",
    )
    .requiredOption(
      '--proposition <text>',
      'Full propositional text. Use "-" to read from stdin.',
    )
    .option(
      "-r, --reduces-to <slug>",
      "Filename slug (no .md) of parent node. Repeatable.",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option("--tags <tags>", "Comma-separated tags from master list")
    .addOption(
      new Option("--status <status>", "Validation status")
        .choices([...STATUSES])
        .default("Tentative/Hypothesis"),
    )
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Creates one atomic node — a single proposition grounded in the lattice
  hierarchy. This is the primary write operation. Every call to "add"
  produces one Markdown file with YAML frontmatter in the correct level
  folder, validated before it touches disk.

  An "atomic node" means ONE testable claim stated in full propositional
  form: "X is Y because Z." Not a paragraph, not a feeling, not a vague
  observation. If you cannot state it as a single sentence with a truth
  value, it is not ready to be a node.

HOW TO CHOOSE THE LEVEL:
  percept — Did I directly observe or measure this?
    "The API returned a 500 error when called with null userId."
    "The user wrote 'I need dark mode' in issue #42."
    "The build took 14 minutes on commit abc123."
    Rule: If you saw it, heard it, measured it, or read it from a
    primary source, it is a percept. No interpretation. No inference.
    Percepts are EMPIRICAL BEDROCK — no --reduces-to links allowed.

  axiom — Is this a self-evident truth that cannot be further reduced?
    "Existence exists."
    "A thing is what it is (identity)."
    "Contradictions cannot exist in reality."
    "Software does what its code says, not what the developer intended."
    Rule: If denying it requires using it (stolen concept), it is an axiom.
    Axioms are PHILOSOPHICAL BEDROCK — no --reduces-to links allowed.
    An axiom is not proven by percepts; it is validated everywhere by them.
    The difference: percepts are empirical givens, axioms are conceptual givens.

  principle — Is this a general rule I induced from axioms and/or percepts?
    "Untested code will exhibit its defects in production."
    "Users abandon pages that take longer than 3 seconds to load."
    "Refactoring without tests creates more bugs than it fixes."
    Rule: If it is a pattern you identified, and it predicts future outcomes,
    it is a principle. Principles reduce_to axioms and/or percepts.

  application — Is this a concrete decision or action I will take?
    "Run the full test suite before every deploy. No exceptions."
    "Reject feature requests that contradict the core architecture."
    "Use server-side rendering for all public-facing pages."
    Rule: If it tells you WHAT TO DO and it follows from a principle,
    it is an application. Applications reduce_to principles.

REDUCTION RULES (enforced — violations produce exit 1):
  axiom       → reduces_to MUST be empty (axioms are philosophical bedrock)
  percept     → reduces_to MUST be empty (percepts are empirical bedrock)
  principle   → reduces_to MUST point to axiom(s) and/or percept(s)
  application → reduces_to MUST point to principle(s) (and/or axioms/percepts)
  Same-level reduction (principle → principle) → REJECTED
  Cross-bedrock reduction (axiom → percept or percept → axiom) → REJECTED
  Upward reduction (percept/axiom → principle) → REJECTED
  Cycle creation → REJECTED

FILENAME GENERATION:
  --title "Untested code will exhibit its defects" becomes:
  YYYYMMDDHHMMss-untested-code-will-exhibit-its-defects.md
  (timestamp with seconds, slug max 60 chars, full title in YAML)

FLAGS:
  --level         REQUIRED. percept | axiom | principle | application
  --title         REQUIRED. Full human-readable title.
  --proposition   REQUIRED. The claim in propositional form. Use "-" for stdin.
  -r, --reduces-to  Slug of parent node (repeatable). Required for non-percepts.
  --tags          Comma-separated tags from master list (e.g. "career,decisions")
  --status        "Integrated/Validated" or "Tentative/Hypothesis" (default: Tentative)

OUTPUT ON SUCCESS (exit 0):
  Default (TOON): structured { created, slug, node } object
  --json: same as JSON
  --table: "Node created: <filepath>"

ERROR EXAMPLES:
  "Error: Non-bedrock node (level: principle) requires at least one --reduces-to link. Only axioms and percepts may have empty reduces_to."
  "Error: Axiom nodes must not have --reduces-to links (they are irreducible bedrock)"
  "Error: Level mismatch: principle cannot reduce to principle"
  "Error: Target node not found: 20260303000000-nonexistent"
  "Error: Cycle detected: adding this link creates a loop"
  "Error: Rogue tag 'vibes' not in tags.json"

GOLDEN EXAMPLES:

  1. Record an observation (percept — no reduces_to, empirical bedrock):
     $ lattice add --level percept \\
         --title "API returns 500 on null userId" \\
         --proposition "Calling GET /users/null returns HTTP 500 with \\
         stack trace showing TypeError in UserService.findById." \\
         --tags "career,failure" \\
         --status "Integrated/Validated"

  2. State a self-evident truth (axiom — no reduces_to, philosophical bedrock):
     $ lattice add --level axiom \\
         --title "Code behaves according to what it contains" \\
         --proposition "Software is deterministic: a defect does not \\
         resolve itself. Code acts according to its actual state, not \\
         the developer's intent." \\
         --tags "career" \\
         --status "Integrated/Validated"

  3. Induce a principle from axioms and/or percepts:
     $ lattice add --level principle \\
         --title "Null inputs must be validated at API boundary" \\
         --proposition "Because code acts on what it contains (axiom), and \\
         because unvalidated null input crashed the user endpoint (percept), \\
         all API handlers must validate inputs before processing." \\
         -r 20260303091545-code-behaves-according-to-what-it-contains \\
         -r 20260303091500-api-returns-500-on-null-userid \\
         --tags "career,decisions"

  4. Deduce an action from a principle:
     $ lattice add --level application \\
         --title "Add zod validation to every API route handler" \\
         --proposition "Implement zod schema validation as the first line \\
         of every route handler. Reject requests that fail validation with \\
         400 and a structured error. No handler may touch req.params or \\
         req.body without prior validation." \\
         -r 20260303091620-null-inputs-must-be-validated-at-api-boundary \\
         --tags "career,habits,decisions" \\
         --status "Integrated/Validated"

  5. Pipe a long proposition from stdin:
     $ echo "After three incidents of production outages caused by ..." | \\
         lattice add --level percept \\
         --title "Three outages from config drift in Q1" \\
         --proposition - \\
         --tags "career,failure"
`,
    );

  cmd.action(async (opts) => {
    try {
      const parentOpts = cmd.parent?.opts() ?? {};
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      // Validate level
      const level = opts.level as Level;
      if (!LEVELS.includes(level)) {
        throw new InvalidLevelError(opts.level);
      }

      // Validate status
      const status = opts.status as Status;
      if (!STATUSES.includes(status)) {
        throw new InvalidStatusError(opts.status);
      }

      // Read proposition (from flag or stdin)
      let proposition = opts.proposition as string;
      if (proposition === "-") {
        proposition = await readStdin();
      }
      proposition = proposition.trim();
      if (!proposition) {
        throw new LatticeError(
          "Proposition cannot be empty",
          EXIT.BAD_INPUT,
        );
      }

      // Parse tags
      const tags: string[] = opts.tags
        ? (opts.tags as string)
            .split(",")
            .map((t: string) => t.trim().toLowerCase())
            .filter(Boolean)
        : [];

      // Validate tags against master list
      const masterTags = await loadTags(vaultPath);
      validateTags(tags, masterTags);

      // Parse reduces_to
      const reducesTo: string[] = (opts.reducesTo as string[]).map((r) =>
        r.replace(/\.md$/, "").trim(),
      );

      // Validate: only bedrock nodes (axiom, percept) may have empty reduces_to
      const isBedrock = level === "percept" || level === "axiom";
      if (!isBedrock && reducesTo.length === 0) {
        throw new MissingReductionError(level);
      }

      // Validate: bedrock nodes must not have reduces_to
      if (isBedrock && reducesTo.length > 0) {
        throw new LatticeError(
          `${level === "axiom" ? "Axiom" : "Percept"} nodes must not have --reduces-to links (they are irreducible bedrock)`,
          EXIT.BAD_INPUT,
        );
      }

      // Load existing nodes for validation
      const nodes = await loadAllNodes(vaultPath);

      // Generate the slug to check for duplicates and use in cycle detection
      const filename = generateFilename(opts.title);
      const newSlug = filenameToSlug(filename);

      // Validate reduction links (existence, level order, cycles)
      if (reducesTo.length > 0) {
        validateReductionLinks(newSlug, level, reducesTo, nodes);
      }

      // Create the node
      const result = await createNodeFile(
        vaultPath,
        {
          title: opts.title,
          level,
          reduces_to: reducesTo,
          status,
          tags,
          proposition,
        },
        new Set(nodes.keys()),
      );

      // Output
      const nodeObj = {
        title: opts.title,
        level,
        reduces_to: reducesTo,
        status,
        tags,
        proposition,
      };

      const output = formatCreated(
        result.slug,
        result.filePath,
        nodeObj,
        format,
      );
      process.stdout.write(output + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}

/**
 * Read from stdin with a 30-second timeout.
 * If stdin is a TTY (no pipe), warns on stderr and times out.
 */
async function readStdin(): Promise<string> {
  const TIMEOUT_MS = 30_000;

  if (process.stdin.isTTY) {
    process.stderr.write(
      "Warning: Reading proposition from stdin (TTY detected). " +
        "Pipe input or press Ctrl+D when done. Timeout: 30s.\n",
    );
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      process.stdin.destroy();
      reject(
        new LatticeError(
          "Stdin read timed out after 30 seconds. Pipe input or use --proposition with text directly.",
          EXIT.BAD_INPUT,
        ),
      );
    }, TIMEOUT_MS);

    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
