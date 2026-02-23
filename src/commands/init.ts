import { Command } from "commander";
import {
  resolveVaultPath,
  isVaultInitialized,
  initializeVault,
} from "../core/vault.js";
import { handleError } from "../util/cli-helpers.js";

export function makeInitCommand(): Command {
  const cmd = new Command("init");

  cmd
    .description("Create a new lattice vault (folders + tags.json + templates)")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Creates the vault — the directory where all your knowledge nodes live.
  This is always the first command you run. Every other command requires
  an initialized vault and will fail with exit 2 if one does not exist.

  The vault is a plain directory of Markdown files organized by epistemic
  level. It is compatible with Obsidian, VS Code, or any text editor.

  Created structure:
    <vault>/
    ├── 01-Percepts/       Where observed facts go (level 0 — the base)
    ├── 02-Axioms/         Where self-evident truths go (level 1)
    ├── 03-Principles/     Where induced general rules go (level 2)
    ├── 04-Applications/   Where concrete decisions go (level 3)
    ├── tags.json          Master tag list (20 defaults, machine-readable)
    ├── Tags.md            Same list, human-readable (auto-generated)
    ├── Templates/         Obsidian template skeleton
    └── .lattice           Marker file proving the vault is initialized

  Idempotent: safe to run multiple times. Never overwrites existing files.
  If someone deletes a folder, re-running init recreates only what is missing.

OUTPUT:
  "Initialized lattice vault at <path>"   — first time
  "Vault already initialized at <path>"   — subsequent runs

EXAMPLES:

  Start a new knowledge base in the current directory:
    $ lattice init

  Start a knowledge base at a specific path:
    $ lattice --vault ~/agent-knowledge init

  After init, immediately add your first observation:
    $ lattice add --level percept --title "Project uses React 18" \\
        --proposition "package.json shows react@18.2.0 as dependency."
`,
    );

  cmd.action(async () => {
    try {
      const vaultPath = resolveVaultPath(
        cmd.parent?.opts().vault ?? ".",
      );
      const alreadyInit = await isVaultInitialized(vaultPath);

      await initializeVault(vaultPath);

      if (alreadyInit) {
        process.stdout.write(
          `Vault already initialized at ${vaultPath}\n`,
        );
      } else {
        process.stdout.write(
          `Initialized lattice vault at ${vaultPath}\n`,
        );
      }
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}
