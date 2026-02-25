import { Command, Option } from "commander";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadAllNodes, updateNodeFile, createNodeFile, MergedFromEntry, parseNodeFile } from "../core/node.js";
import { validateGraph } from "../core/graph.js";
import { loadTags } from "../core/tags.js";
import { LEVELS } from "../core/constants.js";
import { resolveFormat } from "../util/format.js";
import { handleError } from "../util/cli-helpers.js";
import type { LatticeNode } from "../core/node.js";
import type { Command as CommanderCommand } from "commander";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { mkdir, rename } from "fs/promises";
import { join, basename } from "path";

/**
 * Generate a unique deduplication group ID in format DG-YYYYMMDDHHMM-XXX
 */
function generateGroupId(): string {
  const now = new Date();
  const timestamp = [
    now.getFullYear().toString(),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
    now.getHours().toString().padStart(2, "0"),
    now.getMinutes().toString().padStart(2, "0"),
  ].join("");
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `DG-${timestamp}-${random}`;
}

/**
 * Attempt to commit changes to git if vault is in a git repo.
 */
async function gitCommitIfEnabled(vaultPath: string, message: string, enabled: boolean): Promise<void> {
  if (!enabled) return;

  try {
    // Check if .git exists
    if (!existsSync(join(vaultPath, ".git"))) {
      return;
    }

    // Add all changes
    execSync("git add .", { cwd: vaultPath, stdio: "ignore" });

    // Commit
    execSync(`git commit -m "${message}"`, { cwd: vaultPath, stdio: "ignore" });
  } catch {
    // Ignore git errors
  }
}

export function makeDedupCommand(): CommanderCommand {
  const dedup = new Command("dedup")
    .description(`Deduplication subsystem for managing semantic duplicates.

WORKFLOW OVERVIEW:
1. Find candidates: 'candidates' → AI analysis → 'group create'
2. Review group: 'group show' → decide on merge
3. Merge duplicates: 'merge' (creates canonical node, trashes old ones)
4. Undo if needed: 'undo' (restores everything)

This system maintains epistemological hygiene by ensuring each objective truth
is represented exactly once, while preserving full audit trails and reversibility.

EXAMPLES:
  # AI-assisted deduplication
  lattice dedup candidates --level principle
  # Copy output to Claude/Grok, get group commands, then:
  lattice dedup group show DG-202401011200-123
  lattice dedup merge --deduplication-group DG-202401011200-123 \\
    --title "Combined principle" --level principle --proposition "..."

  # Manual deduplication
  lattice dedup group create --node slug1 --node slug2
  lattice dedup merge --old-node slug1 --old-node slug2 \\
    --title "Merged" --level principle --proposition "..."

  # Fix mistakes
  lattice dedup undo merged-node-slug --reason "Wrong merge"`);

  dedup.addCommand(makeCandidatesCommand());
  dedup.addCommand(makeGroupCommand());
  dedup.addCommand(makeMergeCommand());
  dedup.addCommand(makeUndoCommand());

  return dedup;
}

