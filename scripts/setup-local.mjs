import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const dockerCommand = isWindows ? "docker.exe" : "docker";
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error("Execute este instalador por `npm run setup:local`.");

function run(command, args, { allowFailure = false, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
    shell: false,
  });

  if (result.error && !allowFailure) throw result.error;
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    throw new Error(`Falha ao executar: ${command} ${args.join(" ")}`);
  }

  return result;
}

function runNpm(args, options) {
  return run(process.execPath, [npmCli, ...args], options);
}

function runNpx(args, options) {
  return runNpm(["exec", "--", ...args], options);
}

function createLocalEnv() {
  if (existsSync(".env")) {
    let existing = readFileSync(".env", "utf8");
    if (!/^CRON_SECRET=/m.test(existing)) {
      appendFileSync(
        ".env",
        `\n# Consumidor local e agendador de produção\nCRON_SECRET="${randomBytes(48).toString("base64url")}"\n`,
        "utf8",
      );
      existing = readFileSync(".env", "utf8");
    }

    // This installer is explicitly local and the bootstrap below selects only
    // FALSO providers. Keeping the installation-wide kill switch at
    // "disabled" would make the UI promise a local simulation that the worker
    // is forbidden to run.
    const enabled = /^NOX_INTEGRATIONS=/m.test(existing)
      ? existing.replace(/^NOX_INTEGRATIONS=.*$/m, 'NOX_INTEGRATIONS="enabled"')
      : `${existing.replace(/\s*$/, "")}\nNOX_INTEGRATIONS="enabled"\n`;
    if (enabled !== existing) {
      writeFileSync(".env", enabled, "utf8");
    }
    return null;
  }

  const adminPassword = `Nox-${randomBytes(12).toString("base64url")}!`;
  const nextAuthSecret = randomBytes(48).toString("base64url");
  const cronSecret = randomBytes(48).toString("base64url");
  const contents = `# Gerado por npm run setup:local. Não versione este arquivo.
DATABASE_URL="postgresql://nox:nox@localhost:5432/nox_os?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="${nextAuthSecret}"
CRON_SECRET="${cronSecret}"

ADMIN_EMAIL="admin@noxos.local"
ADMIN_PASSWORD="${adminPassword}"

BRAND_NAME="NOX OS"
SELLER_NAME="Equipe NOX"
DEFAULT_CITY="Fortaleza/CE"
LEAD_GOAL="1000"
INITIAL_RADIUS_KM="5"
MAX_RADIUS_KM="80"
PRIVACY_EMAIL=""
PORTFOLIO_URL=""
NOX_WHATSAPP=""

DEMO_MODE="true"
ALLOW_LEGACY_DEMO_LANDING_CREATION="false"
NOX_INTEGRATIONS="enabled"
`;

  writeFileSync(".env", contents, { encoding: "utf8", flag: "wx" });
  return { email: "admin@noxos.local", password: adminPassword };
}

function ensureDatabase() {
  const compose = run(dockerCommand, ["compose", "up", "-d", "db"], {
    allowFailure: true,
    quiet: true,
  });

  if ((compose.status ?? 1) === 0) return;

  const existing = run(
    dockerCommand,
    ["container", "inspect", "nox-os-db", "--format", "{{.State.Running}}"],
    { allowFailure: true, quiet: true },
  );
  if ((existing.status ?? 1) !== 0) {
    process.stderr.write(compose.stderr ?? "");
    throw new Error("Não foi possível iniciar o PostgreSQL local.");
  }

  if ((existing.stdout ?? "").trim() !== "true") {
    run(dockerCommand, ["start", "nox-os-db"]);
  }

  console.log("Reutilizando o container local nox-os-db já existente.");
}

function migrateWithRetry() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const migration = runNpx(["prisma", "migrate", "deploy"], {
      allowFailure: true,
      quiet: attempt < 20,
    });
    if ((migration.status ?? 1) === 0) return;
    if (attempt < 20) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
  }

  throw new Error("O PostgreSQL não ficou pronto a tempo para aplicar as migrations.");
}

console.log("1/6 Configurando o ambiente local...");
const credentials = createLocalEnv();
process.loadEnvFile(".env");

console.log("2/6 Instalando dependências reproduzíveis...");
runNpm(["ci"]);

console.log("3/6 Iniciando PostgreSQL/PostGIS...");
ensureDatabase();

console.log("4/6 Aplicando migrations e seed...");
migrateWithRetry();
runNpm(["run", "db:seed"]);
runNpm(["run", "db:bootstrap:local"]);

console.log("5/6 Executando lint, tipos, testes e build...");
runNpm(["run", "verify"]);

console.log("6/6 Instalando o Chromium e executando o fluxo E2E...");
runNpx(["playwright", "install", "chromium"]);
process.env.PLAYWRIGHT_PORT ??= "3100";
process.env.PLAYWRIGHT_BASE_URL ??= "http://127.0.0.1:3100";
runNpm(["run", "test:e2e"]);

console.log("\nAmbiente pronto. Inicie aplicação + consumidor com: npm run dev:all");
if (credentials) {
  console.log(`Login local: ${credentials.email}`);
  console.log(`Senha local: ${credentials.password}`);
} else {
  console.log("As credenciais existentes em .env foram preservadas.");
}
