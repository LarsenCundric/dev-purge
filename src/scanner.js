import { readdir, stat, access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// ── Bloat directory definitions with categories ─────────────────────
export const BLOAT = {
  // Dependencies
  node_modules: "deps",
  ".pnpm-store": "deps",
  ".yarn": "deps",
  vendor: "deps",
  bower_components: "deps",
  Pods: "deps",
  venv: "deps",
  ".venv": "deps",

  // Build output
  ".next": "build",
  ".nuxt": "build",
  ".output": "build",
  ".svelte-kit": "build",
  ".angular": "build",
  ".expo": "build",
  ".vercel": "build",
  dist: "build",
  build: "build",
  out: "build",
  target: "build",
  DerivedData: "build",

  // Caches
  ".cache": "cache",
  ".parcel-cache": "cache",
  ".turbo": "cache",
  ".vite": "cache",
  __pycache__: "cache",
  ".pytest_cache": "cache",
  ".mypy_cache": "cache",
  ".ruff_cache": "cache",
  ".gradle": "cache",
  ".dart_tool": "cache",

  // Test / coverage
  coverage: "test",
  ".nyc_output": "test",
  "storybook-static": "test",
};

// IDE caches (only scanned with --ide)
export const IDE_DIRS = {
  ".cursor": "ide",
  ".vscode": "ide",
  ".idea": "ide",
};

const FRAMEWORK_MARKERS = [
  { file: "package.json", detect: detectNodeFramework },
  { file: "Cargo.toml", framework: "Rust" },
  { file: "go.mod", framework: "Go" },
  { file: "pom.xml", framework: "Java (Maven)" },
  { file: "build.gradle", framework: "Java (Gradle)" },
  { file: "build.gradle.kts", framework: "Kotlin (Gradle)" },
  { file: "Gemfile", framework: "Ruby" },
  { file: "requirements.txt", framework: "Python" },
  { file: "setup.py", framework: "Python" },
  { file: "pyproject.toml", framework: "Python" },
  { file: "Pipfile", framework: "Python (Pipenv)" },
  { file: "pubspec.yaml", framework: "Flutter/Dart" },
  { file: "Podfile", framework: "iOS (CocoaPods)" },
  { file: "Package.swift", framework: "Swift" },
];

const NODE_FRAMEWORK_DEPS = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["svelte", "SvelteKit"],
  ["@sveltejs/kit", "SvelteKit"],
  ["react", "React"],
  ["vue", "Vue"],
  ["angular", "Angular"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["astro", "Astro"],
  ["gatsby", "Gatsby"],
  ["remix", "Remix"],
  ["expo", "Expo"],
  ["electron", "Electron"],
  ["vite", "Vite"],
  ["webpack", "Webpack"],
  ["parcel", "Parcel"],
  ["turbo", "Turborepo"],
];

async function detectNodeFramework(projectDir) {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dep, name] of NODE_FRAMEWORK_DEPS) {
      if (allDeps[dep]) return name;
    }
    return "Node.js";
  } catch {
    return "Node.js";
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectFramework(projectDir, bloatNames) {
  for (const marker of FRAMEWORK_MARKERS) {
    if (await fileExists(join(projectDir, marker.file))) {
      if (marker.detect) return marker.detect(projectDir);
      return marker.framework;
    }
  }
  // Infer from bloat dir types
  if (
    bloatNames &&
    bloatNames.some((n) =>
      [
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".venv",
        "venv",
      ].includes(n),
    )
  ) {
    return "Python";
  }
  return "Unknown";
}

export async function getDirSize(dirPath) {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const promises = entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return getDirSize(fullPath);
      } else {
        try {
          const s = await stat(fullPath);
          return s.size;
        } catch {
          return 0;
        }
      }
    });
    const sizes = await Promise.all(promises);
    total = sizes.reduce((a, b) => a + b, 0);
  } catch {
    /* permission denied */
  }
  return total;
}

async function getLastModified(dirPath) {
  try {
    const s = await stat(dirPath);
    return s.mtime;
  } catch {
    return new Date(0);
  }
}

