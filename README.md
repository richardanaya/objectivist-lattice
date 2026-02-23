# Objectivist Knowledge Lattice

A CLI that enforces percept > axiom > principle > application hierarchy on a filesystem of Markdown files. Zettelkasten corrected by reality. No floating abstractions allowed.

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

# Add a percept (raw fact)
lattice add --level percept \
  --title "Ball falls when dropped" \
  --proposition "Dropping a ball results in it falling every time."

# Add an axiom reducing to the percept
lattice add --level axiom \
  --title "A is A" \
  --proposition "A thing is what it is and cannot be what it is not." \
  -r 202602221400-ball-falls-when-dropped \
  --tags "learning"

# Add a principle reducing to the axiom
lattice add --level principle \
  --title "Causality is identity applied to action" \
  --proposition "Entities act according to their nature." \
  -r 202602221400-a-is-a \
  --tags "decisions,ethics"

# Add an application reducing to the principle
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
| percept | `01-Percepts/` | Raw sensory/empirical facts |
| axiom | `02-Axioms/` | Self-evident base truths |
| principle | `03-Principles/` | Induced general rules |
| application | `04-Applications/` | Deduced concrete actions |

Every non-percept node must have `reduces_to` links pointing to nodes at a **lower** level. This is the reduction spine. Break it and the node is quarantined as `Tentative/Hypothesis`.

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
├── 01-Percepts/
├── 02-Axioms/
├── 03-Principles/
├── 04-Applications/
├── tags.json              # Machine-readable master tag list
├── Tags.md                # Human-readable (auto-generated)
├── Templates/New-Node.md  # Skeleton for Obsidian
└── .lattice               # Vault marker
```

### Validation Rules

- Percepts have no `reduces_to` links (they are the base)
- Axioms reduce only to percepts
- Principles reduce only to percepts or axioms
- Applications reduce to percepts, axioms, or principles
- Same-level or upward reduction is rejected
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

### `lattice query`

Subcommands:
- `applications [--tag <tag>]` — validated applications
- `principles [--tag <tag>]` — validated principles
- `chain <node>` — full backward reduction tree
- `tentative [--older-than <Nd>]` — stale Tentative nodes
- `tag <tag>` — all nodes with tag, grouped by level

### `lattice validate`

Full integrity scan. `--fix-auto` deletes abandoned stale drafts. `--quiet` for exit code only.

### `lattice delete <node>`

Remove a node. Only Tentative or zero-incoming-links nodes. No confirmation.

### `lattice tags`

Subcommands:
- `list` — print master tag list
- `add <tag> --reason <node>` — add tag with justified reason
- `remove <tag>` — remove unused tag

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
