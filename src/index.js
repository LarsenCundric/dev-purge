#!/usr/bin/env node

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { scan } from "./scanner.js";
import {
  printResults,
  printCleanSummary,
  printWatchHeader,
  formatSize,
  colorSize,
  printProjectPrompt,
} from "./display.js";
import { clean } from "./cleaner.js";
import { ask } from "./prompt.js";
import { manageDocker, removeContainers, removeImages } from "./docker.js";

// ── Parse args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);

function hasFlag(...names) {
  return names.some((n) => args.includes(n));
}

function getFlagValue(name) {
  // --foo=bar
  for (const arg of args) {
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  // --foo bar
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    return args[idx + 1];
  }
  return null;
}

function getFlagValues(name) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      if (args[i + 1] && !args[i + 1].startsWith("-")) {
        values.push(args[i + 1]);
        i++;
      }
    } else if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    }
  }
  return values;
}

// Positional args (not flags and not flag values)
const flagsWithValues = new Set([
  "--older-than",
  "-d",
  "--depth",
  "-s",
  "--min-size",
  "--category",
  "--ignore",
]);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("-")) {
    if (
      flagsWithValues.has(args[i]) &&
      args[i + 1] &&
      !args[i + 1].startsWith("-")
    )
      i++; // skip value
    continue;
  }
  // skip if previous arg was a flag expecting a value
  if (i > 0 && flagsWithValues.has(args[i - 1])) continue;
  positional.push(args[i]);
}

const dryRun = hasFlag("--dry-run");
const cleanAll = hasFlag("--all", "-a");
const watch = hasFlag("--watch");
const help = hasFlag("--help", "-h");
const json = hasFlag("--json");
const includeIde = hasFlag("--ide");

const olderThanRaw = getFlagValue("--older-than");
const olderThanMs = olderThanRaw ? parseDuration(olderThanRaw) : null;

const depthRaw = getFlagValue("-d") || getFlagValue("--depth");
const maxDepth = depthRaw ? parseInt(depthRaw, 10) : 6;

const minSizeRaw = getFlagValue("-s") || getFlagValue("--min-size");
const minSize = minSizeRaw !== null ? parseSize(minSizeRaw) : 1024 * 1024; // default 1 MB

const categoryRaw = getFlagValue("--category");
const categories = categoryRaw ? new Set(categoryRaw.split(",")) : null;

