# dev-purge

Find and clean build artifacts, dependency folders, cache directories, and safe Docker leftovers across all your projects. One command to reclaim gigabytes of disk space.

## What it looks like

```
$ dev-purge --dry-run

┌──────────────────────────────┬──────────────┬────────────────────────────┬──────────┬──────────────┐
│ Project                      │ Framework    │ Bloat                      │ Size     │ Modified     │
├──────────────────────────────┼──────────────┼────────────────────────────┼──────────┼──────────────┤
│ cloud/frontend               │ Next.js      │ .next (2.2 GB) build       │ 3.1 GB   │ 1 day ago    │
│                              │              │ node_modules (926 MB) deps │          │              │
├──────────────────────────────┼──────────────┼────────────────────────────┼──────────┼──────────────┤
│ cloud/backend                │ Python       │ .venv (535 MB) deps        │ 536 MB   │ today        │
│                              │              │ .ruff_cache (448 KB) cache │          │              │
│                              │              │ .pytest_cache (77 KB) cache│          │              │
├──────────────────────────────┼──────────────┼────────────────────────────┼──────────┼──────────────┤
│ my-app/ios                   │ iOS          │ Pods (981 MB) deps         │ 981 MB   │ 6 months ago │
│                              │ (CocoaPods)  │ build (339 KB) build       │          │              │
└──────────────────────────────┴──────────────┴────────────────────────────┴──────────┴──────────────┘

  Summary: 3 projects • 7 bloat directories • 4.6 GB reclaimable
  By category: deps 2.5 GB • build 2.2 GB • cache 525 KB
```

## Install

```bash
npm install -g dev-purge
```

Or run without installing:

```bash
npx dev-purge
```

## Usage

```bash
dev-purge                         # Cycle through projects, y/n each
dev-purge ~/projects              # Scan a specific directory
dev-purge --dry-run               # Show reclaimable files + runtime artifacts without deleting
dev-purge -a                      # Bulk-delete found directories, then optionally clean Docker leftovers
dev-purge -a --older-than 1y      # Nuke everything older than a year
dev-purge -a --category cache --older-than 6m  # Nuke old caches
dev-purge --category deps         # Only node_modules, venv, Pods, etc.
dev-purge --category containers   # Only exited containers
dev-purge --category images       # Only dangling images
dev-purge --containers-only       # Runtime cleanup: exited containers only
dev-purge --images-only           # Runtime cleanup: dangling images only
dev-purge -s 100m                 # Only show bloat > 100 MB
dev-purge -s 0                    # Show everything (no size minimum)
dev-purge --json                  # Machine-readable filesystem scan output
dev-purge --watch                 # Real-time disk usage monitoring
```

### Interactive mode (default)

Cycles through each project and asks y/n. Shows the project name, framework, bloat directories, total size, and age. Ctrl+C to stop anytime.

```
  [1/18] finance-landing-page (Next.js) — 1.1 GB • 1 month ago
         node_modules (801.7 MB), .next (315.0 MB)
  Clean? (y/n)
```

### Runtime cleanup

After the filesystem scan, `dev-purge` can also inspect Docker for:

- exited containers
- dangling images

Example summary:

```
Runtime cleanup summary:
  Exited containers found: 4
  Candidates to remove: 4
  Dangling images found: 2
  Candidates to remove: 2
```

Use category filters or dedicated flags to focus only on runtime artifacts:

```bash
dev-purge --category containers
dev-purge --category images
dev-purge --containers-only
dev-purge --images-only
```

Notes:

- Docker cleanup is best-effort and only targets safe defaults: exited containers and dangling images.
- If Docker is not installed, not running, or inaccessible, dev-purge will skip runtime cleanup and continue.
- `--older-than` is also applied to runtime artifacts when creation time is available.

### Delete all

`dev-purge -a` shows the full table, asks once for filesystem cleanup, then separately asks whether to clean any Docker leftovers that were found. Combines with filters:

```bash
dev-purge -a --older-than 6m            # everything untouched for 6 months
dev-purge -a --category cache           # all cache dirs
dev-purge -a --category deps -s 100m    # large dependency dirs only
dev-purge -a --category containers      # exited containers only
```

### JSON output

```bash
dev-purge --json | jq '.summary'
dev-purge --json | jq '.projects[] | select(.totalBytes > 1000000000)'
```

`--json` currently reports filesystem scan results only. Docker/runtime cleanup is shown in the interactive terminal output, not in the JSON payload.

### Watch mode

```bash
dev-purge --watch
```

Refreshes every 5 seconds. Useful for monitoring disk usage during development. Like `--json`, watch mode currently covers filesystem results only.

## Categories

Filter by category with `--category`:

| Category | Directories / artifacts |
|---|---|
| `deps` | node_modules, .pnpm-store, .yarn, vendor, bower_components, Pods, venv, .venv |
| `build` | .next, .nuxt, .output, .svelte-kit, .angular, .expo, .vercel, dist, build, out, target, DerivedData |
| `cache` | .cache, .parcel-cache, .turbo, .vite, \_\_pycache\_\_, .pytest_cache, .mypy_cache, .ruff_cache, .gradle, .dart_tool |
| `test` | coverage, .nyc_output, storybook-static |
| `containers` | exited Docker containers |
| `images` | dangling Docker images |

Multiple categories: `--category deps,build`

## All flags

```
--dry-run                Scan only, don't delete anything
-a, --all                Bulk-delete found directories, then optionally clean runtime artifacts
--older-than <dur>       Filter by project age (30d, 2w, 6m, 1y)
--category <cat>         Filter by category: deps, build, cache, test, containers, images (comma-separated)
-s, --min-size <size>    Minimum size to show (default: 1m, use -s 0 for all)
-d, --depth <n>          Max scan depth (default: 6)
--ide                    Also scan IDE caches (.cursor, .vscode, .idea)
--containers-only        Only include exited containers in runtime cleanup
--images-only            Only include dangling images in runtime cleanup
--json                   Output filesystem results as JSON
--watch                  Real-time monitoring
--ignore <glob>          Ignore matching absolute paths (repeatable)
-h, --help               Show help
```

## Smart defaults

- **1 MB minimum size** — tiny cache dirs (sub-KB `__pycache__`, etc.) are hidden by default. Use `-s 0` to see everything.
- **Framework detection** — automatically identifies Next.js, React, Python, Rust, Go, and 20+ other frameworks by reading project files. Python is also inferred from `__pycache__`/`.venv` when no project marker exists.
- **Safe scanning** — skips language runtimes (.pyenv, .nvm, .rustup, go/pkg), IDE internals, virtualenvs, and system directories. Won't flag `build`/`dist`/`vendor` unless the parent has a project marker file.
- **Safe Docker scope** — only exited containers and dangling images are considered for runtime cleanup.
- **Generic dir protection** — `build`, `dist`, `out`, `vendor`, `target`, and `coverage` are only flagged inside actual projects (determined by the presence of package.json, Cargo.toml, requirements.txt, etc.).

## How it works

1. **Scanner** recursively walks directories (parallel, batched) with configurable depth
2. **Detector** identifies bloat directories, categorizes them, and measures size
3. **Runtime inspector** optionally queries Docker for exited containers and dangling images
4. **Display** renders a sorted table (biggest first) with colored sizes and category breakdown
5. **Cleaner** deletes selected directories and runtime artifacts with progress feedback

## Platform support

- **macOS** — supported
- **Linux** — supported
- **Windows** — should work (not tested)

## License

MIT
