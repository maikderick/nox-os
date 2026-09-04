import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

try {
  process.loadEnvFile?.(".env");
} catch {
  // The error below explains the missing configuration in terms of what this
  // command actually needs.
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

const configuredUrl = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000");
const preferredPort = Number(process.env.PORT || configuredUrl.port || 3000);
if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65_535) {
  throw new Error("PORT precisa ser uma porta TCP vÃ¡lida.");
}

let port = preferredPort;
while (!(await portIsAvailable(port))) {
  port += 1;
  if (port > Math.min(preferredPort + 20, 65_535)) {
    throw new Error(`Nenhuma porta livre encontrada entre ${preferredPort} e ${port}.`);
  }
}

const baseUrl = `http://localhost:${port}`;
process.env.PORT = String(port);
process.env.NEXTAUTH_URL = baseUrl;
// Development may be started before setup. A process-local secret still keeps
// the route closed and is inherited by the Next child; setup persists one.
const cronSecret = process.env.CRON_SECRET ?? randomBytes(48).toString("base64url");
process.env.CRON_SECRET = cronSecret;

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Execute com `npm run dev:all`.");

if (port !== preferredPort) {
  process.stdout.write(`[web] porta ${preferredPort} ocupada; usando ${baseUrl}\n`);
} else {
  process.stdout.write(`[web] ${baseUrl}\n`);
}

const web = spawn(process.execPath, [npmCli, "run", "dev", "--", "--port", String(port)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: false,
});

let stopped = false;
let running = false;

async function tick() {
  if (stopped || running) return;
  running = true;
  try {
    const response = await fetch(`${baseUrl}/api/jobs/run`, {
      headers: { authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(250_000),
    });
    if (!response.ok && response.status !== 404) {
      process.stderr.write(`[fila] consumidor respondeu ${response.status}\n`);
    }
  } catch (error) {
    // During startup the server is expected to refuse connections briefly.
    if (!stopped && web.exitCode !== null) {
      process.stderr.write(`[fila] servidor indisponível: ${error instanceof Error ? error.message : "erro"}\n`);
    }
  } finally {
    running = false;
  }
}

const timer = setInterval(tick, 5_000);
timer.unref();
setTimeout(tick, 2_000).unref();

function stop(signal) {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  if (web.exitCode === null) web.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
web.on("exit", (code) => {
  stopped = true;
  clearInterval(timer);
  process.exitCode = code ?? 1;
});
