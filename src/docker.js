import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const DOCKER_TIMEOUT_MS = 15_000;

async function docker(args) {
  try {
    const res = await execFile("docker", args, {
      timeout: DOCKER_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return res.stdout || "";
  } catch (err) {
    // Normalize errors so caller can handle missing Docker, daemon, permissions,
    // and timeout failures consistently.
    throw new Error(err.stderr || err.message || String(err));
  }
}

function parseDockerDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isKeptByAge(created, olderThanMs) {
  if (!olderThanMs) return false;
  // If Docker cannot provide a parseable creation time, keep the artifact rather
  // than deleting something that may not satisfy the user's age filter.
  if (!created) return true;
  return Date.now() - created.getTime() < olderThanMs;
}

function parseJsonLines(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export async function manageDocker({
  olderThanMs,
  includeContainers = true,
  includeImages = true,
} = {}) {
  const out = { containers: [], images: [] };

  // List stopped/exited containers only. Running containers are never targeted.
  if (includeContainers) {
    const raw = await docker([
      "container",
      "ls",
      "--all",
      "--filter",
      "status=exited",
      "--format",
      "{{json .}}",
    ]);

    for (const obj of parseJsonLines(raw)) {
      const created = parseDockerDate(obj.CreatedAt || obj.Created);
      out.containers.push({
        id: obj.ID,
        image: obj.Image,
        name: obj.Names,
        createdAt: obj.CreatedAt || obj.Created || null,
        created,
        keep: isKeptByAge(created, olderThanMs),
      });
    }
  }

  // List dangling images only. Tagged images are never targeted.
  if (includeImages) {
    const raw = await docker([
      "image",
      "ls",
      "--filter",
      "dangling=true",
      "--format",
      "{{json .}}",
    ]);

    for (const obj of parseJsonLines(raw)) {
      const created = parseDockerDate(obj.CreatedAt);
      out.images.push({
        id: obj.ID,
        repo: obj.Repository,
        tag: obj.Tag,
        createdAt: obj.CreatedAt || null,
        created,
        keep: isKeptByAge(created, olderThanMs),
      });
    }
  }

  return out;
}

async function runDelete(argsPrefix, ids) {
  const cleaned = [];
  const failed = [];
  if (ids.length === 0) return { cleaned, failed };

  // Remove one-by-one to get per-item failures.
  for (const id of ids) {
    try {
      await docker([...argsPrefix, id]);
      cleaned.push(id);
    } catch (err) {
      failed.push({ id, error: err.message || String(err) });
    }
  }
  return { cleaned, failed };
}

export async function removeContainers(ids = []) {
  return runDelete(["container", "rm"], ids);
}

export async function removeImages(ids = []) {
  return runDelete(["image", "rm"], ids);
}
