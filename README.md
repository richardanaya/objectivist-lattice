<div align="center"><img width="400" alt="Objectivist Knowledge Lattice" src="https://github.com/user-attachments/assets/301246a2-4848-4f32-a957-5fca9457ac42" /></div>


# Objectivist Knowledge Lattice

A CLI that enforces axiom/percept → principle → application hierarchy on a filesystem of Markdown files. Zettelkasten corrected by reality. No floating abstractions allowed.

Designed for LLM agents and rational humans pursuing epistemological hygiene.

## Install

```bash
npm install -g objectivist-lattice
```

Binary name: `lattice`

## Quick Start

```bash
# Initialize a vault in the current directory
lattice init

# Add an axiom (philosophical bedrock — no reduces_to)
lattice add --level axiom \
  --title "A is A" \
  --proposition "A thing is what it is and cannot be what it is not." \
  --tags "learning"

# Add a percept (empirical bedrock — no reduces_to)
lattice add --level percept \
  --title "Ball falls when dropped" \
  --proposition "Dropping a ball results in it falling every time."

# Add a principle reducing to the axiom and percept (starts Tentative)
lattice add --level principle \
  --title "Causality is identity applied to action" \
  --proposition "Entities act according to their nature." \
  -r 202602221400-a-is-a \
  -r 202602221400-ball-falls-when-dropped \
  --tags "decisions,ethics"

# Promote the principle once satisfied (parents are bedrock — already validated)
lattice update causality-is-identity --status "Integrated/Validated"

# Add an application reducing to the now-validated principle
lattice add --level application \
  --title "Homework before games every day" \
  --proposition "Every school night finish homework before games." \
  -r 202602221400-causality-is-identity-applied-to-action \
  --tags "productivity,habits" \
  --status "Integrated/Validated"

# Walk the full reduction chain
lattice query chain homework-before-games --table

# Validate the entire vault
lattice validate
```

## What This Is

A filesystem-based directed acyclic graph (DAG) of knowledge nodes. Each node is a Markdown file with YAML frontmatter, organized in strict reduction levels:

| Level | Folder | Description |
|-------|--------|-------------|
| axiom | `01-Axioms/` | Self-evident philosophical bedrock |
| percept | `02-Percepts/` | Raw sensory/empirical facts |
| principle | `03-Principles/` | Induced general rules |
| application | `04-Applications/` | Deduced concrete actions |

Axioms and percepts are **co-equal bedrock** — neither reduces to the other. Principles and applications must have `reduces_to` links pointing to nodes at a lower rank. Break the spine and the node is quarantined as `Tentative/Hypothesis`.

## Data Model

### Node File

Filename: `YYYYMMDDHHMM-slugified-title.md` (slug max 60 chars)

```yaml
---
title: Causality is identity applied to action
level: principle
reduces_to:
  - 202602221400-a-is-a
status: Integrated/Validated
tags:
  - decisions
  - ethics
---

**Proposition:** Entities act according to their nature.
```

### Vault Structure

```
<vault>/
├── 01-Axioms/
├── 02-Percepts/
├── 03-Principles/
├── 04-Applications/
├── tags.json              # Master tag list
├── Templates/New-Node.md  # Skeleton for Obsidian
└── .lattice               # Vault marker
```

### Validation Rules

- Axioms have no `reduces_to` links (philosophical bedrock — irreducible)
- Percepts have no `reduces_to` links (empirical bedrock — irreducible)
- Axioms and percepts are always `Integrated/Validated` — no status lifecycle. Their presence in the vault is their validation. `--status` is ignored for them on `add`; rejected on `update`.
- Principles reduce to axioms and/or percepts
- Applications reduce to principles (and/or axioms/percepts)
- A principle or application cannot be promoted to `Integrated/Validated` unless all of its direct `reduces_to` parents are already `Integrated/Validated`. Promote bottom-up.
- Cross-bedrock reduction (axiom → percept or percept → axiom) is rejected
- Same-level reduction (principle → principle) is rejected
- Upward reduction is rejected
- Cycles are rejected
- Tags must exist in `tags.json`

## Output Formats

| Flag | Format | For |
|------|--------|-----|
| *(none)* | TOON | Default. LLM agents. 30-60% fewer tokens than JSON. |
| `--json` | JSON | Scripts, APIs, programmatic parsing. |
| `--table` | Table/Tree | Humans at a terminal. |

## Commands

### `lattice init`

Create vault structure at `--vault` path (default: `.`).

### `lattice add`

Create one node. Required: `--level`, `--title`, `--proposition`. Optional: `-r` (repeatable), `--tags`, `--status`.

`--status` is ignored for axiom/percept (always `Integrated/Validated`). For principles and applications, defaults to `Tentative/Hypothesis`. Cannot be set to `Integrated/Validated` if any parent is still `Tentative/Hypothesis`.

