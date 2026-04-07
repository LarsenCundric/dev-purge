import chalk from "chalk";
import Table from "cli-table3";

export function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function colorSize(bytes) {
  const str = formatSize(bytes);
  if (bytes > 1024 * 1024 * 1024) return chalk.red.bold(str);
  if (bytes > 500 * 1024 * 1024) return chalk.red(str);
  if (bytes > 100 * 1024 * 1024) return chalk.yellow(str);
  return chalk.green(str);
}

const CAT_COLORS = {
  deps: chalk.magenta,
  build: chalk.blue,
  cache: chalk.yellow,
  test: chalk.cyan,
  ide: chalk.gray,
};

function colorCat(cat) {
  const fn = CAT_COLORS[cat] || chalk.dim;
  return fn(cat);
}

function timeAgo(date) {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function shortenPath(fullPath, rootPath) {
  if (fullPath.startsWith(rootPath)) {
    const rel = fullPath.slice(rootPath.length).replace(/^\//, "");
    return rel || ".";
  }
  return fullPath;
}

export function printResults(results, rootPath) {
  if (results.length === 0) {
    console.log();
    console.log(
      chalk.green("  \u2728 No bloat directories found. Your disk is clean!"),
    );
    console.log();
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan.bold("Project"),
      chalk.cyan.bold("Framework"),
      chalk.cyan.bold("Bloat"),
      chalk.cyan.bold("Size"),
      chalk.cyan.bold("Modified"),
    ],
    style: { head: [], border: ["dim"] },
    colWidths: [40, 16, 30, 12, 16],
    wordWrap: true,
  });

  for (const project of results) {
    const projectName = shortenPath(project.projectPath, rootPath);
    const bloatList = project.bloatDirs
      .sort((a, b) => b.size - a.size)
      .map((b) => {
        const cat = b.category ? ` ${colorCat(b.category)}` : "";
        return `${b.name} ${chalk.dim("(" + formatSize(b.size) + ")")}${cat}`;
      })
      .join("\n");

    table.push([
      chalk.white.bold(projectName),
      chalk.dim(project.framework),
      bloatList,
      colorSize(project.totalSize),
      chalk.dim(timeAgo(project.lastModified)),
    ]);
  }

  console.log();
  console.log(table.toString());
  printSummary(results);
}

export function printSummary(results) {
  const totalSize = results.reduce((a, b) => a + b.totalSize, 0);
  const totalDirs = results.reduce((a, b) => a + b.bloatDirs.length, 0);

  // Category breakdown
  const byCat = {};
  for (const project of results) {
    for (const b of project.bloatDirs) {
      const cat = b.category || "other";
      if (!byCat[cat]) byCat[cat] = { count: 0, size: 0 };
      byCat[cat].count++;
      byCat[cat].size += b.size;
    }
  }

  const breakdown = Object.entries(byCat)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([cat, { count, size }]) => `${colorCat(cat)} ${formatSize(size)}`)
    .join(chalk.dim(" \u2022 "));

  console.log();
  console.log(
    chalk.white.bold("  Summary: ") +
      chalk.white(`${results.length} projects`) +
      chalk.dim(" \u2022 ") +
      chalk.white(`${totalDirs} bloat directories`) +
      chalk.dim(" \u2022 ") +
      colorSize(totalSize) +
      chalk.white(" reclaimable"),
  );
  if (Object.keys(byCat).length > 1) {
    console.log(chalk.dim("  By category: ") + breakdown);
  }
  console.log();
}

export function printCleanSummary(cleaned, failed) {
  const totalFreed = cleaned.reduce((a, b) => a + b.size, 0);

  console.log();
  if (cleaned.length > 0) {
    console.log(
      chalk.green.bold("  \u2705 Cleaned ") +
        chalk.white(`${cleaned.length} directories`) +
        chalk.dim(" \u2022 ") +
        chalk.green.bold(formatSize(totalFreed)) +
        chalk.white(" freed"),
    );
  }
  if (failed.length > 0) {
    console.log(
      chalk.red.bold("  \u26A0\uFE0F  Failed ") +
        chalk.white(`${failed.length} directories`),
    );
    for (const f of failed) {
      console.log(chalk.red(`    - ${f.path}: ${f.error}`));
    }
  }
  console.log();
}

export function printWatchHeader() {
  console.log();
  console.log(
    chalk.cyan.bold(
      "  \uD83D\uDC41\uFE0F  Watching dev directories — press Ctrl+C to stop",
    ),
  );
  console.log();
}

export function printProjectPrompt(project, rootPath, index, total) {
  const name = shortenPath(project.projectPath, rootPath);
  const bloatList = project.bloatDirs
    .sort((a, b) => b.size - a.size)
    .map((b) => `${b.name} ${chalk.dim("(" + formatSize(b.size) + ")")}`)
    .join(", ");

  console.log(
    chalk.cyan(`  [${index}/${total}] `) +
      chalk.white.bold(name) +
      chalk.dim(` (${project.framework})`) +
      chalk.white(" \u2014 ") +
      colorSize(project.totalSize) +
      chalk.dim(` \u2022 ${timeAgo(project.lastModified)}`),
  );
  console.log(chalk.dim(`         ${bloatList}`));
}