function makeCandidatesCommand(): CommanderCommand {
  const cmd = new Command("candidates")
    .description(`Scan for potential semantic duplicates at one knowledge level.

This command finds nodes that might express the same objective truth but with
different wording or structure. It outputs a ready-to-copy markdown prompt
designed for AI analysis (Claude, Grok, etc.) to help identify true duplicates.

WHEN TO USE:
- When you suspect duplicates exist at a level
- For regular maintenance scans
- Before major knowledge additions

OUTPUT:
- Markdown prompt containing all nodes at the specified level
- Ready to paste into AI chat for duplicate analysis
- AI will suggest 'lattice dedup group create' commands

EXAMPLES:
  # Scan recent principles for duplicates
  lattice dedup candidates --level principle --after 2024-01-01

  # Limit to 20 nodes for smaller AI prompts
  lattice dedup candidates --level principle --max-candidates 20

  # Full scan of all axioms
  lattice dedup candidates --level axiom`)
    .requiredOption("--level <level>", "Knowledge level: axiom | percept | principle | application")
    .option("--after <date>", "ISO date (YYYY-MM-DD). Only scan nodes created after this date.", "1970-01-01")
    .option("--max-candidates <N>", "Maximum nodes to include in scan (default: 100)", "100");

  cmd.action(async (opts) => {
    try {
      const parentOpts = cmd.parent!.parent!.opts() as any;
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const level = opts.level as typeof LEVELS[number];
      if (!LEVELS.includes(level)) {
        throw new Error(`Invalid level: ${level}`);
      }

      const afterDate = new Date(opts.after as string);
      const max = parseInt(opts.maxCandidates as string) || 100;

      const nodes = await loadAllNodes(vaultPath);
      const levelNodes = Array.from(nodes.values())
        .filter(n => n.level === level && n.created > afterDate)
        .sort((a, b) => b.created.getTime() - a.created.getTime())
        .slice(0, max);

      // Markdown output always for candidates
      let md = `# Deduplication Candidates: ${level.toUpperCase()} (after ${afterDate.toISOString().slice(0,10)}, max ${max})\n\n`;
      md += `**Vault:** ${vaultPath}\n`;
      md += `**Total scanned:** ${levelNodes.length}\n\n`;
      md += `Copy the prompt below to an LLM (Claude/Grok recommended) to generate group create commands.\n\n\`\`\`\n`;
      md += `You are a precise deduplication judge for Objectivist knowledge lattices. Identify groups of 2+ nodes expressing the *identical* underlying objective truth, despite wording/structure differences. Err conservative — only group if a human would recognize them as duplicates.\n\n`;
      md += `Nodes (${levelNodes.length}):\n\n`;

      for (let i = 0; i < levelNodes.length; i++) {
        const n = levelNodes[i];
        md += `${i+1}. **${n.title}** (created ${n.created.toISOString().slice(0,10)})\n\n`;
        md += `Slug: \`${n.slug}\`\n\nProposition:\n\`\`\`\n${n.proposition}\n\`\`\`\n\n`;
      }

      md += `\nOutput *only* valid shell commands, one per line, no explanations:\n\n`;
      md += `lattice dedup group create --node SLUG1 [--node SLUG2 ...]\n\n`;
      md += `lattice dedup group create --node SLUG3 --node SLUG4\n\n`;
      md += `Use all relevant nodes. Singletons get no command.\n\`\`\`\n`;

      console.log(md);
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}

function makeGroupCommand(): CommanderCommand {
  const group = new Command("group")
    .description(`Manage temporary deduplication review groups.

Groups are temporary collections of potentially duplicate nodes. They exist
only to facilitate review and merging - the actual deduplication happens
in the merge command.

WORKFLOW:
1. Create group from AI suggestions or manual selection
2. Review with 'show' command
3. Either merge the group or remove it if not duplicates

GROUPS ARE TEMPORARY:
- Groups are just metadata markers on nodes
- They don't affect the lattice structure
- Removing a group doesn't delete nodes
- Groups are cleared when nodes are merged`);

  group.addCommand(makeGroupCreateCommand());
  group.addCommand(makeGroupRemoveCommand());
  group.addCommand(makeGroupShowCommand());

  return group;
}

function makeGroupCreateCommand(): CommanderCommand {
  const cmd = new Command("create")
    .description(`Create a temporary group of potentially duplicate nodes.

This marks multiple nodes as belonging to the same deduplication group,
allowing you to review them together before merging. Groups get unique
IDs like DG-202401011230-456.

VALIDATION PERFORMED:
- All nodes must exist
- All nodes must be at the same level
- No node can be in another group already
- At least one node required

EXAMPLES:
  # Group from AI suggestions
  lattice dedup group create --node principle-1 --node principle-2

  # Preview before creating
  lattice dedup group create --dry-run --node slug1 --node slug2 --node slug3`)
    .option("--dry-run", "Show what would be done without making changes")
    .requiredOption("--node <slug>", "Node slug to include. Repeat for multiple nodes.", (v: string, p: string[]) => [...p, v as string], [] as string[]);

  cmd.action(async (opts) => {
    try {
      const parentOpts = cmd.parent!.parent!.opts() as any;
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const nodeSlugs: string[] = opts.node;
      if (nodeSlugs.length === 0) {
        throw new Error("At least one --node must be specified");
      }

      const nodes = await loadAllNodes(vaultPath);

      // Validate all nodes exist
      const groupNodes: LatticeNode[] = [];
      for (const slug of nodeSlugs) {
        const node = nodes.get(slug);
        if (!node) {
          throw new Error(`Node not found: ${slug}`);
        }
        groupNodes.push(node);
      }

      // Validate all at same level
      const level = groupNodes[0].level;
      for (const node of groupNodes) {
        if (node.level !== level) {
          throw new Error(`All nodes must be at the same level. Found ${node.level} in group with ${level}`);
        }
      }

      // Validate none are already in another group
      for (const node of groupNodes) {
        if (node.deduplication_group) {
          throw new Error(`Node ${node.slug} is already in group ${node.deduplication_group}`);
        }
      }

      const groupId = generateGroupId();

      if (opts.dryRun) {
        console.log(`Would create group ${groupId} with nodes:`);
        for (const node of groupNodes) {
          console.log(`  - ${node.slug} (${node.title})`);
        }
      } else {
        // Update each node with the group ID
        for (const node of groupNodes) {
          await updateNodeFile(node, { deduplication_group: groupId });
        }
        console.log(`Created deduplication group: ${groupId}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}

function makeGroupRemoveCommand(): CommanderCommand {
  const cmd = new Command("remove")
    .description(`Remove a deduplication group and clear group markers from all nodes.

This clears the deduplication_group field from every node that was in the
specified group. It's safe to run on non-existent groups (silent success).

WHEN TO USE:
- When you decide grouped nodes aren't actually duplicates
- To clean up abandoned groups
- Before re-grouping nodes differently

EXAMPLES:
  # Remove a specific group
  lattice dedup group remove DG-202401011230-456

  # Preview removal
  lattice dedup group remove DG-202401011230-456 --dry-run`)
    .argument("<groupId>", "Group ID (format: DG-YYYYMMDDHHMM-XXX)")
    .option("--dry-run", "Show what would be done without making changes");

  cmd.action(async (groupId, opts) => {
    try {
      const parentOpts = cmd.parent!.parent!.opts() as any;
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const nodes = await loadAllNodes(vaultPath);

      // Find all nodes in this group
      const groupNodes: LatticeNode[] = [];
      for (const node of nodes.values()) {
        if (node.deduplication_group === groupId) {
          groupNodes.push(node);
        }
      }

      if (groupNodes.length === 0) {
        // Silently succeed if group doesn't exist
        return;
      }

      if (opts.dryRun) {
        console.log(`Would remove group ${groupId} from nodes:`);
        for (const node of groupNodes) {
          console.log(`  - ${node.slug}`);
        }
      } else {
        // Clear deduplication_group from each node
        for (const node of groupNodes) {
          await updateNodeFile(node, { deduplication_group: undefined });
        }
        console.log(`Removed deduplication group: ${groupId}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}

function makeGroupShowCommand(): CommanderCommand {
  const cmd = new Command("show")
    .description(`Display comprehensive review of a deduplication group.

Shows all nodes in the group side-by-side with:
- Full propositions for comparison
- Creation dates, status, tags
- Reduction chains
- Ready-to-copy merge command

WHEN TO USE:
- After creating a group to review before merging
- To compare similar nodes
- To generate merge commands

OUTPUT INCLUDES:
- Group metadata (level, node count)
- Side-by-side node details
- Copy-paste merge command with all node slugs

EXAMPLES:
  # Review a group before merging
  lattice dedup group show DG-202401011230-456`)
    .argument("<groupId>", "Group ID (format: DG-YYYYMMDDHHMM-XXX)");

  cmd.action(async (groupId) => {
    try {
      const parentOpts = cmd.parent!.parent!.opts() as any;
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const nodes = await loadAllNodes(vaultPath);

      // Find all nodes in this group
      const groupNodes: LatticeNode[] = [];
      for (const node of nodes.values()) {
        if (node.deduplication_group === groupId) {
          groupNodes.push(node);
        }
      }

      if (groupNodes.length === 0) {
        throw new Error(`Group not found: ${groupId}`);
      }

      // Sort by created date
      groupNodes.sort((a, b) => a.created.getTime() - b.created.getTime());

      console.log(`# Deduplication Group: ${groupId}`);
      console.log(`**Level:** ${groupNodes[0].level}`);
      console.log(`**Nodes:** ${groupNodes.length}`);
      console.log("");

      for (let i = 0; i < groupNodes.length; i++) {
        const node = groupNodes[i];
        console.log(`## ${i + 1}. ${node.title}`);
        console.log(`**Slug:** ${node.slug}`);
        console.log(`**Created:** ${node.created.toISOString().slice(0, 10)}`);
        console.log(`**Status:** ${node.status}`);
        console.log(`**Tags:** ${node.tags.join(", ") || "none"}`);
        console.log("");

        // Reduction chains (simplified)
        if (node.reduces_to.length > 0) {
          console.log(`**Reduces to:** ${node.reduces_to.join(", ")}`);
          console.log("");
        }

        console.log(`**Proposition:**`);
        console.log(`${node.proposition}`);
        console.log("");
      }

      // Ready-to-copy merge command
      const nodeArgs = groupNodes.map(n => `--old-node ${n.slug}`).join(" ");
      console.log(`## Ready-to-copy merge command:`);
      console.log(`lattice dedup merge --deduplication-group ${groupId} --title "Merged title" --level ${groupNodes[0].level} --proposition "Merged proposition" ${nodeArgs}`);
      console.log("");

    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}

function makeMergeCommand(): CommanderCommand {
  const cmd = new Command("merge")
    .description(`Merge duplicate nodes into a single canonical node.

This is the core deduplication operation. It creates one new node representing
the combined objective truth, moves old nodes to trash with full audit trails,
and rewrites all references to point to the new canonical node.

WHAT HAPPENS:
1. Creates new canonical node with provided title/proposition
2. Records merge metadata on canonical node (merged_from, merged_reason, etc.)
3. Moves old nodes to 99-Trash/ with audit trails
4. Updates all reduces_to references across the vault
5. Clears deduplication_group markers
6. Validates lattice integrity

SAFETY FEATURES:
- Full audit trail in YAML metadata
- Zero data loss (trashed nodes remain readable)
- Automatic reference rewriting
- Validation after merge
- Optional git commit

WHEN TO USE:
- After reviewing a group and confirming they are true duplicates
- When you have the perfect combined proposition ready

EXAMPLES:
  # Merge a reviewed group
  lattice dedup merge --deduplication-group DG-202401011230-456 \\
    --title "Canonical principle title" --level principle \\
    --proposition "The combined objective truth..."

  # Manual merge of specific nodes
  lattice dedup merge --old-node slug1 --old-node slug2 \\
    --title "Merged title" --level principle --proposition "..." \\
    --reason "Manual consolidation"

  # Preview merge
  lattice dedup merge --dry-run --deduplication-group GROUP-ID \\
    --title "..." --level principle --proposition "..."`)
    .requiredOption("--title <title>", "Title for the new canonical node")
    .requiredOption("--level <level>", "Knowledge level (must match old nodes)")
    .requiredOption("--proposition <text>", "Full propositional text for canonical node")
    .option("--deduplication-group <id>", "Group ID to merge (alternative to --old-node)")
    .option("--old-node <slug>", "Specific old node to merge. Repeat for multiple.", (v, p) => [...p, v as string], [] as string[])
    .option("--reason <text>", "Human reason for this merge (recorded in metadata)")
    .option("--dry-run", "Show what would be done without making changes")
    .option("--auto-commit", "Automatically commit to git if vault is in repo");

  cmd.action(async (opts) => {
    try {
      const parentOpts = cmd.parent!.parent!.opts() as any;
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const title: string = opts.title;
      const level: string = opts.level;
      const proposition: string = opts.proposition;
      const groupId: string | undefined = opts.deduplicationGroup;
      const oldNodeSlugs: string[] = opts.oldNode || [];
      const reason: string | undefined = opts.reason;
      const dryRun: boolean = opts.dryRun;
      const autoCommit: boolean = opts.autoCommit;

      if (!LEVELS.includes(level as any)) {
        throw new Error(`Invalid level: ${level}`);
      }

      // Warn for axiom/percept merges
      if ((level === "axiom" || level === "percept") && !dryRun) {
        console.error("Warning: Merging bedrock nodes (axiom/percept) is allowed but not recommended.");
        console.error("These are philosophical/empirical foundations. Proceed only if certain.");
      }

      // Warn for large groups
      if (oldNodeSlugs.length > 10) {
        console.error(`Warning: Merging ${oldNodeSlugs.length} nodes. Large merges increase risk of error.`);
      }

      let nodes = await loadAllNodes(vaultPath);

      // Determine old nodes
      let oldNodes: LatticeNode[] = [];
      if (groupId) {
        // From group
        for (const node of nodes.values()) {
          if (node.deduplication_group === groupId) {
            oldNodes.push(node);
          }
        }
        if (oldNodes.length === 0) {
          throw new Error(`No nodes found in group: ${groupId}`);
        }
        // Union with manual old nodes
        for (const slug of oldNodeSlugs) {
          const node = nodes.get(slug);
          if (!node) {
            throw new Error(`Node not found: ${slug}`);
          }
          if (!oldNodes.find(n => n.slug === slug)) {
            oldNodes.push(node);
          }
        }
      } else {
        // Manual only
        for (const slug of oldNodeSlugs) {
          const node = nodes.get(slug);
          if (!node) {
            throw new Error(`Node not found: ${slug}`);
          }
          oldNodes.push(node);
        }
      }

      if (oldNodes.length === 0) {
        throw new Error("No old nodes specified");
      }

      // Validate all at same level
      const expectedLevel = oldNodes[0].level;
      for (const node of oldNodes) {
        if (node.level !== expectedLevel) {
          throw new Error(`All nodes must be at same level. Found ${node.level}, expected ${expectedLevel}`);
        }
        if (node.level !== level) {
          throw new Error(`Old nodes are at level ${node.level}, but new node is ${level}`);
        }
        if (node.merged_into) {
          throw new Error(`Node ${node.slug} has already been merged`);
        }
      }

      const now = new Date();
      const mergedDate = now.toISOString();

      // Prepare merged_from entries
      const mergedFrom: MergedFromEntry[] = oldNodes.map(node => ({
        id: node.slug,
        original_path: node.filePath,
        original_status: node.status,
        trashed_path: "", // Will fill after moving
      }));

      if (dryRun) {
        console.log("Would merge the following nodes:");
        for (const node of oldNodes) {
          console.log(`  - ${node.slug} (${node.title})`);
        }
        console.log(`Into new node: ${title}`);
        console.log(`At level: ${level}`);
        return;
      }

      // Create the trash folder
      const trashDir = join(vaultPath, "99-Trash");
      await mkdir(trashDir, { recursive: true });

      // Create new canonical node
      const canonicalResult = await createNodeFile(vaultPath, {
        title,
        level: level as any,
        reduces_to: oldNodes[0].reduces_to, // Inherit reduces_to from old nodes
        status: "Tentative/Hypothesis", // Default, can be changed later
        tags: [], // Merge tags? For now empty
        proposition,
        merged_from: mergedFrom,
        merged_reason: reason,
        merged_date: mergedDate,
        merged_group_id: groupId,
      }, new Set(nodes.keys()));

      const canonicalSlug = canonicalResult.slug;
      console.log(`Created canonical node: ${canonicalSlug}`);

      // Move old nodes to trash and update metadata
      for (let i = 0; i < oldNodes.length; i++) {
        const oldNode = oldNodes[i];
        const trashedPath = join(trashDir, basename(oldNode.filePath));

        // Update metadata on old node
        await updateNodeFile(oldNode, {
          merged_into: canonicalSlug,
          trashed_on: mergedDate,
          original_status: oldNode.status,
          original_path: oldNode.filePath,
          deduplication_group: undefined, // Clear group
        });

        // Move file to trash
        await rename(oldNode.filePath, trashedPath);

        // Update merged_from entry
        mergedFrom[i].trashed_path = trashedPath;
      }

      // Update canonical node with correct merged_from (with trashed paths)
      // Load just the canonical node to update it
      const canonicalNode = await parseNodeFile(canonicalResult.filePath);
      await updateNodeFile(canonicalNode, { merged_from: mergedFrom });

      // Rewrite reduces_to references across the vault
      // Find all nodes that reference any of the old nodes
      for (const node of nodes.values()) {
        if (node.slug === canonicalSlug) continue; // Skip the new one

        const oldRefs = node.reduces_to.filter(ref => oldNodes.some(old => old.slug === ref));
        if (oldRefs.length > 0) {
          // Replace old refs with canonical slug
          const newReducesTo = node.reduces_to.map(ref =>
            oldRefs.includes(ref) ? canonicalSlug : ref
          );
          await updateNodeFile(node, { reduces_to: newReducesTo });
        }
      }

      // Run validate
      console.log("Running validation...");
      const updatedNodes = await loadAllNodes(vaultPath);
      const masterTags = await loadTags(vaultPath);
      const issues = validateGraph(updatedNodes, masterTags);
      if (issues.length > 0) {
        console.error("Validation issues found:");
        for (const issue of issues) {
          console.error(`  ${issue.slug}: ${issue.message}`);
        }
        throw new Error("Validation failed after merge");
      }

      // Git commit
      if (autoCommit) {
        const commitMsg = `Merge ${oldNodes.length} nodes into ${canonicalSlug}: ${title}`;
        await gitCommitIfEnabled(vaultPath, commitMsg, true);
      }

      console.log(`Successfully merged ${oldNodes.length} nodes into ${canonicalSlug}`);

    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}

function makeUndoCommand(): CommanderCommand {
  const cmd = new Command("undo")
    .description(`Undo a merge operation and restore all original nodes.

This completely reverses a merge, restoring the lattice to its pre-merge state.
The canonical node is moved to 99-Trash/Undone-Merges/, and all original nodes
are restored to their original locations with original metadata.

WHAT HAPPENS:
1. Validates the node was actually merged (has merged_from metadata)
2. Moves canonical node to 99-Trash/Undone-Merges/ with undo reason
3. Restores all trashed nodes to original paths
4. Clears merge-related metadata from restored nodes
5. Rewrites reduces_to references back to oldest restored node
6. Validates lattice integrity

SAFETY FEATURES:
- Complete restoration of original state
- Audit trail of undo operation
- Reference rewriting to maintain DAG structure
- Validation after undo

WHEN TO USE:
- When you realize a merge was incorrect
- When better consolidation is possible
- When original nodes had important distinctions

EXAMPLES:
  # Undo a specific merge
  lattice dedup undo merged-node-slug --reason "Better consolidation possible"

  # Preview undo
  lattice dedup undo merged-node-slug --dry-run

  # Undo with auto-commit
  lattice dedup undo merged-node-slug --reason "Mistake" --auto-commit`)
    .argument("<canonicalSlug>", "Slug of the merged canonical node to undo")
    .option("--reason <text>", "Reason for undoing this merge")
    .option("--dry-run", "Show what would be done without making changes")
    .option("--auto-commit", "Automatically commit to git if vault is in repo");

  cmd.action(async (canonicalSlug, opts) => {
    try {
      const parentOpts = cmd.parent!.parent!.opts() as any;
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);

      const reason: string | undefined = opts.reason;
      const dryRun: boolean = opts.dryRun;
      const autoCommit: boolean = opts.autoCommit;

      const nodes = await loadAllNodes(vaultPath);

      const canonicalNode = nodes.get(canonicalSlug);
      if (!canonicalNode) {
        throw new Error(`Canonical node not found: ${canonicalSlug}`);
      }

      if (!canonicalNode.merged_from || canonicalNode.merged_from.length === 0) {
        throw new Error(`Node ${canonicalSlug} is not a merged node`);
      }

      // Warn for axiom/percept undos
      if ((canonicalNode.level === "axiom" || canonicalNode.level === "percept") && !dryRun) {
        console.error("Warning: Undoing merge of bedrock nodes (axiom/percept). Proceed only if certain.");
      }

      if (dryRun) {
        console.log(`Would undo merge of ${canonicalSlug} (${canonicalNode.title})`);
        console.log(`Would restore ${canonicalNode.merged_from.length} nodes:`);
        for (const entry of canonicalNode.merged_from) {
          console.log(`  - ${entry.id} to ${entry.original_path}`);
        }
        console.log(`Would move canonical node to 99-Trash/Undone-Merges/`);
        return;
      }

      // Create undone merges folder
      const undoneDir = join(vaultPath, "99-Trash", "Undone-Merges");
      await mkdir(undoneDir, { recursive: true });

      // Move canonical node to undone
      const undonePath = join(undoneDir, basename(canonicalNode.filePath));
      await updateNodeFile(canonicalNode, {
        undone_merge: { reason },
      });
      await rename(canonicalNode.filePath, undonePath);

      // Restore each merged node
      let oldestNodeId = canonicalNode.merged_from[0].id; // Default to first
      for (const entry of canonicalNode.merged_from) {
        // Move back from trash
        await rename(entry.trashed_path, entry.original_path);

        // Reload the node (since path changed)
        const restoredNodes = await loadAllNodes(vaultPath);
        const restoredNode = restoredNodes.get(entry.id);
        if (!restoredNode) {
          throw new Error(`Failed to restore node: ${entry.id}`);
        }

        // Restore original status and remove merge fields
        await updateNodeFile(restoredNode, {
          status: entry.original_status,
          merged_into: undefined,
          trashed_on: undefined,
          original_status: undefined,
          original_path: undefined,
          deduplication_group: undefined,
        });

        // Find oldest by creation date
        const oldestNode = restoredNodes.get(oldestNodeId);
        if (restoredNode.created < oldestNode!.created) {
          oldestNodeId = entry.id;
        }
      }

      // Rewrite reduces_to references back to oldest node
      for (const node of nodes.values()) {
        if (node.reduces_to.includes(canonicalSlug)) {
          const newReducesTo = node.reduces_to.map(ref =>
            ref === canonicalSlug ? oldestNodeId : ref
          );
          await updateNodeFile(node, { reduces_to: newReducesTo });
        }
      }

      // Run validate
      console.log("Running validation...");
      const updatedNodes = await loadAllNodes(vaultPath);
      const masterTags = await loadTags(vaultPath);
      const issues = validateGraph(updatedNodes, masterTags);
      if (issues.length > 0) {
        console.error("Validation issues found:");
        for (const issue of issues) {
          console.error(`  ${issue.slug}: ${issue.message}`);
        }
        throw new Error("Validation failed after undo");
      }

      // Git commit
      if (autoCommit) {
        const commitMsg = `Undo merge of ${canonicalSlug}: ${canonicalNode.title}`;
        await gitCommitIfEnabled(vaultPath, commitMsg, true);
      }

      console.log(`Successfully undid merge of ${canonicalSlug}`);

    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}