/**
 * Preview dev server: sandbox-local Convex backend + Vite.
 *
 * This project's Convex deployment lives *inside* the sandbox — no cloud
 * deployment is provisioned — so the browser preview needs a backend that is
 * reachable on a publicly routable port. The sandbox exposes every listening
 * port as `https://<port>-<sandbox>.e2b.app`, and `VITE_CONVEX_URL` points at
 * the one below.
 *
 * Why the backend is started here instead of via `convex dev`:
 *
 *   1. `convex dev --once` (which the platform runs after a turn) exits and
 *      takes its local backend down with it, so nothing would be left serving
 *      the preview.
 *   2. A long-lived `convex dev` would hold the ports recorded in
 *      `.convex/local/.../config.json`, and `convex dev --once` refuses to start
 *      while a backend with the *same* instance name holds them.
 *
 * So the backend runs under a different instance name (`preview-local`), on the
 * ports the CLI itself recorded, which keeps `convex dev --once` working: it
 * sees "another" deployment and picks its own free ports.
 *
 * Two details make the browser side work:
 *
 *   - `auth.config.ts` reads `CONVEX_SITE_URL`, and the deployment resolves that
 *     when the config is pushed, so the stored OIDC domain is
 *     `http://127.0.0.1:<the site port the CLI used>`. Convex Auth signs session
 *     tokens with that same value as `iss` and only accepts a token whose issuer
 *     matches, so the backend must serve its site proxy on the port recorded in
 *     `config.json` — and re-bind whenever a push moves it.
 *   - The browser keeps talking to one stable public port (BROWSER_PORT) even
 *     when a push moves the deployment's cloud port, so `VITE_CONVEX_URL` never
 *     has to change. A tiny TCP forwarder bridges the two when they differ.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

const root = process.cwd();
const stateDir = path.join(root, ".convex", "local", "default");
const configPath = path.join(stateDir, "config.json");

/** Stable public port the preview browser talks to. */
const BROWSER_PORT = Number(process.env.PREVIEW_PUBLIC_PORT ?? 3210);
/** Public origin suffix for this sandbox, e.g. `abcd.e2b.app`. */
const publicSuffix = process.env.PREVIEW_PUBLIC_SUFFIX ?? "";
const instanceName = process.env.PREVIEW_CONVEX_INSTANCE ?? "preview-local";

const children = new Set();
let forwarding = null;
let forwardingTarget = null;
let shuttingDown = false;

function log(message) {
  console.log(`[preview-dev] ${message}`);
}

function publicOrigin(port) {
  return publicSuffix ? `https://${port}-${publicSuffix}` : `http://127.0.0.1:${port}`;
}

function readConfig() {
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const cloud = Number(config.ports?.cloud);
    const site = Number(config.ports?.site);
    if (!Number.isFinite(cloud) || !Number.isFinite(site)) return null;
    return { ...config, cloudPort: cloud, sitePort: site };
  } catch (error) {
    log(`could not read ${configPath}: ${error.message}`);
    return null;
  }
}

