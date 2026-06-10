#!/usr/bin/env node
'use strict';

// viewer-server — the viewer_server hook feature's SessionStart side (PRD-008,
// ADR-0007 step 1; rides the ADR-0006 toggle plumbing, default OFF in the template).
// On SessionStart it derives this repo's port from a hash of the repo path, probes
// for an already-running instance of our daemon (identified by the health endpoint
// echoing the repo path — idempotent start), spawns viewer-server-daemon.js detached
// when none answers, writes the {port, pid, repo, started} discovery record, and
// surfaces the page URL as additionalContext. Every firing logs one invocation
// record via hook-lib (CODE_STANDARDS ## Hooks). FAIL SAFE: any missing/malformed
// config, busy port range, or internal error exits 0 with no output (ADR-0006) —
// a viewer problem never blocks a session; doctor surfaces decay.

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const lib = require('./hook-lib');
const rules = require('./viewer-server-rules');

const FEATURE = 'viewer_server';
const DAEMON_SCRIPT = path.join(__dirname, 'viewer-server-daemon.js');

// Identity and event name for the invocation log (CODE_STANDARDS ## Hooks); the
// event matches this script's settings.json wiring.
const SCRIPT_NAME = path.basename(__filename);
const HOOK_EVENT = 'SessionStart';

/**
 * Hash a repo path into its home port in the quiet range. djb2 over the absolute
 * path — stable across sessions so the same repo always lands on the same port.
 * @param {string} repoPath - absolute Instance root.
 * @returns {number} a port in [PORT_RANGE_START, PORT_RANGE_START + PORT_RANGE_SIZE).
 */
function homePort(repoPath) {
  let hash = rules.DJB2_SEED;
  for (let i = 0; i < repoPath.length; i += 1) {
    hash = ((hash * rules.DJB2_MULTIPLIER) ^ repoPath.charCodeAt(i)) >>> 0; // eslint-disable-line no-bitwise
  }
  return rules.PORT_RANGE_START + (hash % rules.PORT_RANGE_SIZE);
}

/**
 * Probe one port's health endpoint.
 * @param {number} port - port to probe on the loopback host.
 * @returns {Promise<{state: 'ours', body: object}|{state: 'foreign'}|{state: 'free'}>}
 * 'ours' when our daemon answers (body is its health JSON), 'foreign' when something
 * answers that is not our daemon, 'free' when nothing answers (refused/timeout).
 */
function probePort(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: rules.BIND_HOST, port, path: rules.HEALTH_PATH, timeout: rules.PROBE_TIMEOUT_MS },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          try {
            const body = JSON.parse(raw);
            // Our daemon and only our daemon serves this shape at this path.
            if (response.statusCode === rules.HTTP_OK && body && typeof body.repo === 'string') {
              resolve({ state: 'ours', body });
              return;
            }
          } catch {
            // Non-JSON answer: some other process owns the port.
          }
          resolve({ state: 'foreign' });
        });
        response.on('error', () => resolve({ state: 'foreign' }));
      }
    );
    // A listener that accepts but never answers within the budget reads as foreign:
    // it exists (so the port is taken) but it is not our fast health endpoint.
    request.on('timeout', () => { request.destroy(); resolve({ state: 'foreign' }); });
    request.on('error', () => resolve({ state: 'free' }));
  });
}

/**
 * Record the live server in the discovery file and emit the page URL into the
 * session as SessionStart additionalContext.
 * @param {string} repoPath - absolute Instance root.
 * @param {number} port - port the daemon is serving on.
 * @param {number} pid - the daemon's pid.
 * @returns {void}
 * @throws Propagates fs errors into main's fail-safe catch.
 */
function announce(repoPath, port, pid) {
  lib.atomicWriteJson(path.join(repoPath, rules.RECORD_RELATIVE_PATH), {
    schema_version: rules.RECORD_SCHEMA_VERSION,
    port,
    pid,
    repo: repoPath,
    started: new Date().toISOString(),
  });
  const url = `http://${rules.BIND_HOST}:${port}/`;
  lib.emit({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      additionalContext: rules.CONTEXT_TEMPLATE.replace(rules.CONTEXT_URL_PLACEHOLDER, url),
    },
  });
}

/**
 * Spawn the daemon detached on a port and poll its health endpoint until it answers.
 * @param {string} repoPath - absolute Instance root the daemon will serve.
 * @param {number} port - port to bind.
 * @returns {Promise<number|null>} the daemon's pid once healthy, or null when it
 * never answered within the poll budget (caller fails safe).
 */
async function spawnDaemon(repoPath, port) {
  const child = spawn(
    process.execPath,
    [DAEMON_SCRIPT, '--root', repoPath, '--port', String(port)],
    { detached: true, stdio: 'ignore' }
  );
  child.unref(); // the daemon outlives this hook; idle self-exit reaps it later
  for (let attempt = 0; attempt < rules.SPAWN_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, rules.SPAWN_POLL_INTERVAL_MS));
    const probe = await probePort(port);
    if (probe.state === 'ours' && probe.body.repo === repoPath) return probe.body.pid;
    if (probe.state === 'foreign') return null; // lost the port race to someone else
  }
  return null;
}

/**
 * Find or start this repo's server: walk up from the home port past foreign
 * listeners, reuse our own live daemon when one answers, spawn on the first free
 * port otherwise.
 * @param {string} repoPath - absolute Instance root.
 * @returns {Promise<{port: number, pid: number}|null>} the live server, or null when
 * the probe budget ran out (caller fails safe).
 */
async function ensureServer(repoPath) {
  let port = homePort(repoPath);
  for (let attempt = 0; attempt < rules.PORT_PROBE_LIMIT; attempt += 1) {
    const probe = await probePort(port);
    if (probe.state === 'ours' && probe.body.repo === repoPath) {
      return { port, pid: probe.body.pid }; // idempotent start: reuse the live daemon
    }
    if (probe.state === 'free') {
      const pid = await spawnDaemon(repoPath, port);
      if (pid !== null) return { port, pid };
    }
    // Foreign listener, our daemon for a *different* repo (hash collision), or a
    // lost spawn race: try the next port up.
    port += 1;
  }
  return null;
}

/**
 * Entry point: read the payload, check the toggle, ensure the server, announce it.
 * Every path — including thrown errors — logs exactly one invocation record
 * (CODE_STANDARDS ## Hooks) and exits 0 (fail safe, ADR-0006). An exhausted probe
 * budget (no server ensured) logs `error`: the enabled feature failed to deliver,
 * and it was swallowed.
 * @returns {Promise<void>}
 */
async function main() {
  let projectRoot = process.cwd();
  let outcome = lib.OUTCOME_ERROR;
  try {
    const payload = lib.readPayload();
    if (payload) {
      projectRoot = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
      if (!lib.featureEnabled(projectRoot, FEATURE)) {
        outcome = lib.OUTCOME_DISABLED;
      } else {
        const server = await ensureServer(path.resolve(projectRoot));
        if (server) {
          announce(path.resolve(projectRoot), server.port, server.pid);
          outcome = lib.OUTCOME_OK;
        } else {
          outcome = lib.OUTCOME_ERROR; // probe budget exhausted — swallowed failure
        }
      }
    }
  } catch {
    outcome = lib.OUTCOME_ERROR; // fail safe: a viewer problem never blocks a session
  }
  lib.logInvocation(projectRoot, SCRIPT_NAME, HOOK_EVENT, outcome);
  process.exit(0);
}

main();
