# dev-purge

Find and clean build artifacts, dependency folders, and cache directories across all your projects. One command to reclaim gigabytes of disk space.

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
dev-purge --dry-run               # Show bloat without deleting
dev-purge -a                      # Single confirmation to delete all
dev-purge -a --older-than 1y      # Nuke everything older than a year
dev-purge -a --category cache --older-than 6m  # Nuke old caches
dev-purge --category deps         # Only node_modules, venv, Pods, etc.
dev-purge -s 100m                 # Only show bloat > 100 MB
dev-purge -s 0                    # Show everything (no size minimum)
dev-purge --json                  # Machine-readable JSON output
dev-purge --watch                 # Real-time disk usage monitoring
dev-purge --ignore node_modules   # Exclude matching paths from the scan
```

### Interactive mode (default)

Cycles through each project and asks y/n. Shows the project name, framework, bloat directories, total size, and age. Ctrl+C to stop anytime.

```
  [1/18] finance-landing-page (Next.js) — 1.1 GB • 1 month ago
         node_modules (801.7 MB), .next (315.0 MB)
  Clean? (y/n)
```

### Delete all

`dev-purge -a` shows the full table then asks once to delete everything. Combines with filters:

```bash
dev-purge -a --older-than 6m            # everything untouched for 6 months
dev-purge -a --category cache           # all cache dirs, one confirmation
dev-purge -a --category deps -s 100m    # large dependency dirs only
```

### JSON output

```bash
dev-purge --json | jq '.summary'
dev-purge --json | jq '.projects[] | select(.totalBytes > 1000000000)'
```

### Watch mode

```bash
dev-purge --watch
```

Refreshes every 5 seconds. Useful for monitoring disk usage during development.

### Ignoring folders

Exclude folders from scans with repeatable `--ignore` patterns:

```bash
dev-purge --ignore node_modules           # ignore any path segment named node_modules
dev-purge --ignore ./legacy-app           # ignore a path relative to the scan root
dev-purge --ignore '~/Library/Caches/**'  # ignore an absolute/home-relative glob
```

You can also define defaults in `~/.config/dev-purge/config.json`:

```json
{
  "ignore": ["~/.vscode-server/**", "./vendor"]
}
```

Ignore patterns support absolute paths, paths relative to the scan root, bare directory names, `~`, `*`, `?`, and `**`. The same ignore rules apply in watch mode.

## Categories

Filter by category with `--category`:

| Category | Directories |
|---|---|
| `deps` | node_modules, .pnpm-store, .yarn, vendor, bower_components, Pods, venv, .venv |
| `build` | .next, .nuxt, .output, .svelte-kit, .angular, .expo, .vercel, dist, build, out, target, DerivedData |
| `cache` | .cache, .parcel-cache, .turbo, .vite, \_\_pycache\_\_, .pytest_cache, .mypy_cache, .ruff_cache, .gradle, .dart_tool |
| `test` | coverage, .nyc_output, storybook-static |

Multiple categories: `--category deps,build`

## All flags

```
--dry-run                Scan only, don't delete anything
-a, --all                Delete all found bloat with single confirmation
--older-than <dur>       Filter by project age (30d, 2w, 6m, 1y)
--category <cat>         Filter by category (comma-separated)
-s, --min-size <size>    Minimum size to show (default: 1m, use -s 0 for all)
-d, --depth <n>          Max scan depth (default: 6)
--ide                    Also scan IDE caches (.cursor, .vscode, .idea)
--json                   Output as JSON
--watch                  Real-time monitoring
--ignore <glob>          Ignore paths (absolute, relative to scan root, or bare dir name; repeatable)
-h, --help               Show help
```

## Smart defaults

- **1 MB minimum size** — tiny cache dirs (sub-KB `__pycache__`, etc.) are hidden by default. Use `-s 0` to see everything.
- **Framework detection** — automatically identifies Next.js, React, Python, Rust, Go, and 20+ other frameworks by reading project files. Python is also inferred from `__pycache__`/`.venv` when no project marker exists.
- **Safe scanning** — skips language runtimes (.pyenv, .nvm, .rustup, go/pkg), IDE internals, virtualenvs, and system directories. Won't flag `build`/`dist`/`vendor` unless the parent has a project marker file.
- **Generic dir protection** — `build`, `dist`, `out`, `vendor`, `target`, and `coverage` are only flagged inside actual projects (determined by the presence of package.json, Cargo.toml, requirements.txt, etc.).

## How it works

1. **Scanner** recursively walks directories (parallel, batched) with configurable depth
2. **Detector** identifies bloat directories, categorizes them, and measures size
3. **Display** renders a sorted table (biggest first) with colored sizes and category breakdown
4. **Cleaner** deletes selected directories with progress feedback

## Platform support

- **macOS** — supported
- **Linux** — supported
- **Windows** — should work (not tested)

## License

MIT
