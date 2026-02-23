import { Command } from "commander";
import { makeInitCommand } from "./commands/init.js";
import { makeAddCommand } from "./commands/add.js";
import { makeQueryCommand } from "./commands/query.js";
import { makeValidateCommand } from "./commands/validate.js";
import { makeUpdateCommand } from "./commands/update.js";
import { makeDeleteCommand } from "./commands/delete.js";
import { makeTagsCommand } from "./commands/tags.js";

const program = new Command();

program
  .name("lattice")
  .version("1.0.0")
  .description("Objectivist Knowledge Lattice CLI v1.0")
  .option(
    "-v, --vault <path>",
    "Path to vault root (default: current directory)",
    ".",
  )
  .option("--json", "Output as JSON (arrays of objects, pretty-printed)")
  .option(
    "--table",
    "Output as human-readable tables/trees (for terminal use)",
  )
  .addHelpText(
    "after",
    `
PURPOSE:
  This tool enforces rational, hierarchical knowledge management for AI
  agents. It solves a specific problem: LLM agents accumulate beliefs,
  conclusions, and rules during operation, but have no mechanism to verify
  that those beliefs are grounded in reality rather than floating in mid-air.

  The Objectivist Knowledge Lattice forces every piece of knowledge to
  trace backward to direct observation. If you cannot show the chain from
  your conclusion back to what was actually perceived, the conclusion is
  quarantined as unvalidated. This is epistemological hygiene — it prevents
  an agent from acting on ungrounded abstractions, inherited biases, or
  rationalistic chains that were never checked against reality.

THE FOUR LEVELS (this is the core concept):
  Every node in the lattice has exactly one level. The levels form a strict
  hierarchy. Higher levels MUST reduce to lower levels. This is not optional.

  percept (level 0) — THE BASE. A directly observed, empirical fact.
    "I measured 5 feet 11 inches tall on Feb 22, 2026."
    "Running this function with input X returned error Y."
    "The user said they want feature Z in message #43."
    Percepts have NO reduces_to links. They are the ground floor.

  axiom (level 1) — A self-evident truth derived from percepts.
    "Things are what they are — identity is real."
    "Contradictions cannot exist in reality."
    Axioms reduce_to percepts that demonstrate them.

  principle (level 2) — A general rule induced from axioms and percepts.
    "Skipping tests leads to production bugs."
    "Users who wait >3s for page load abandon the site."
    "Attempting to hold contradictory requirements causes project failure."
    Principles reduce_to axioms and/or percepts.

  application (level 3) — A concrete action or decision deduced from principles.
    "Run the test suite before every deploy."
    "Optimize the image pipeline to hit <2s load time."
    "Reject this feature request because it contradicts requirement R."
    Applications reduce_to principles, axioms, and/or percepts.

  The reduction chain is the PROOF. "Why do I run tests before deploy?"
  → Because skipping tests leads to production bugs (principle)
  → Because things act according to their nature — untested code with
    defects will exhibit those defects (axiom)
  → Because on March 3 we deployed untested code and it crashed (percept).

WHY THIS MATTERS FOR AN AI AGENT:
  Without this tool, an agent's knowledge is a flat list of assertions with
  no way to verify which ones are grounded and which are confabulated. The
  lattice makes every belief auditable:
  - "lattice query chain <belief>" shows the full proof back to observation
  - "lattice validate" catches beliefs with broken or missing proofs
  - "lattice query tentative" surfaces everything not yet grounded
  An agent using this tool can answer "why do you believe X?" with a
  traceable chain instead of "because it seemed right."

WHEN TO ADD A NODE (the agent's decision filter):
  Before running "lattice add", ask yourself:
  1. Can I state it as one atomic proposition ("X is Y because Z")?
  2. Does it reduce to an existing chain, or can I complete one right now?
  3. Will this change a repeatable action or decision in the future?
  4. Is it already covered by an existing node? (check with "lattice query")
  If any answer is NO → do not add it. The lattice stays lean.

DATA MODEL:
  Node file:      <vault>/<level-folder>/YYYYMMDDHHMMss-slugified-title.md
  Level folders:  01-Percepts/ 02-Axioms/ 03-Principles/ 04-Applications/
  YAML fields:    title (string), level (enum), reduces_to (slug string[]),
                  status (enum), tags (string[]), created (ISO 8601 string)
  Statuses:       "Integrated/Validated" — chain complete, no contradictions
                  "Tentative/Hypothesis" — missing links or pending review
  reduces_to:     Filename slugs without .md (e.g. "20260222140032-a-is-a")
  Tags:           Must exist in <vault>/tags.json (fixed master list, ~20-30)

VAULT STRUCTURE (created by 'lattice init'):
  <vault>/
  ├── 01-Percepts/          Observed facts — the ground floor
  ├── 02-Axioms/            Self-evident truths from percepts
  ├── 03-Principles/        General rules induced from axioms/percepts
  ├── 04-Applications/      Concrete decisions from principles
  ├── tags.json             Master tag list (machine-readable)
  ├── Tags.md               Master tag list (human-readable, auto-generated)
  ├── Templates/New-Node.md Skeleton template for Obsidian users
  └── .lattice              Vault marker file

OUTPUT FORMATS:
  Default (no flag): TOON — Token-Oriented Object Notation. Compact,
    structured, 30-60% fewer tokens than JSON. Ideal for LLM consumption.
  --json:  Standard JSON. For scripts and programmatic parsing.
  --table: Human-readable tables and trees. For terminal viewing.

EXIT CODES:
  0  Success
  1  Validation error (bad level, missing chain, rogue tag, cycle, etc.)
  2  Filesystem error (vault not initialized, path not found, permissions)
  3  Bad input (missing required flag, malformed argument, ambiguous match)

COMMANDS:
  init       Create vault structure. Only command that works without a vault.
  add        Create one node. Enforces level, chain, tags, cycle detection.
  update     Modify a node: promote status, add/remove tags or reduces_to.
  query      Read the lattice. Subcommands:
               all           — Every node, with optional level/status/tag filters
               applications  — Validated applications (your action rules)
               principles    — Validated principles (your general rules)
               chain         — Full backward reduction tree to percepts
               tentative     — Ungrounded nodes needing review
               tag           — All nodes on a topic, grouped by level
  validate   Integrity scan. Catches broken chains, cycles, rogue tags.
  delete     Remove a node. Only Tentative or zero-incoming-links.
  tags       Manage the master tag list (list / add / remove).

AGENT WORKFLOW (recommended daily cycle):
  1. lattice validate                    — Check vault health first
  2. lattice query tentative             — Review ungrounded beliefs
  3. For each tentative: update, ground it, or delete it
  4. When you observe something new:
     lattice add --level percept ...     — Record the observation
  5. When you identify a pattern:
     lattice add --level principle ...   — Induce the rule, link to evidence
  6. When you decide on an action:
     lattice add --level application ... — Deduce the action, link to principle
  7. Before any significant decision:
     lattice query chain <decision>      — Verify the proof chain holds
  8. lattice validate                    — Confirm nothing is broken

GOLDEN EXAMPLE — Building a complete chain from scratch:

  $ lattice init
  $ lattice add --level percept \\
      --title "Deploy without tests crashed prod on March 3" \\
      --proposition "On 2026-03-03 we deployed commit abc123 without running \\
      the test suite. The payments endpoint returned 500 errors for 47 minutes. \\
      Root cause: untested null pointer in refactored handler." \\
      --tags "career,failure" \\
      --status "Integrated/Validated"
  # Slug output: 20260303091500-deploy-without-tests-crashed-prod-on-march-3

  $ lattice add --level axiom \\
      --title "Code behaves according to what it contains" \\
      --proposition "Software is deterministic: given identical inputs, code \\
      with a defect will produce the defective output every time. The defect \\
      does not resolve itself. This is identity applied to computation." \\
      -r 20260303091500-deploy-without-tests-crashed-prod-on-march-3 \\
      --tags "career" \\
      --status "Integrated/Validated"
  # Slug output: 20260303091545-code-behaves-according-to-what-it-contains

  $ lattice add --level principle \\
      --title "Untested code will exhibit its defects in production" \\
      --proposition "Because code acts according to what it contains (axiom), \\
      and because defects are not self-correcting, deploying without testing \\
      guarantees that any existing defect reaches users." \\
      -r 20260303091545-code-behaves-according-to-what-it-contains \\
      --tags "career,decisions" \\
      --status "Integrated/Validated"
  # Slug output: 20260303091620-untested-code-will-exhibit-its-defects-in-pro

  $ lattice add --level application \\
      --title "Run full test suite before every deploy" \\
      --proposition "Before any deployment to production, run the complete \\
      test suite and require zero failures. No exceptions. No 'it is just \\
      a small change.' This is the only rational policy given the principle \\
      that untested defects will reach users." \\
      -r 20260303091620-untested-code-will-exhibit-its-defects-in-pro \\
      --tags "career,habits,decisions" \\
      --status "Integrated/Validated"

  $ lattice query chain run-full-test --table
  # Output:
  # application: Run full test suite before every deploy
  # └─ principle: Untested code will exhibit its defects in production
  #    └─ axiom: Code behaves according to what it contains
  #       └─ percept: Deploy without tests crashed prod on March 3

  That chain is now the PROOF for the testing policy. Any future debate
  about "can we skip tests this one time" is resolved by querying the
  chain and seeing the percept at the bottom: the crash that happened.

Run 'lattice <command> --help' for full flag syntax and more examples.
`,
  );

program.addCommand(makeInitCommand());
program.addCommand(makeAddCommand());
program.addCommand(makeUpdateCommand());
program.addCommand(makeQueryCommand());
program.addCommand(makeValidateCommand());
program.addCommand(makeDeleteCommand());
program.addCommand(makeTagsCommand());

program.parse();
