#!/usr/bin/env node
'use strict';

// viewer-server-daemon — the viewer_server feature's server side (PRD-008, ADR-0007
// step 1). A zero-dependency node:http static server the SessionStart hook spawns
// detached: binds loopback only, answers GET only, and serves nothing outside the
// whitelist (viewer assets + .excn JSON — repos can hold credentials, ADR-0007).
// Orphan prevention is idle self-exit, never a shutdown hook: the process exits
// after IDLE_EXIT_MS without a request; the status page's polling counts as
// activity. /__viewer-server identifies the daemon to the hook (and doctor) by
// echoing {repo, pid, version}. Invocation (by viewer-server.js, not by hand):
//   node viewer-server-daemon.js --root <abs-repo> --port <n> [--idle-ms <n>]
// --idle-ms overrides the idle threshold; it exists for behavioral testing of the
// self-exit and has no production caller.

const fs = require('fs');
const http = require('http');
const path = require('path');
const rules = require('./viewer-server-rules');

// Where a stamped Instance records its framework version; echoed in health output.
const VERSION_MARKER_RELATIVE_PATH = '.excn/framework-version.json';
const UNKNOWN_VERSION = 'unknown';

// Success status is the shared rules.HTTP_OK (the hook's probe checks the same
// constant); these two are daemon-local error responses.
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;

/**
 * Read one required flag's value from argv.
 * @param {string} flag - the flag name, e.g. '--root'.
 * @returns {string|null} the value following the flag, or null when absent.
 */
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

/**
 * Read the Instance's stamped framework version for the health endpoint.
 * @param {string} root - absolute repo root.
 * @returns {string} the recorded version, or UNKNOWN_VERSION when unreadable.
 */
function frameworkVersion(root) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(root, VERSION_MARKER_RELATIVE_PATH), 'utf8'));
    return typeof marker.framework_version === 'string' ? marker.framework_version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION; // health still answers; doctor reports staleness elsewhere
  }
}

/**
 * Resolve a request path to a servable file, enforcing the whitelist and refusing
 * directory traversal: the URL is decoded, resolved against the root, prefix-checked
 * to still sit inside the root, and then its root-relative form must match a
 * whitelist pattern. The bare '/' maps to the viewer index.
 * @param {string} root - absolute repo root.
 * @param {string} urlPath - the request's pathname.
 * @returns {string|null} the absolute file path to serve, or null to 404.
 */
function resolveWhitelisted(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed escapes never reach the filesystem
  }
  const relativeRequest = decoded === '/' ? rules.INDEX_RELATIVE_PATH : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, relativeRequest);
  // Traversal guard: whatever ../ or absolute segments the URL carried, the resolved
  // target must remain inside the repo root.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  const rootRelative = path.relative(root, resolved).split(path.sep).join('/');
  if (!rules.PATH_WHITELIST.some((pattern) => pattern.test(rootRelative))) return null;
  return resolved;
}

/**
 * Build the request handler over a fixed root: health endpoint, GET-only, whitelist,
 * 404 everything else.
 * @param {string} root - absolute repo root.
 * @param {string} version - framework version echoed by the health endpoint.
 * @param {() => void} touch - called on every request to reset the idle clock.
 * @returns {(request: http.IncomingMessage, response: http.ServerResponse) => void}
 */
function makeHandler(root, version, touch) {
  return (request, response) => {
    touch(); // any request — including the page's polling — counts as activity
    if (request.method !== 'GET') {
      response.writeHead(HTTP_METHOD_NOT_ALLOWED, { Allow: 'GET', 'Content-Type': rules.ERROR_CONTENT_TYPE });
      response.end('GET only\n');
      return;
    }
    const urlPath = new URL(request.url, `http://${rules.BIND_HOST}`).pathname;
    if (urlPath === rules.HEALTH_PATH) {
      response.writeHead(rules.HTTP_OK, { 'Content-Type': rules.MIME_TYPES['.json'] });
      response.end(JSON.stringify({ repo: root, pid: process.pid, version }));
      return;
    }
    const filePath = resolveWhitelisted(root, urlPath);
    let body;
    try {
      body = filePath === null ? null : fs.readFileSync(filePath);
    } catch {
      body = null; // whitelisted but absent reads as not found, same as unlisted
    }
    if (body === null) {
      response.writeHead(HTTP_NOT_FOUND, { 'Content-Type': rules.ERROR_CONTENT_TYPE });
      response.end('not found\n');
      return;
    }
    const mime = rules.MIME_TYPES[path.extname(filePath)] || rules.DEFAULT_MIME_TYPE;
    response.writeHead(rules.HTTP_OK, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    response.end(body);
  };
}

/**
 * Entry point: parse args, serve, and arm the idle self-exit. Startup failures
 * (missing args, bind error) exit non-zero on stderr — this is a CLI process, not a
 * hook; the spawning hook's health polling absorbs the failure fail-safely.
 * @returns {void}
 */
function main() {
  const rootArg = argValue('--root');
  const portArg = argValue('--port');
  const port = Number(portArg);
  if (rootArg === null || !Number.isInteger(port)) {
    process.stderr.write('usage: viewer-server-daemon.js --root <abs-repo> --port <n> [--idle-ms <n>]\n');
    process.exit(1);
  }
  const root = path.resolve(rootArg);
  const idleArg = Number(argValue('--idle-ms'));
  const idleMs = Number.isInteger(idleArg) && idleArg > 0 ? idleArg : rules.IDLE_EXIT_MS;

  let lastRequestAt = Date.now();
  const server = http.createServer(
    makeHandler(root, frameworkVersion(root), () => { lastRequestAt = Date.now(); })
  );
  server.on('error', (cause) => {
    process.stderr.write(`error: cannot serve ${root} on ${rules.BIND_HOST}:${port}: ${cause.message}\n`);
    process.exit(1);
  });
  server.listen(port, rules.BIND_HOST);

  // Idle self-exit (ADR-0007): nothing depends on a clean session end, so a killed
  // session cannot leak this process — it reaps itself after a quiet period.
  const checkEveryMs = Math.min(idleMs, rules.IDLE_CHECK_INTERVAL_MS);
  setInterval(() => {
    if (Date.now() - lastRequestAt >= idleMs) process.exit(0);
  }, checkEveryMs);
}

main();
