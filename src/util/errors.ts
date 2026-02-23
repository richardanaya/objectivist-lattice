import { EXIT } from "../core/constants.js";

/**
 * Base error class for the lattice CLI.
 * Every LatticeError carries an exit code so the CLI can exit with the
 * correct status without catching-and-switching on error types.
 *
 * Error messages are short, exact, and actionable — no corporate fluff.
 * An LLM agent reading stderr should be able to fix the problem in one step.
 */
export class LatticeError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT.VALIDATION_ERROR) {
    super(message);
    this.name = "LatticeError";
    this.exitCode = exitCode;
  }
}

/** Vault not initialized. */
export class VaultNotInitializedError extends LatticeError {
  constructor(vaultPath: string) {
    super(
      `Vault not initialized at '${vaultPath}'. Run 'lattice init' first.`,
      EXIT.FILESYSTEM_ERROR,
    );
    this.name = "VaultNotInitializedError";
  }
}

/** Invalid reduction level. */
export class InvalidLevelError extends LatticeError {
  constructor(given: string) {
    super(
      `Invalid level '${given}'. Must be one of: percept, axiom, principle, application`,
      EXIT.BAD_INPUT,
    );
    this.name = "InvalidLevelError";
  }
}

/** Missing reduces_to on non-percept node. */
export class MissingReductionError extends LatticeError {
  constructor(level: string) {
    super(
      `Non-percept node (level: ${level}) requires at least one --reduces-to link`,
      EXIT.BAD_INPUT,
    );
    this.name = "MissingReductionError";
  }
}

/** reduces_to target not found in vault. */
export class TargetNotFoundError extends LatticeError {
  constructor(slug: string) {
    super(
      `Target node not found: ${slug}`,
      EXIT.VALIDATION_ERROR,
    );
    this.name = "TargetNotFoundError";
  }
}

/** Level mismatch in reduction (same-level or upward). */
export class LevelMismatchError extends LatticeError {
  constructor(sourceLevel: string, targetLevel: string) {
    super(
      `Level mismatch: ${sourceLevel} cannot reduce to ${targetLevel}`,
      EXIT.VALIDATION_ERROR,
    );
    this.name = "LevelMismatchError";
  }
}

/** Cycle detected in the reduction graph. */
export class CycleDetectedError extends LatticeError {
  constructor() {
    super(
      `Cycle detected: adding this link creates a loop in the reduction graph`,
      EXIT.VALIDATION_ERROR,
    );
    this.name = "CycleDetectedError";
  }
}

/** Tag not in master list. */
export class RogueTagError extends LatticeError {
  constructor(tag: string) {
    super(
      `Rogue tag '${tag}' not in tags.json`,
      EXIT.VALIDATION_ERROR,
    );
    this.name = "RogueTagError";
  }
}

/** Invalid status value. */
export class InvalidStatusError extends LatticeError {
  constructor(given: string) {
    super(
      `Invalid status '${given}'. Must be 'Integrated/Validated' or 'Tentative/Hypothesis'`,
      EXIT.BAD_INPUT,
    );
    this.name = "InvalidStatusError";
  }
}

/** Node cannot be deleted (has incoming links and is validated). */
export class DeleteBlockedError extends LatticeError {
  constructor(slug: string, incomingCount: number) {
    super(
      `Cannot delete '${slug}': ${incomingCount} other node(s) reduce to it and it is Integrated/Validated. Change status to Tentative/Hypothesis first or remove incoming links.`,
      EXIT.VALIDATION_ERROR,
    );
    this.name = "DeleteBlockedError";
  }
}

/** Filesystem-level error wrapper. */
export class FilesystemError extends LatticeError {
  constructor(message: string) {
    super(message, EXIT.FILESYSTEM_ERROR);
    this.name = "FilesystemError";
  }
}

/** Ambiguous node match — multiple nodes match the query. */
export class AmbiguousMatchError extends LatticeError {
  constructor(query: string, candidates: string[]) {
    const list = candidates.map((c) => `  - ${c}`).join("\n");
    super(
      `Ambiguous match for '${query}'. Multiple nodes match:\n${list}\nUse a more specific slug or the full slug to disambiguate.`,
      EXIT.BAD_INPUT,
    );
    this.name = "AmbiguousMatchError";
  }
}

/** Duplicate node slug already exists. */
export class DuplicateSlugError extends LatticeError {
  constructor(slug: string) {
    super(
      `Node with slug '${slug}' already exists`,
      EXIT.VALIDATION_ERROR,
    );
    this.name = "DuplicateSlugError";
  }
}