// Load config file for default ignore patterns
let configIgnore = [];
const configHome = process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`;
const cfgPath = resolve(configHome, "dev-purge", "config.json");
try {
  const raw = await readFile(cfgPath, "utf-8");
  const cfg = JSON.parse(raw);
  if (Array.isArray(cfg.ignore)) configIgnore = cfg.ignore;
} catch {
  // no config or unreadable - ignore
}

// CLI-provided ignore patterns (repeatable)
const cliIgnore = getFlagValues("--ignore") || [];
// Merge config + CLI (CLI entries appended, user can override by specifying patterns)
const ignorePatterns = [...new Set([...(configIgnore || []), ...cliIgnore])];

const rootPath = resolve(positional[0] || ".");

// ── Main ────────────────────────────────────────────────────────────
if (help) {
  printHelp();
  process.exit(0);
}

// Docker subcommand: `dev-purge docker`
if (positional[0] === "docker") {
  await runDocker();
  process.exit(0);
}

if (watch) {
  await runWatch();
} else {
  await run();
}

async function run() {
  const spinner = json
    ? {
        start() {
          return this;
        },
        stop() {},
        set text(_) {},
      }
    : ora({
        text: chalk.dim("Scanning for bloat directories..."),
        color: "cyan",
      }).start();

  let lastUpdate = 0;
  const results = await scan(rootPath, {
    olderThanMs,
    maxDepth,
    categories,
    minSize,
    includeIde,
    ignorePatterns,
    onProgress(dir) {
      const now = Date.now();
      if (now - lastUpdate > 100) {
        lastUpdate = now;
        const short = dir.length > 60 ? "..." + dir.slice(-57) : dir;
        spinner.text = chalk.dim(`Scanning: ${short}`);
      }
    },
  });

  spinner.stop();

  if (json) {
    printJson(results);
    return;
  }

  printResults(results, rootPath);

  if (results.length === 0) return;

  if (dryRun) {
    console.log(chalk.yellow("  --dry-run: no files were deleted.\n"));
    return;
  }

  if (cleanAll) {
    await cleanAllWithConfirm(results);
  } else {
    await cycleProjects(results);
  }
}

async function cleanAllWithConfirm(results) {
  const allDirs = results.flatMap((p) =>
    p.bloatDirs.map((b) => ({ path: b.path, size: b.size })),
  );
  const totalSize = allDirs.reduce((a, b) => a + b.size, 0);

  const answer = await ask(
    chalk.white(
      `  Delete ${chalk.bold(allDirs.length + " directories")} across ${chalk.bold(results.length + " projects")} (${colorSize(totalSize)})?`,
    ),
  );

  if (!answer) {
    console.log(chalk.dim("\n  Cancelled.\n"));
    return;
  }

  await deleteItems(allDirs);
}

async function cycleProjects(results) {
  const toDelete = [];

  for (let i = 0; i < results.length; i++) {
    const project = results[i];
    printProjectPrompt(project, rootPath, i + 1, results.length);
    const answer = await ask(chalk.white("  Clean?"));

    if (answer) {
      toDelete.push(
        ...project.bloatDirs.map((b) => ({ path: b.path, size: b.size })),
      );
    }

    console.log();
  }

  if (toDelete.length === 0) {
    console.log(chalk.dim("  Nothing selected.\n"));
    return;
  }

  await deleteItems(toDelete);
}

async function deleteItems(items) {
  const spinner = ora({ text: chalk.dim("Cleaning..."), color: "red" }).start();

  const { cleaned, failed } = await clean(items, {
    onProgress(item, i, total) {
      spinner.text = chalk.dim(`Deleting (${i + 1}/${total}): ${item.path}`);
    },
  });

  spinner.stop();
  printCleanSummary(cleaned, failed);
}

async function runWatch() {
  printWatchHeader();

  const update = async () => {
    const results = await scan(rootPath, {
      olderThanMs,
      maxDepth,
      categories,
      minSize,
      includeIde,
    });
    process.stdout.write("\x1B[2J\x1B[H");
    printWatchHeader();
    printResults(results, rootPath);
    console.log(
      chalk.dim(`  Last updated: ${new Date().toLocaleTimeString()}`),
    );
  };

  await update();
  setInterval(update, 5000);
}

function printJson(results) {
  const output = {
    root: rootPath,
    scannedAt: new Date().toISOString(),
    projects: results.map((r) => ({
      path: r.projectPath,
      framework: r.framework,
      lastModified: r.lastModified.toISOString(),
      totalBytes: r.totalSize,
      totalHuman: formatSize(r.totalSize),
      bloat: r.bloatDirs.map((b) => ({
        name: b.name,
        path: b.path,
        category: b.category,
        bytes: b.size,
        human: formatSize(b.size),
      })),
    })),
    summary: {
      projects: results.length,
      directories: results.reduce((a, b) => a + b.bloatDirs.length, 0),
      totalBytes: results.reduce((a, b) => a + b.totalSize, 0),
      totalHuman: formatSize(results.reduce((a, b) => a + b.totalSize, 0)),
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

async function runDocker() {
  const includeContainers = !hasFlag('--images-only');
  const includeImages = !hasFlag('--containers-only');

  try {
    const report = await manageDocker({ olderThanMs, includeContainers, includeImages });

    const candidatesContainers = report.containers.filter((c) => !c.keep);
    const candidatesImages = report.images.filter((i) => !i.keep);

    console.log(chalk.cyan.bold('\nDocker purge summary:'));
    if (includeContainers) {
      console.log(chalk.white(`  Stopped containers found: ${report.containers.length}`));
      console.log(chalk.white(`  Candidates to remove: ${candidatesContainers.length}`));
    }
    if (includeImages) {
      console.log(chalk.white(`  Dangling images found: ${report.images.length}`));
      console.log(chalk.white(`  Candidates to remove: ${candidatesImages.length}`));
    }

    if (candidatesContainers.length === 0 && candidatesImages.length === 0) {
      console.log(chalk.green('\nNothing to remove.'));
      return;
    }

    if (dryRun) {
      console.log(chalk.yellow('\n--dry-run: no resources will be removed.'));
      return;
    }

    const answer = await ask(chalk.white('  Remove these Docker resources?'));
    if (!answer) {
      console.log(chalk.dim('\nCancelled.'));
      return;
    }

    if (candidatesContainers.length > 0) {
      const ids = candidatesContainers.map((c) => c.id);
      const res = await removeContainers(ids);
      console.log(chalk.green(`  Removed containers: ${res.cleaned.length}`));
      if (res.failed.length) console.log(chalk.red(`  Failed to remove containers: ${res.failed.length}`));
    }

    if (candidatesImages.length > 0) {
      const ids = candidatesImages.map((i) => i.id);
      const res = await removeImages(ids);
      console.log(chalk.green(`  Removed images: ${res.cleaned.length}`));
      if (res.failed.length) console.log(chalk.red(`  Failed to remove images: ${res.failed.length}`));
    }
  } catch (err) {
    console.error(chalk.red(`Docker purge failed: ${err.message}`));
    process.exit(1);
  }
}

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(h|d|w|m|y)$/);
  if (!match) {
    console.error(
      chalk.red(`Invalid duration: "${str}". Use format like 30d, 2w, 6m, 1y`),
    );
    process.exit(1);
  }
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = {
    h: 3600000,
    d: 86400000,
    w: 604800000,
    m: 30 * 86400000,
    y: 365 * 86400000,
  };
  return num * multipliers[unit];
}

function parseSize(str) {
  if (!str) return 0;
  const match = str.match(/^(\d+)(b|k|m|g)?$/i);
  if (!match) {
    console.error(
      chalk.red(`Invalid size: "${str}". Use format like 100m, 1g, 500k`),
    );
    process.exit(1);
  }
  const num = parseInt(match[1], 10);
  const unit = (match[2] || "b").toLowerCase();
  const multipliers = { b: 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 };
  return num * multipliers[unit];
}

function printHelp() {
  console.log(`
