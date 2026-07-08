import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const root = resolve(new URL("..", import.meta.url).pathname);
const stagingDir = resolve(root, "deploy/staging");
const currentReleasePath = resolve(stagingDir, "current-release.json");
const smokeReportPath = resolve(stagingDir, "last-smoke.json");
const stagingPort = Number(process.env.STAGING_PORT || 3091);
const stagingUrl = process.env.STAGING_BASE_URL || `http://127.0.0.1:${stagingPort}`;

if (args.has("--rollback")) {
  await rollbackStaging();
} else if (args.has("--deploy")) {
  await deployWithDocker();
} else {
  await smokeStaging();
}

async function smokeStaging() {
  assertPort(stagingPort);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "staging",
      SERVICE_NAME: "goatedbuy-backend",
      APP_VERSION: process.env.APP_VERSION || "0.1.0",
      PORT: String(stagingPort),
      REQUEST_LOG_LEVEL: process.env.REQUEST_LOG_LEVEL || "silent",
      READY_REQUIRES_DATABASE: process.env.READY_REQUIRES_DATABASE || "false",
      READY_REQUIRES_REDIS: process.env.READY_REQUIRES_REDIS || "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    const health = await waitForJson(`${stagingUrl}/health`, 40, 150);
    const version = await waitForJson(`${stagingUrl}/version`, 10, 100);
    const report = {
      mode: "smoke",
      stagingUrl,
      image: process.env.STAGING_IMAGE || "local-process",
      checkedAt: new Date().toISOString(),
      health,
      version
    };
    await writeJson(smokeReportPath, report);
    await writeJson(currentReleasePath, {
      stagingUrl,
      image: report.image,
      previousImage: process.env.PREVIOUS_STAGING_IMAGE || "",
      deployedAt: report.checkedAt,
      mode: "smoke"
    });
    console.log(`Staging smoke ok: ${stagingUrl}/health and /version`);
  } finally {
    child.kill("SIGINT");
    await waitForExit(child);
    if (child.exitCode && child.exitCode !== 0 && child.exitCode !== 130) {
      console.error(output);
    }
  }
}

async function deployWithDocker() {
  ensureDocker();
  const image = process.env.STAGING_IMAGE || "goatedbuy-backend:staging";
  runDockerCompose(image);
  await waitForJson(`${stagingUrl}/health`, 40, 500);
  await waitForJson(`${stagingUrl}/version`, 20, 500);
  await writeJson(currentReleasePath, {
    stagingUrl,
    image,
    previousImage: process.env.PREVIOUS_STAGING_IMAGE || "",
    deployedAt: new Date().toISOString(),
    mode: "docker"
  });
  console.log(`Staging deploy ok: ${stagingUrl}`);
}

async function rollbackStaging() {
  ensureDocker();
  const current = await readCurrentRelease();
  const rollbackImage = process.env.ROLLBACK_IMAGE || current.previousImage;
  if (!rollbackImage) {
    throw new Error("ROLLBACK_IMAGE or current-release.previousImage is required for rollback.");
  }

  runDockerCompose(rollbackImage);
  await waitForJson(`${stagingUrl}/health`, 40, 500);
  await waitForJson(`${stagingUrl}/version`, 20, 500);
  await writeJson(currentReleasePath, {
    stagingUrl,
    image: rollbackImage,
    previousImage: current.image || "",
    deployedAt: new Date().toISOString(),
    mode: "rollback"
  });
  console.log(`Staging rollback ok: ${rollbackImage}`);
}

function runDockerCompose(image) {
  const composeFile = resolve(stagingDir, "docker-compose.staging.yml");
  const result = spawnSync("docker", ["compose", "-f", composeFile, "up", "-d"], {
    cwd: root,
    env: {
      ...process.env,
      STAGING_IMAGE: image,
      STAGING_PORT: String(stagingPort)
    },
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "docker compose failed.");
  }
}

function ensureDocker() {
  const result = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("Docker CLI is required for --deploy and --rollback. Use --smoke for local validation.");
  }
}

async function waitForJson(url, attempts, delayMs) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "x-request-id": "staging-smoke"
        }
      });
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  throw lastError;
}

async function readCurrentRelease() {
  try {
    return JSON.parse(await readFile(currentReleasePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForExit(child) {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise((resolveExit) => {
    child.once("exit", resolveExit);
  });
}

function assertPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("STAGING_PORT must be between 1 and 65535.");
  }
}