function backendBinary(version) {
  const override = process.env.CONVEX_BACKEND_BINARY;
  const candidates = [
    override,
    path.join(homedir(), ".cache", "convex", "binaries", version, "convex-local-backend"),
    path.join("/home/daytona", ".cache", "convex", "binaries", version, "convex-local-backend"),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

/** Current backend process, if any. */
let backend = null;
/** Ports the running backend is bound to. */
let backendPorts = null;

function stopBackend() {
  const child = backend;
  if (child === null) return;
  backend = null;
  backendPorts = null;
  children.delete(child);
  // Drop the exit listener: this stop is deliberate, not a crash to recover from.
  child.removeAllListeners("exit");
  child.kill("SIGTERM");
}

function startBackend() {
  const config = readConfig();
  if (config === null) {
    log("no .convex/local config yet — run `bun convex dev --once` first");
    return;
  }

  const binary = backendBinary(config.backendVersion);
  if (binary === null) {
    log(`Convex backend binary for ${config.backendVersion} is not downloaded yet`);
    return;
  }

  const child = spawn(
    binary,
    [
      "--port",
      String(config.cloudPort),
      "--site-proxy-port",
      String(config.sitePort),
      "--instance-name",
      instanceName,
      "--instance-secret",
      config.instanceSecret ?? "",
      "--local-storage",
      path.join(stateDir, "convex_local_storage"),
      // Public on purpose: this is what URLs handed to the browser are built from.
      "--convex-origin",
      publicOrigin(BROWSER_PORT),
      // Local on purpose: must match the OIDC domain baked into the deployment,
      // otherwise Convex Auth rejects every session token (issuer mismatch).
      "--convex-site",
      `http://127.0.0.1:${config.sitePort}`,
      "--beacon-tag",
      "cli-local-dev",
      path.join(stateDir, "convex_local_backend.sqlite3"),
    ],
    {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      // Keep the backend quiet: the managed preview reads the last port
      // mentioned in this command's output to decide which port is "the app",
      // and the backend's info logs announce its own port numbers.
      env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "error" },
    },
  );

  backend = child;
  backendPorts = { cloudPort: config.cloudPort, sitePort: config.sitePort };
  children.add(child);
  log(
    `Convex backend on ports ${config.cloudPort}/${config.sitePort} (pid ${child.pid}), public ${publicOrigin(BROWSER_PORT)}`,
  );

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (backend === child) {
      backend = null;
      // Clear the ports too, otherwise the next sync would consider the failed
      // start still current and skip restarting.
      backendPorts = null;
    }
    if (shuttingDown) return;
    log(`Convex backend exited (code ${code}, signal ${signal}) — retrying`);
    setTimeout(syncWithConfig, 2000);
  });

  child.on("error", (error) => {
    children.delete(child);
    log(`Convex backend failed to start: ${error.message}`);
  });
}

/**
 * Keeps BROWSER_PORT usable by the browser. When the deployment's cloud port is
 * already BROWSER_PORT the forwarder is unnecessary; otherwise pipe TCP (which
 * carries both the HTTP API and the WebSocket sync protocol) to it.
 */
function ensureForwarder(targetPort) {
  if (targetPort === BROWSER_PORT) {
    if (forwarding !== null) {
      forwarding.close();
      forwarding = null;
    }
    forwardingTarget = null;
    return;
  }
  if (forwarding !== null && forwardingTarget === targetPort) return;

  if (forwarding !== null) {
    forwarding.close();
    forwarding = null;
  }
  forwardingTarget = targetPort;

  forwarding = createServer((socket) => {
    const upstream = connect({ host: "127.0.0.1", port: targetPort });
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  forwarding.on("error", (error) => log(`forwarder error: ${error.message}`));
  forwarding.listen(BROWSER_PORT, "0.0.0.0", () => {
    log(`forwarding public ${publicOrigin(BROWSER_PORT)} → 127.0.0.1:${targetPort}`);
  });
}

/** Re-reads the config and re-points the backend when a push moved its ports. */
function syncWithConfig() {
  const config = readConfig();
  if (config === null) return;

  ensureForwarder(config.cloudPort);

  const unchanged =
    backendPorts !== null &&
    backendPorts.cloudPort === config.cloudPort &&
    backendPorts.sitePort === config.sitePort;
  if (unchanged) return;

  log(
    backendPorts === null
      ? "starting backend"
      : `backend ports moved to ${config.cloudPort}/${config.sitePort} — rebinding`,
  );
  if (backend !== null) stopBackend();
  startBackend();
}

function startVite() {
  const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) {
    log("vite is not installed — run the install command first");
    process.exit(1);
  }
  // `convex dev` rewrites VITE_CONVEX_URL in .env.local whenever it re-points the
  // deployment, so the public URL is injected for the app instead of read from
  // there: the browser must always talk to BROWSER_PORT, whatever ports the CLI
  // recorded last.
  const config = readConfig();
  const env = {
    ...process.env,
    VITE_CONVEX_URL: publicOrigin(BROWSER_PORT),
    VITE_CONVEX_SITE_URL: publicOrigin(config?.sitePort ?? BROWSER_PORT + 1),
  };
  const child = spawn(process.execPath, [vite], { cwd: root, stdio: "inherit", env });
  children.add(child);
  child.on("exit", (code) => {
    shuttingDown = true;
    for (const other of children) other.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (forwarding !== null) forwarding.close();
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 250);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// `convex dev --once` records the ports it used in config.json and re-points the
// backend here when a push moves them. Polling keeps this simple and avoids
// inotify semantics around file replacement; the read is a few hundred bytes.
setInterval(syncWithConfig, 3000);

// Backend first, then Vite, so the last port printed by this command is the
// app's own (Vite announces "Local: http://localhost:5173/").
syncWithConfig();
startVite();