### `lattice query`

Subcommands:
- `applications [--tag <tag>]` — validated applications
- `principles [--tag <tag>]` — validated principles
- `chain <node>` — full backward reduction tree
- `tentative [--older-than <Nd>]` — stale Tentative nodes
- `tag <tag>` — all nodes with tag, grouped by level
- `hollow-chains` — validated nodes with a Tentative ancestor anywhere in their chain. Exit 1 if any found. Run alongside `validate` on every purge cycle.
- `related <query> [--limit N] [--depth N]` — multi-hop graph walk to find epistemically connected nodes. See below.

### `lattice update <node>`

Modify an existing node's status, tags, or `reduces_to` links. Primary use: promoting a principle or application from `Tentative/Hypothesis` to `Integrated/Validated` once you are satisfied its chain is sound. Promotion is rejected if any direct parent is still `Tentative/Hypothesis`. Status changes are rejected for axiom/percept nodes.

### `lattice validate`

Full integrity scan. `--fix-auto` deletes abandoned stale drafts. `--quiet` for exit code only.

### `lattice delete <node>`

Remove a node. Only Tentative or zero-incoming-links nodes. No confirmation.

### `lattice tags`

Subcommands:
- `list` — print master tag list
- `add <tag> --reason <node>` — add tag with justified reason
- `remove <tag>` — remove unused tag

## Memory Retrieval (`query related`)

`lattice query related` is the primary memory-lookup command for an AI agent during a conversation. It finds knowledge that is **epistemically connected** to a topic — not just nodes that share a tag or keyword, but nodes that share foundations, dependents, or ancestors anywhere in the graph.

### Why not just tag search?

Tag search only finds what was explicitly tagged at write time. Two principles about completely different topics may both reduce to the same axiom — they share no tag, no keyword, but they are in the same knowledge cluster. `related` finds that connection by walking the graph.

### Entry point resolution

`<query>` is resolved in order, stopping at the first match:

1. **Slug match** — partial/substring slug → single seed node
2. **Tag match** — all nodes tagged with that name → multiple seed nodes
3. **Title keyword** — substring match on titles → matching nodes as seeds

Multi-seed entry (via tag) is more powerful: nodes reachable from multiple seeds score higher, surfacing the connective tissue between clusters.

### The walk

From each seed, a **bidirectional BFS** expands in both directions simultaneously:
- **Down** — follows `reduces_to` toward bedrock ("what is this grounded in?")
- **Up** — follows incoming links toward dependents ("what is built on top of this?")

Every intermediate node hit along the way also expands in both directions, up to `--depth` hops (default: 3). This means reaching a shared axiom surfaces all other principles and applications that also rest on it — the cross-cluster connections that make the graph valuable.

### Scoring

Each discovered node is scored by:

| Factor | Weight | Rationale |
|--------|--------|-----------|
| `reach_count × 2.0` | High | Reachable from multiple seeds = connective tissue |
| `1.0 / min_distance` | Medium | Closer neighbours are more relevant |
| Validated status | +0.5 | Prefer grounded knowledge |
| Application level | +0.3 | Most directly actionable |
| Principle level | +0.2 | Second most actionable |

### Output fields

Each result includes:

- **`relationship`** — how this node connects to the entry point:
  - `ancestor` — reached by going purely down (it's in your foundation)
  - `dependent` — reached by going purely up (it's built on your entry point)
  - `sibling` — path went down then up (shares a common ancestor with your entry point)
- **`path`** — intermediate nodes on the shortest path from seed to this node. Empty if `distance=1`. Use this to understand *why* a node was surfaced without having to trace the graph manually.
- **`score`**, **`reach_count`**, **`min_distance`** — for ranking and debugging

### Example

```bash
# During a discussion about whether to rewrite a service:
$ lattice query related "rewrite" --table

Entry: slug match: "20260303-require-two-week-spike-before-committing-to-a-rewrite"
Related nodes (top 5, depth=3):

1. [score 3.7] ✓ principle: Irreversible decisions require higher evidence thresholds
   relationship=ancestor  distance=1  reach=1

2. [score 3.03] ✓ principle: Refactoring without tests multiplies defects
   relationship=sibling  distance=3  reach=1
   via: axiom(A is A) → application(Never refactor without full test coverage first)

3. [score 3.0] ✓ axiom: A is A
   relationship=ancestor  distance=2  reach=1
```

Result 2 was surfaced even though "refactoring" shares no tag with "rewrite" — both principles share the axiom `A is A` as a common foundation, making them siblings in the same knowledge cluster.

### Agent memory lookup workflow

```bash
# 1. Enter via the closest known concept (slug or partial title)
lattice query related "the topic being discussed" --json

# 2. If results are too narrow, broaden to a tag
lattice query related career --depth 3 --limit 10 --json

# 3. For any promising result, walk its full chain to verify it's grounded
lattice query chain <slug> --json
```

## Purge Agent

A purge agent is a cron job whose sole mandate is epistemic hygiene: surface weak nodes, delete obvious garbage, never make judgment calls.

**Cadence: weekly.** The 14-day `--fix-auto` threshold is the binding constraint — running more often finds nothing new eligible for deletion. Run Sunday night so results are available for Monday review.

```bash
#!/usr/bin/env bash
# purge-agent.sh

set -euo pipefail
VAULT="${LATTICE_VAULT:-.}"

# 1. Structural integrity — stop and alert if exit 1
lattice --vault "$VAULT" validate --json

# 2. Hollow chains — validated nodes with a Tentative ancestor anywhere in their chain.
#    'lattice validate' will NOT catch these: the chain is structurally intact
#    but epistemically hollow (a parent was demoted after the child was validated).
#    Output for human review: re-validate the weak link, or demote the hollow node.
lattice --vault "$VAULT" query hollow-chains --json

# 3. Stale tentatives approaching threshold — 7-day warning before 14-day auto-delete.
#    Surface for review: ground them now or delete manually before they age out.
lattice --vault "$VAULT" query tentative --older-than 7d --json

# 4. Preview auto-deletion — always log before deleting
lattice --vault "$VAULT" validate --fix-auto --dry-run --json

# 5. Execute — only deletes Tentative + zero reduces_to + older than 14 days
lattice --vault "$VAULT" validate --fix-auto --json
```

### What the purge agent does and does not do

| Does | Does not |
|------|----------|
| Delete abandoned drafts (Tentative, no chain, >14d) | Demote validated nodes |
| Surface hollow chains for review | Delete nodes with partial chains |
| Surface stale tentatives approaching threshold | Promote anything |
| Log a dry-run before every deletion | Skip the dry-run step |

### hollow-chains vs validate

`lattice validate` catches structural problems: broken links, cycles, missing `reduces_to`. It will **not** catch a validated node whose parent was demoted after promotion — the link exists, so structurally it looks fine.

`lattice query hollow-chains` catches the epistemic problem: a node is marked `Integrated/Validated` but somewhere in its full ancestor chain there is a `Tentative/Hypothesis` node. Exit 1 if any found.

Run both on every purge cycle.

## Global Options

```
-v, --vault <path>   Vault root (default: current directory)
--json               JSON output
--table              Human-readable output
-h, --help           Help (LLM-optimized with examples)
-V, --version        Version
```

## Default Tags

```
career, communication, creativity, decisions, emotions, ethics,
failure, family, fitness, friendships, goals, habits, health,
learning, money, productivity, relationships, risk, self-knowledge, success
```

## Obsidian Compatibility

The vault is a valid Obsidian vault. Open it in Obsidian for graph view and visual browsing. The `reduces_to` values are plain slugs (not `[[]]` wiki-links), so Obsidian won't auto-link them — the CLI is the primary interface.

## Future Ideas

These are not implemented. They are documented here for future development.

### Contradiction Detection (`opposes` field)

Add an optional `opposes` YAML field to nodes:

```yaml
opposes:
  - 202602221500-some-opposing-principle
```

A `lattice query contradicts <principle>` command would traverse these links to surface contradictions. This requires propositional logic checking or LLM-assisted comparison, but the graph structure (walk `opposes` edges) is trivial.

### LLM-Assisted Contradiction Detection

On `lattice add`, run the new proposition through an LLM comparing it against existing validated principles. Flag potential contradictions automatically. Always auditable — the LLM suggests, the human/agent confirms.

### Obsidian Plugin Integration

Convert `reduces_to` slugs to `[[]]` wiki-links in real-time for Obsidian graph view. Or build a custom Obsidian plugin that reads the YAML and renders the reduction spine visually with level-colored nodes.

### Neo4j / Memgraph Export

`lattice export --format neo4j` generates Cypher `CREATE` statements. Nodes get `level` property, `REDUCES_TO` typed relationships. Cypher chain traversal queries become trivial for large-scale analysis.

### Vector Embeddings for Fuzzy Search

Add vector embeddings (via OpenAI, Ollama, etc.) alongside the typed graph. Use for "find related concepts" queries. Never trust embeddings for reduction validation — those stay in the typed graph. Embeddings are discovery, not proof.

### Weighted Reduction Links

Add a `directness` weight to `reduces_to` links indicating how directly the parent validates the child. Useful for ranking reduction paths when multiple chains exist.

### Merge/Split Commands

`lattice merge <node1> <node2>` — combine two nodes into one, updating all incoming links.
`lattice split <node>` — break a node into multiple atomic propositions.

### Import from Obsidian/Logseq

`lattice import --from obsidian <vault-path>` — parse existing Obsidian notes, attempt to classify by level, and generate reduction chains as `Tentative/Hypothesis` for human review.

## License

MIT
