# Objectivist Knowledge Lattice — Video Script

*5-minute slideshow. Each slide heading is the visual. Speaker notes below each.*

---

## SLIDE 1: The Problem With AI Memory

> "AI agents forget. Or worse — they remember wrong."

Every time an LLM agent runs, it starts fresh. So developers give it memory: a database of facts, a vector store, a notepad of past conclusions. The agent writes things down. It reads them back later.

But here's the problem nobody talks about: **the agent has no way to know which of those stored beliefs are actually true.**

It saved "always rewrite from scratch" after one bad refactoring session. It saved "users don't care about load time" after one misleading A/B test. Now it acts on those beliefs — confidently, repeatedly — with no way to verify whether they were ever grounded in reality in the first place.

This is not a retrieval problem. It's an epistemology problem.

---

## SLIDE 2: Knowledge Is Not a Flat List

> "A belief is only as strong as what it's built on."

Most memory systems store knowledge as a flat list of assertions. There's no structure. No hierarchy. No way to ask: "where did this come from?"

The Objectivist Knowledge Lattice takes a different approach. Every piece of knowledge has a **level**, and higher levels must reduce to lower ones. No exceptions.

- **Axioms** — self-evident philosophical truths. Things that cannot be denied without using themselves. *"Code does what it contains, not what you intended."*
- **Percepts** — directly observed facts. Raw, uninterpreted, timestamped. *"On March 3rd, this deploy caused a 47-minute outage."*
- **Principles** — general rules induced from axioms and percepts. *"Untested code will exhibit its defects in production."*
- **Applications** — concrete decisions deduced from principles. *"Run the full test suite before every deploy. No exceptions."*

Axioms and percepts are the bedrock. They can't be reduced further. Everything above them must trace back down.

---

## SLIDE 3: The Reduction Chain Is the Proof

> "Why do you believe that?"

This is the question that breaks most AI systems. They don't know why. They just... do.

With the lattice, every non-bedrock node carries `reduces_to` links pointing to its parents. You can walk any belief all the way back to what was actually observed.

```
application: Run full test suite before every deploy
  └─ principle: Untested code will exhibit its defects in production
       ├─ axiom: Code behaves according to what it contains
       └─ percept: Deploy without tests crashed prod on March 3
```

That chain is the **proof**. The axiom gives the conceptual why. The percept gives the empirical what. Both are bedrock — irreducible, always validated.

If you can't show a chain like this, the belief is quarantined as `Tentative/Hypothesis`. The CLI enforces this. You cannot promote a node to `Integrated/Validated` unless every node in its chain is already validated. The system won't let you build on sand.

---

## SLIDE 4: What the CLI Actually Does

> "Four operations. That's it."

The `lattice` CLI manages a vault of Markdown files — one file per belief, YAML frontmatter for metadata, human-readable, Obsidian-compatible.

**Write:**
```bash
lattice add --level percept --title "API returned 500 on null input" ...
lattice add --level principle --title "Null must be validated at boundary" -r <percept-slug> ...
lattice update <principle> --status "Integrated/Validated"
```

**Read:**
```bash
lattice query chain <belief>      # Why do I believe this?
lattice query related <topic>     # What do I know connected to this?
lattice query applications        # What should I do?
```

**Validate:**
```bash
lattice validate                  # Is the vault structurally sound?
lattice query hollow-chains       # Are any validated beliefs now hollow?
```

**Purge:**
```bash
lattice validate --fix-auto       # Delete abandoned drafts older than 14 days
```

The output is TOON by default — a compact format designed for LLM consumption, 30–60% fewer tokens than JSON. Agents read it efficiently. Humans use `--table`.

---

## SLIDE 5: Two Agents, One Vault

> "A builder agent. A purge agent. Running in parallel."

This is the intended deployment pattern.

The **builder agent** runs continuously — during conversations, during task execution, after any significant observation or decision. It adds percepts when it observes something. It induces principles when it sees patterns. It promotes beliefs only after verifying the chain. It consults `query related` before acting, to surface what it already knows.

The **purge agent** runs weekly. Its job is epistemic hygiene: find beliefs that were validated but are now hollow because a parent was demoted. Find abandoned drafts that were never grounded. Delete the obvious garbage. Surface the rest for review. It never makes judgment calls. It never promotes. It never demotes without human review.

Together they maintain a knowledge base where every surviving belief has a traceable chain to reality. Not a flat list of assertions. Not confabulated conclusions. A lattice — where the structure itself is the proof.

---

*`lattice --help` for full documentation.*