/**
 * Scan options:
 *   onProgress(dir)   - callback as dirs are scanned
 *   olderThanMs       - only include projects older than this
 *   maxDepth          - how deep to recurse (default 6)
 *   categories        - Set of categories to include (null = all)
 *   minSize           - minimum bloat size in bytes to include
 *   includeIde        - also scan for IDE cache dirs
 *   ignorePatterns    - array of glob patterns to ignore; supports absolute
 *                       paths, paths relative to rootPath, bare dir names,
 *                       ~, *, ?, and **
 */

function normalizePathForMatch(path) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized || "/";
}

function expandHome(pattern) {
  const home = process.env.HOME || homedir();
  return pattern.replace(/^~(?=$|[\\/])/, home);
}

function hasGlobMagic(pattern) {
  return /[*?]/.test(pattern);
}

function isAbsolutePattern(pattern) {
  return isAbsolute(pattern) || /^[A-Za-z]:[\\/]/.test(pattern);
}

function escapeRegExpChar(char) {
  return char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(glob) {
  const pattern = normalizePathForMatch(glob);
  let source = "";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExpChar(char);
    }
  }

  return new RegExp(`^${source}$`);
}

function compileIgnorePattern(rawPattern, rootPath) {
  if (typeof rawPattern !== "string") return null;

  const raw = rawPattern.trim();
  if (!raw) return null;

  const expanded = expandHome(raw);
  const hasSlash = /[\\/]/.test(expanded);
  const hasMagic = hasGlobMagic(expanded);

  if (!hasSlash && !hasMagic) {
    return (candidatePath) =>
      normalizePathForMatch(candidatePath).split("/").includes(expanded);
  }

  let absolutePattern;
  if (isAbsolutePattern(expanded)) {
    absolutePattern = expanded;
  } else if (!hasSlash) {
    absolutePattern = join(rootPath, "**", expanded);
  } else {
    absolutePattern = resolve(rootPath, expanded);
  }

  const normalizedPattern = normalizePathForMatch(absolutePattern);

  if (!hasMagic) {
    return (candidatePath) => {
      const normalizedCandidate = normalizePathForMatch(candidatePath);
      return (
        normalizedCandidate === normalizedPattern ||
        normalizedCandidate.startsWith(`${normalizedPattern}/`)
      );
    };
  }

  const regex = globToRegExp(normalizedPattern);
  const baseRegex = normalizedPattern.endsWith("/**")
    ? globToRegExp(normalizedPattern.slice(0, -3))
    : null;

  return (candidatePath) => {
    const normalizedCandidate = normalizePathForMatch(candidatePath);
    return (
      regex.test(normalizedCandidate) || !!baseRegex?.test(normalizedCandidate)
    );
  };
}

export async function scan(rootPath, opts = {}) {
  const {
    onProgress,
    olderThanMs,
    maxDepth = 6,
    categories,
    minSize = 0,
    includeIde = false,
    ignorePatterns = [],
  } = opts;

  const scanRootPath = resolve(rootPath);

  // Build the lookup of dir names to scan for
  const targetDirs = {};
  for (const [name, cat] of Object.entries(BLOAT)) {
    if (!categories || categories.has(cat)) {
      targetDirs[name] = cat;
    }
  }
  if (includeIde) {
    for (const [name, cat] of Object.entries(IDE_DIRS)) {
      targetDirs[name] = cat;
    }
  }
  const targetNames = new Set(Object.keys(targetDirs));

  // Prepare ignore matchers after rootPath is known so relative patterns can be
  // resolved from the scan root.
  const ignoreMatchers = (ignorePatterns || [])
    .map((pattern) => compileIgnorePattern(pattern, scanRootPath))
    .filter(Boolean);
  const isIgnored = (candidatePath) =>
    ignoreMatchers.some((matcher) => matcher(candidatePath));

  const results = [];
  await walkForProjects(
    scanRootPath,
    results,
    {
      onProgress,
      olderThanMs,
      maxDepth,
      targetNames,
      minSize,
      isIgnored,
    },
    0,
    scanRootPath,
  );

  results.sort((a, b) => b.totalSize - a.totalSize);
  return results;
}

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".Trash",
  "Library",
  "Applications",
  ".cache",
  // Language runtime / version manager dirs
  ".pyenv",
  ".nvm",
  ".fnm",
  ".rustup",
  ".cargo",
  ".rbenv",
  ".sdkman",
  ".local",
  ".npm",
  ".bun",
  ".conda",
  "miniconda3",
  "anaconda3",
  ".gem",
  // Go module cache / SDK
  "go",
  "sdk",
  // IDE extension dirs
  ".cursor",
  ".vscode",
  ".idea",
  // System / tool config
  ".docker",
  ".terraform.d",
]);

