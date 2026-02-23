import { Command } from "commander";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadTags, saveTags } from "../core/tags.js";
import { loadAllNodes } from "../core/node.js";
import { resolveFormat, formatTagList } from "../util/format.js";
import { LatticeError } from "../util/errors.js";
import { EXIT } from "../core/constants.js";
import { resolveParentOpts, handleError, resolveNodeSlug } from "../util/cli-helpers.js";

export function makeTagsCommand(): Command {
  const cmd = new Command("tags");

  cmd
    .description("Manage the fixed master tag list")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Manages the fixed master tag list. Tags are life-domain categories that
  let you slice the lattice by topic: "show me everything I know about
  money" or "what are my validated career principles?"

  Tags are intentionally constrained. The default list has 20 tags covering
  the domains a rational agent encounters: health, career, money,
  relationships, ethics, etc. Recommended maximum: 30 tags total.

  Adding a new tag requires citing an existing Validated node as justification.
  This prevents the tag list from bloating into meaningless hashtag soup.
  If you cannot point to a validated node that proves a new tag category
  is needed, you do not need the tag.

  Every node's tags are validated against this list. A tag not in tags.json
  causes validation failure.

SUBCOMMANDS:
  list     Print all tags in the master list
  add      Add a new tag (requires --reason: a validated node justifying it)
  remove   Remove a tag (only if zero nodes currently use it)
`,
    );

  // ─── list ──────────────────────────────────────────────────────
  const listCmd = new Command("list")
    .description("Print the current master tag list")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Prints the current master tag list from tags.json.

  Use this to see what tags are available before adding or querying nodes.
  The default 20 tags are: career, communication, creativity, decisions,
  emotions, ethics, failure, family, fitness, friendships, goals, habits,
  health, learning, money, productivity, relationships, risk,
  self-knowledge, success.

OUTPUT:
  Default (TOON): flat array of tag strings (e.g. [20]: career,communication,...)
  --json: JSON array of strings
  --table: bulleted list

EXAMPLES:
  $ lattice tags list              # see all available tags
  $ lattice tags list --json       # for programmatic use
`,
    );

  listCmd.action(async () => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const tags = await loadTags(vaultPath);
      process.stdout.write(formatTagList(tags, format) + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  // ─── add ───────────────────────────────────────────────────────
  const addCmd = new Command("add")
    .description("Add a new tag to the master list")
    .argument("<tag>", "New tag name (lowercase, no spaces)")
    .requiredOption(
      "--reason <node>",
      "Slug of an Integrated/Validated node that justifies this tag's existence",
    )
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Adds a new tag to the master list. Requires --reason pointing to an
  existing Integrated/Validated node that justifies the new category.

  This constraint exists because tag bloat kills the lattice. At 20 tags,
  queries are fast and meaningful. At 200 tags, every query returns noise
  and the agent stops using them. The --reason requirement forces you to
  prove the tag represents a real, validated domain of knowledge.

RULES:
  - Tag name is lowercased and trimmed automatically
  - Duplicate tags are silently accepted (idempotent)
  - The --reason node must exist and be Integrated/Validated
  - Recommended: keep total tags under 30

EXAMPLES:

  1. Add "nutrition" because you have validated health-related nodes:
     $ lattice tags add nutrition --reason 20260315-exercise-prevents-injury
     Tag 'nutrition' added (justified by: 20260315-exercise-prevents-injury)

  2. ERROR — reason node is not validated:
     $ lattice tags add dating --reason 20260315-tentative-idea
     Error: Reason node '20260315-tentative-idea' is not Integrated/Validated
     # Ground the reason node first, then try again.
`,
    );

  addCmd.action(async (tag: string, opts: { reason: string }) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const tags = await loadTags(vaultPath);
      const cleanTag = tag.toLowerCase().trim();

      // Check if already exists
      if (tags.includes(cleanTag)) {
        process.stdout.write(
          `Tag '${cleanTag}' already exists in master list\n`,
        );
        return;
      }

      // Validate reason node
      const nodes = await loadAllNodes(vaultPath);
      const reasonSlug = resolveNodeSlug(opts.reason, nodes);
      const reasonNode = nodes.get(reasonSlug)!;
      if (reasonNode.status !== "Integrated/Validated") {
        throw new LatticeError(
          `Reason node '${reasonSlug}' is not Integrated/Validated (status: ${reasonNode.status})`,
          EXIT.VALIDATION_ERROR,
        );
      }

      // Add tag
      tags.push(cleanTag);
      await saveTags(vaultPath, tags);

      process.stdout.write(
        `Tag '${cleanTag}' added to master list (justified by: ${reasonSlug})\n`,
      );
    } catch (err) {
      handleError(err);
    }
  });

  // ─── remove ────────────────────────────────────────────────────
  const removeCmd = new Command("remove")
    .description("Remove a tag from the master list")
    .argument("<tag>", "Tag to remove")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Removes a tag from the master list. Only allowed if zero nodes use it.

  This prevents orphaning: if 12 nodes are tagged "productivity" and you
  remove the tag, those nodes now have a rogue tag that fails validation.
  Remove usage from all nodes first, then remove the tag.

EXAMPLES:

  1. Remove an unused tag:
     $ lattice tags remove hobbies
     Tag 'hobbies' removed from master list

  2. ERROR — tag still in use:
     $ lattice tags remove productivity
     Error: Cannot remove tag 'productivity': used by 12 node(s)
     # Update those 12 nodes first, then retry.
`,
    );

  removeCmd.action(async (tag: string) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const tags = await loadTags(vaultPath);
      const cleanTag = tag.toLowerCase().trim();

      if (!tags.includes(cleanTag)) {
        throw new LatticeError(
          `Tag '${cleanTag}' not found in master list`,
          EXIT.BAD_INPUT,
        );
      }

      // Check if any nodes use this tag
      const nodes = await loadAllNodes(vaultPath);
      const usageCount = Array.from(nodes.values()).filter((n) =>
        n.tags.includes(cleanTag),
      ).length;

      if (usageCount > 0) {
        throw new LatticeError(
          `Cannot remove tag '${cleanTag}': used by ${usageCount} node(s)`,
          EXIT.VALIDATION_ERROR,
        );
      }

      // Remove tag
      const newTags = tags.filter((t) => t !== cleanTag);
      await saveTags(vaultPath, newTags);

      process.stdout.write(
        `Tag '${cleanTag}' removed from master list\n`,
      );
    } catch (err) {
      handleError(err);
    }
  });

  cmd.addCommand(listCmd);
  cmd.addCommand(addCmd);
  cmd.addCommand(removeCmd);

  return cmd;
}