${chalk.cyan.bold("dev-purge")} — find and clean dev bloat across your projects

${chalk.white.bold("Usage:")}
  ${chalk.green("dev-purge")}                         Scan + cycle through projects (y/n each)
  ${chalk.green("dev-purge /path/to/projects")}       Scan a specific directory
  ${chalk.green("dev-purge --dry-run")}               Show bloat without deleting
  ${chalk.green("dev-purge -a, --all")}               Single confirmation to delete all
  ${chalk.green("dev-purge -a --older-than 1y")}      Nuke all bloat older than a year
  ${chalk.green("dev-purge --category deps")}         Only dependencies (node_modules, venv, etc.)
  ${chalk.green("dev-purge --json")}                  Machine-readable JSON output
  ${chalk.green("dev-purge --watch")}                 Real-time disk usage monitoring

${chalk.white.bold("Categories:")}
  ${chalk.yellow("deps")}    node_modules, .pnpm-store, .yarn, vendor, bower_components, Pods, venv, .venv
  ${chalk.yellow("build")}   .next, .nuxt, .output, .svelte-kit, .angular, .expo, .vercel, dist, build, out, target, DerivedData
  ${chalk.yellow("cache")}   .cache, .parcel-cache, .turbo, .vite, __pycache__, .pytest_cache, .mypy_cache, .ruff_cache, .gradle, .dart_tool
  ${chalk.yellow("test")}    coverage, .nyc_output, storybook-static

${chalk.white.bold("Flags:")}
  --dry-run                Scan and display only, don't delete anything
  -a, --all                Delete all found bloat with single confirmation
  --older-than <dur>       Filter by project age (30d, 2w, 6m, 1y)
  --category <cat>         Filter by category: deps, build, cache, test (comma-separated)
  -s, --min-size <size>    Minimum bloat size to show (default: 1m, use -s 0 for all)
  -d, --depth <n>          Max scan depth (default: 6)
  --ide                    Also scan IDE caches (.cursor, .vscode, .idea)
  --json                   Output results as JSON
  --watch                  Continuously monitor and display disk usage
  --ignore <glob>          Ignore matching absolute paths (repeatable). Also supported in config: ~/.config/dev-purge/config.json {"ignore": ["~/.vscode-server/**"]}
  --help, -h               Show this help
`);
}