// Generic dir names that are only bloat inside actual projects (not standalone)
const GENERIC_DIRS = new Set([
  "build",
  "dist",
  "out",
  "vendor",
  "target",
  "coverage",
]);

const PROJECT_MARKERS = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "requirements.txt",
  "setup.py",
  "pyproject.toml",
  "Pipfile",
  "pubspec.yaml",
  "Podfile",
  "Package.swift",
  "composer.json",
  "Makefile",
  "CMakeLists.txt",
];

async function hasProjectMarker(dir) {
  for (const marker of PROJECT_MARKERS) {
    if (await fileExists(join(dir, marker))) return true;
  }
  return false;
}

async function walkForProjects(dir, results, opts, depth, rootPath) {
  if (depth > opts.maxDepth) return;

  // If this directory matches an ignore pattern, skip entirely.
  if (opts.isIgnored?.(dir)) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  if (opts.onProgress) opts.onProgress(dir);

  const isRoot = dir === rootPath;
  // Do not report bloat at an arbitrary scan root like $HOME, but do report it
  // when the root itself is a project (for example running `dev-purge` inside a
  // repo with node_modules or .venv).
  const canCollectBloatAtDir = !isRoot || (await hasProjectMarker(dir));
  const bloatEntries = [];
  const childDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const fullPath = join(dir, name);
    if (opts.isIgnored?.(fullPath)) continue;

    if (opts.targetNames.has(name) && canCollectBloatAtDir) {
      bloatEntries.push({
        name,
        path: fullPath,
        category: BLOAT[name] || IDE_DIRS[name] || "other",
      });
    } else if (!SKIP_DIRS.has(name) && !name.startsWith(".Trash")) {
      childDirs.push(fullPath);
    }
  }

  // For generic names (build, dist, out, vendor, target), only count them
  // if the parent directory is an actual project (has a project marker file)
  if (
    bloatEntries.length > 0 &&
    bloatEntries.some((b) => GENERIC_DIRS.has(b.name))
  ) {
    const isProject = await hasProjectMarker(dir);
    if (!isProject) {
      // Remove generic entries — keep only specific ones (node_modules, .next, etc.)
      const filtered = bloatEntries.filter((b) => !GENERIC_DIRS.has(b.name));
      bloatEntries.length = 0;
      bloatEntries.push(...filtered);
    }
  }

  if (bloatEntries.length > 0) {
    const lastModified = await getLastModified(dir);

    if (olderThanCheck(opts.olderThanMs, lastModified)) {
      const sizePromises = bloatEntries.map(async (b) => {
        const size = await getDirSize(b.path);
        return { ...b, size };
      });
      const bloatDirs = (await Promise.all(sizePromises)).filter(
        (b) => b.size >= opts.minSize,
      );

      if (bloatDirs.length > 0) {
        const totalSize = bloatDirs.reduce((a, b) => a + b.size, 0);
        const framework = await detectFramework(
          dir,
          bloatDirs.map((b) => b.name),
        );
        results.push({
          projectPath: dir,
          framework,
          bloatDirs,
          totalSize,
          lastModified,
        });
      }
    }
  }

  // Filter out virtualenvs (custom-named ones like .browser-use-env)
  const filteredChildDirs = [];
  for (const child of childDirs) {
    if (await fileExists(join(child, "pyvenv.cfg"))) continue;
    filteredChildDirs.push(child);
  }

  const BATCH_SIZE = 10;
  for (let i = 0; i < filteredChildDirs.length; i += BATCH_SIZE) {
    const batch = filteredChildDirs.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((child) =>
        walkForProjects(child, results, opts, depth + 1, rootPath),
      ),
    );
  }
}

function olderThanCheck(olderThanMs, lastModified) {
  if (!olderThanMs) return true;
  return Date.now() - lastModified.getTime() >= olderThanMs;
}
