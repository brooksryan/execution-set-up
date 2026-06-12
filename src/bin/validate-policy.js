'use strict';

// to-execution validate-policy data — how the `validate` verb auto-detects which
// schema a work-tracking file should be checked against (EXEC-081). Data only, no
// logic: cli.js owns reading the file, running ajv, and reporting; this module owns
// the schema location and the detection signatures, so the detection rules read as a
// table rather than a tangle of conditionals.
//
// Invariants this data must hold:
// - SCHEMA_DIR_RELATIVE is relative to the package template (the bin ships beside it),
//   POSIX-separated; cli.js joins it onto the template dir. The npm-installed package
//   carries template/, so validation needs no Instance lookup and no ad-hoc install.
// - DETECTION_RULES are evaluated in order; the FIRST match wins, so a more specific
//   signature must precede a more general one that it would also satisfy (a PRD also
//   carries `issues`, so its `problem_statement` rule precedes the issue rule).
// - A rule matches when EITHER the parsed file is a top-level array and the rule sets
//   `topLevelArray`, OR the file is an object carrying every key in `requiredKeys`.
//   Detection is shape-based so it holds wherever the file sits; location only informs
//   which files an agent points the verb at.

// Where the canonical schemas ship, relative to the package template directory.
const SCHEMA_DIR_RELATIVE = '.excn/schemas';

// Ordered schema-detection table. `schema` is the schema file's basename in the schema
// dir; `topLevelArray` matches a bare-array file; `requiredKeys` matches an object that
// carries all of them. Order is significant (first match wins) — see the invariant.
const DETECTION_RULES = [
  // A bare array of gate/lifecycle entries — the only top-level-array artifact.
  { schema: 'verdict-ledger.schema.json', topLevelArray: true },
  // Sprint record: sprint_id is unique to it.
  { schema: 'sprint.schema.json', requiredKeys: ['sprint_id'] },
  // PRD: problem_statement is unique to it (and it also carries `issues`, so it must
  // precede the issue rule).
  { schema: 'prd.schema.json', requiredKeys: ['problem_statement'] },
  // Unit-of-work progress tracker: current_step + step_log distinguish it from the
  // bare verdict ledger and from load telemetry.
  { schema: 'progress.schema.json', requiredKeys: ['current_step', 'step_log'] },
  // Hook toggle config.
  { schema: 'hooks-config.schema.json', requiredKeys: ['features'] },
  // Load telemetry: a records array under a schema_version, no current_step.
  { schema: 'load-progress.schema.json', requiredKeys: ['schema_version', 'records'] },
  // Issue partition (backlog or a sprint's issues file): schema_version + issues, with
  // the more specific PRD rule already tried above.
  { schema: 'issue.schema.json', requiredKeys: ['schema_version', 'issues'] },
];

module.exports = { SCHEMA_DIR_RELATIVE, DETECTION_RULES };
