import { Command } from "commander";
import { unlink } from "node:fs/promises";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadAllNodes } from "../core/node.js";
import { buildIncomingLinks } from "../core/graph.js";
import { resolveFormat } from "../util/format.js";
import { encode } from "@toon-format/toon";
import { DeleteBlockedError } from "../util/errors.js";
import { handleError, resolveNodeSlug } from "../util/cli-helpers.js";

export function makeDeleteCommand(): Command {
  const cmd = new Command("delete");

  cmd
    .description("Remove a node from the lattice")
    .argument("<node>", "Node slug, filename, or partial title match")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Removes a node from the lattice permanently. No confirmation, no undo.
  The Markdown file is deleted from disk immediately.

  Deletion is how you clean the lattice of noise: abandoned hypotheses,
  disproven observations, or superseded rules. A lean lattice with 500
  validated nodes is worth more than a bloated one with 5,000 unreviewed
  entries.

WHEN TO DELETE:
  - A percept turned out to be wrong (you misread the log, the data was stale)
  - A principle was disproven by new evidence
  - A tentative node has sat ungrounded for too long
  - A node is a duplicate of another node

DELETION RULES (enforced):
  You CAN delete a node if:
    - Its status is Tentative/Hypothesis (any tentative node can be deleted)
    - OR no other nodes have reduces_to links pointing to it

  You CANNOT delete a node if:
    - It is Integrated/Validated AND other nodes reduce to it
    - This protects the lattice: deleting a validated axiom would break
      every principle and application built on top of it
    - To delete anyway: first 'lattice update <node> --status "Tentative/Hypothesis"'
      then delete. Or remove the incoming links from dependent nodes first.

NODE MATCHING:
  Exact slug > prefix match > slug substring > title substring.
  Ambiguous matches (multiple nodes match) produce an error listing candidates.

OUTPUT:
  Default (TOON): { deleted: "<slug>", file: "<filepath>" }
  --json: same as JSON
  --table: "Deleted: <filepath>"

GOLDEN EXAMPLES:

  1. Remove a tentative node that never got grounded:
     $ lattice query tentative --older-than 7d    # find stale nodes
     $ lattice delete config-drift-hypothesis      # remove one
     Deleted: ./03-Principles/20260310-config-drift-hypothesis.md

  2. Remove a percept after discovering the data was wrong:
     $ lattice delete api-returns-500
     Deleted: ./01-Percepts/20260303091500-api-returns-500-on-null-userid.md
     # WARNING: if other nodes reduced to this percept, they now have
     # broken chains. Run 'lattice validate' immediately after.

  3. ERROR — trying to delete a foundational validated node:
     $ lattice delete code-behaves-according
     Error: Cannot delete '20260303091545-code-behaves-according-to-what-it-contains':
     3 other node(s) reduce to it and it is Integrated/Validated.
     # Fix: demote it first, or update the dependent nodes.
`,
    );

  cmd.action(async (nodeQuery: string) => {
    try {
      const parentOpts = cmd.parent?.opts() ?? {};
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      const slug = resolveNodeSlug(nodeQuery, nodes);
      const node = nodes.get(slug)!;

      // Check deletion rules
      if (node.status === "Integrated/Validated") {
        const incoming = buildIncomingLinks(nodes);
        const incomingLinks = incoming.get(slug) ?? [];
        if (incomingLinks.length > 0) {
          throw new DeleteBlockedError(slug, incomingLinks.length);
        }
      }

      // Delete the file
      await unlink(node.filePath);

      // Output
      switch (format) {
        case "json":
          process.stdout.write(
            JSON.stringify({ deleted: slug, file: node.filePath }, null, 2) +
              "\n",
          );
          break;
        case "toon":
          process.stdout.write(
            encode({ deleted: slug, file: node.filePath }) + "\n",
          );
          break;
        case "table":
          process.stdout.write(`Deleted: ${node.filePath}\n`);
          break;
      }
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}
