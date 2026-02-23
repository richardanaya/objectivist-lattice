import { Command, Option } from "commander";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadTags, validateTags } from "../core/tags.js";
import { loadAllNodes, updateNodeFile } from "../core/node.js";
import { validateReductionLinks } from "../core/graph.js";
import { STATUSES, LEVELS, type Status } from "../core/constants.js";
import { LatticeError } from "../util/errors.js";
import { EXIT } from "../core/constants.js";
import { resolveFormat } from "../util/format.js";
import { encode } from "@toon-format/toon";
import { handleError, resolveNodeSlug } from "../util/cli-helpers.js";

export function makeUpdateCommand(): Command {
  const cmd = new Command("update");

  cmd
    .description("Update an existing node's status, tags, or reduces_to links")
    .argument("<node>", "Node slug, filename, or partial title match")
    .addOption(
      new Option("--status <status>", "New validation status")
        .choices([...STATUSES]),
    )
    .option(
      "--add-tag <tag>",
      "Add a tag (comma-separated for multiple). Must exist in tags.json.",
    )
    .option(
      "--remove-tag <tag>",
      "Remove a tag (comma-separated for multiple).",
    )
    .option(
      "--add-reduces-to <slug>",
      "Add a reduces_to link. Repeatable.",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "--remove-reduces-to <slug>",
      "Remove a reduces_to link. Repeatable.",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Modifies an existing node's metadata without recreating it. The file's
  proposition text (body) is preserved unchanged.

  This is how you promote beliefs through the validation lifecycle:
    Tentative/Hypothesis → Integrated/Validated
  It is also how you strengthen a node by adding more reduction links,
  or refine its categorization by adjusting tags.

THE PROMOTION WORKFLOW:
  When you first add a node, it defaults to Tentative/Hypothesis.
  This means "I believe this but have not fully verified the chain."
  Once you have:
    1. Confirmed all reduces_to targets exist and are themselves Validated
    2. Checked for contradictions with existing principles
    3. Verified the chain reaches percepts (lattice query chain <node>)
  Then promote it:
    $ lattice update <node> --status "Integrated/Validated"
  Now it appears in 'query applications' and 'query principles' results.

FLAGS:
  <node>                 REQUIRED. Slug, partial slug, or title substring.
  --status <status>      Set to "Integrated/Validated" or "Tentative/Hypothesis"
  --add-tag <tags>       Add tags (comma-separated). Must exist in tags.json.
  --remove-tag <tags>    Remove tags (comma-separated).
  --add-reduces-to <slug>     Add a reduction link (repeatable).
  --remove-reduces-to <slug>  Remove a reduction link (repeatable).

VALIDATION (still enforced on update):
  - New tags must exist in tags.json
  - New reduces_to targets must exist and obey level ordering
  - Cycle detection runs on every new link
  - Removing ALL reduces_to from a non-percept auto-sets status to Tentative
    (because a principle with no evidence is, by definition, ungrounded)

OUTPUT:
  Default (TOON): { updated: "<slug>", changes: { ... } }
  --json: same as JSON
  --table: "Updated: <slug> (status: Tentative → Validated, ...)"

GOLDEN EXAMPLES:

  1. Promote a percept after confirming the observation:
     $ lattice update api-returns-500 --status "Integrated/Validated"
     Updated: 20260303091500-api-returns-500-on-null-userid
       (status: Tentative/Hypothesis → Integrated/Validated)

  2. Add a newly discovered reduction link to an existing principle:
     $ lattice update untested-code-will-exhibit \\
         --add-reduces-to 20260315100000-second-outage-from-skipped-tests
     Updated: 20260303091620-untested-code-will-exhibit-its-defects-in-pro
       (reduces_to: added 20260315100000-second-outage-from-skipped-tests)
     # The principle now has TWO pieces of evidence. Stronger chain.

  3. Reclassify a node's tags as understanding deepens:
     $ lattice update run-full-test-suite \\
         --add-tag "habits" --remove-tag "risk"
     Updated: 20260303092000-run-full-test-suite-before-every-deploy
       (tags: career,habits,decisions)

  4. Demote a node when you discover its chain is broken:
     $ lattice update some-principle --status "Tentative/Hypothesis"
     # Now it shows up in 'lattice query tentative' for review.

  5. ERROR — rogue tag:
     $ lattice update homework-before --add-tag "vibes"
     Error: Rogue tag 'vibes' not in tags.json
`,
    );

  cmd.action(async (nodeQuery: string, opts) => {
    try {
      const parentOpts = cmd.parent?.opts() ?? {};
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      const slug = resolveNodeSlug(nodeQuery, nodes);
      const node = nodes.get(slug)!;

      const changes: Record<string, string> = {};

      // ── Status update ──
      let newStatus: Status | undefined;
      if (opts.status) {
        newStatus = opts.status as Status;
        changes.status = `${node.status} → ${newStatus}`;
      }

      // ── Tag updates ──
      let newTags: string[] | undefined;
      const currentTags = [...node.tags];
      let tagsChanged = false;

      if (opts.addTag) {
        const toAdd = (opts.addTag as string)
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);

        // Validate against master list
        const masterTags = await loadTags(vaultPath);
        validateTags(toAdd, masterTags);

        for (const t of toAdd) {
          if (!currentTags.includes(t)) {
            currentTags.push(t);
            tagsChanged = true;
          }
        }
      }

      if (opts.removeTag) {
        const toRemove = new Set(
          (opts.removeTag as string)
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
        );

        const before = currentTags.length;
        const filtered = currentTags.filter((t) => !toRemove.has(t));
        if (filtered.length !== before) {
          currentTags.length = 0;
          currentTags.push(...filtered);
          tagsChanged = true;
        }
      }

      if (tagsChanged) {
        newTags = currentTags;
        changes.tags = newTags.join(",");
      }

      // ── Reduces_to updates ──
      let newReducesTo: string[] | undefined;
      const currentReduces = [...node.reduces_to];
      let reducesChanged = false;

      if ((opts.addReducesTo as string[]).length > 0) {
        const toAdd = (opts.addReducesTo as string[]).map((r) =>
          r.replace(/\.md$/, "").trim(),
        );

        // Validate new links
        validateReductionLinks(slug, node.level, toAdd, nodes);

        for (const r of toAdd) {
          if (!currentReduces.includes(r)) {
            currentReduces.push(r);
            reducesChanged = true;
          }
        }
      }

      if ((opts.removeReducesTo as string[]).length > 0) {
        const toRemove = new Set(
          (opts.removeReducesTo as string[]).map((r) =>
            r.replace(/\.md$/, "").trim(),
          ),
        );

        const before = currentReduces.length;
        const filtered = currentReduces.filter((r) => !toRemove.has(r));
        if (filtered.length !== before) {
          currentReduces.length = 0;
          currentReduces.push(...filtered);
          reducesChanged = true;
        }
      }

      if (reducesChanged) {
        newReducesTo = currentReduces;
        changes.reduces_to = newReducesTo.join(",") || "(empty)";

        // If non-percept loses all reduces_to, force Tentative
        if (
          node.level !== "percept" &&
          newReducesTo.length === 0 &&
          !newStatus
        ) {
          newStatus = "Tentative/Hypothesis";
          changes.status = `${node.status} → Tentative/Hypothesis (no reduces_to links remain)`;
        }
      }

      // Check that at least one update was requested
      if (Object.keys(changes).length === 0) {
        throw new LatticeError(
          "No updates specified. Use --status, --add-tag, --remove-tag, --add-reduces-to, or --remove-reduces-to.",
          EXIT.BAD_INPUT,
        );
      }

      // Apply the update
      await updateNodeFile(node, {
        status: newStatus,
        tags: newTags,
        reduces_to: newReducesTo,
      });

      // Output
      const result = { updated: slug, changes };
      switch (format) {
        case "json":
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          break;
        case "toon":
          process.stdout.write(encode(result) + "\n");
          break;
        case "table": {
          const parts = Object.entries(changes)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          process.stdout.write(`Updated: ${slug} (${parts})\n`);
          break;
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}
