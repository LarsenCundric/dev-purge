import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

async function safeExec(cmd) {
  try {
    const res = await exec(cmd);
    return res.stdout || "";
  } catch (err) {
    // Normalize errors so caller can handle missing Docker or permissions
    throw new Error(err.stderr || err.message || String(err));
  }
}

export async function manageDocker({ olderThanMs, includeContainers = true, includeImages = true } = {}) {
  const out = { containers: [], images: [] };

  // List stopped/exit containers
  if (includeContainers) {
    const raw = await safeExec('docker ps -a --filter status=exited --format "{{json .}}"');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const created = new Date(obj.CreatedAt || obj.Created);
        out.containers.push({ id: obj.ID, image: obj.Image, createdAt: obj.CreatedAt || obj.Created, created: isNaN(created.getTime()) ? null : created, keep: !!olderThanMs ? (Date.now() - created.getTime()) < olderThanMs : false });
      } catch {
        // ignore parse errors
      }
    }
  }

  // List dangling images (safe default)
  if (includeImages) {
    const raw = await safeExec('docker images --filter dangling=true --format "{{json .}}"');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        // Some docker versions include CreatedAt, others include "CreatedSince" – best-effort
        const created = obj.CreatedAt ? new Date(obj.CreatedAt) : null;
        out.images.push({ id: obj.ID, repo: obj.Repository, tag: obj.Tag, createdAt: obj.CreatedAt || null, created: created, keep: !!olderThanMs ? (created ? (Date.now() - created.getTime()) < olderThanMs : true) : false });
      } catch {
        // ignore
      }
    }
  }

  return out;
}

async function runDelete(cmd, ids) {
  const cleaned = [];
  const failed = [];
  if (ids.length === 0) return { cleaned, failed };
  // Remove one-by-one to get per-item failures
  for (const id of ids) {
    try {
      await exec(`${cmd} ${id}`);
      cleaned.push(id);
    } catch (err) {
      failed.push({ id, error: err.stderr || err.message || String(err) });
    }
  }
  return { cleaned, failed };
}

export async function removeContainers(ids = []) {
  return runDelete('docker rm', ids);
}

export async function removeImages(ids = []) {
  return runDelete('docker rmi', ids);
}
