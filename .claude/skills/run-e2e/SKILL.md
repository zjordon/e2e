---
name: run-e2e
description: Build the e2e monorepo and drive the real app - launch the testbed playground with the built CLI, interact with it over the e2e MCP server (observe, tap, type, screenshot, record video), and run the deterministic test suite. Use when asked to run, build, start, test, or screenshot e2e, the testbed, or the playground app, or to try locators against the live app.
---

# run-e2e

This repo is the **e2e** agentic testing framework, not a single app. The thing
a user actually runs is the **built CLI** (`packages/e2e/dist/cli/bin.js`)
driving the **testbed playground** (`apps/testbed`, a real web app on
`http://127.0.0.1:4271`) through real Chromium. The interactive surface is the
`e2e mcp` stdio server: `open_session` boots the app + browser, then catalog
tools (`observe`, `tap`, `type`, `navigate`, `locate`, `screenshot`,
`start_recording`...) drive it. No model key needed — all of this is
deterministic.

**Driver:** `.claude/skills/run-e2e/driver.mjs` — a dependency-free stdin-line
REPL that speaks MCP to the server. All paths below are relative to the repo
root. Verified on native Windows 11 (Git Bash), Node v24.14.0, pnpm 12.3.4.

## Prerequisites

- Node `>=24.8` (verified with v24.14.0) and pnpm 12.3.4 (the `packageManager` pin).
- Chromium for the web engine — installed once into `ms-playwright/` by:

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/ pnpm --filter @e2e-dev/web exec playwright-core install chromium
```

(The mirror env var is for this network; plain `pnpm --filter @e2e-dev/web exec playwright-core install chromium` works where cdn.playwright.dev is reachable. Skip entirely if `chromium-1243` already exists under `%LOCALAPPDATA%\ms-playwright`.)

## Build

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/e2e/dist/cli/bin.js --version   # -> 0.19.0
```

Build is ~6s (TypeScript 7 native compiler, 8 packages). Rebuild after any
source change — every consumer below runs `dist/`, and a stale `dist` is the
most common false result (the repo's own `.dev/skills/verify` says so too).

## Run (agent path): the driver

Feed commands to the driver on stdin, one per line. `open` boots the playground
app and headless Chromium (~2s), then every line is one catalog call:

```bash
printf 'open\nobserve\nquit\n' | node .claude/skills/run-e2e/driver.mjs
```

A full user flow — add a todo, see the screen change, take a screenshot:

```bash
printf 'open\nnavigate {"url":"/todos"}\ntype {"target":"n6028","value":"buy milk"}\ntap {"target":"n6029"}\nscreenshot out/todo.png\nquit\n' | node .claude/skills/run-e2e/driver.mjs
```

Verified output of that flow: the tap's result reports
`added #n18002 listitem "buy milk ..."` and
`changed #n6034 status "Remaining" text="1 remaining"`, and `out/todo.png`
shows the rendered page (nav links, Todos heading, the new item, filter tabs).
Screenshots are masked (password fields blacked out); write them under `out/`
(gitignored).

Driver commands:

| Line | Effect |
| --- | --- |
| `open [target]` | `open_session`: load config, start app command, boot engine, first observation |
| `observe` | whole current screen, one node per line: `#id role "name"` |
| `screenshot [file]` | masked viewport to file (default `screenshot-01.png` in cwd) |
| `locate {"role":"button","name":"Add"}` | node ids that match + the `screen.*` call to write in a test |
| `tap {"target":"n6029"}` / `type {"target":"n6028","value":"..."}` / `navigate {"url":"/todos"}` / `press` / `check` / `scroll` / `drag` / ... | any catalog tool: `<name> {json args}` |
| `close` | `close_session` (stops the app the session started) |
| `quit` (or EOF) | disconnect — all sessions close, server exits 0 |

Reading node ids: **run `observe` in the same session before acting** — ids are
valid only against the newest observation. They are minted per observation
sequence, so an identical command sequence produces identical ids (the scripted
pipe above relies on that), but any inserted step renumbers the page content.

Session artifacts land in `apps/testbed/.e2e/results/mcp/web-<attemptId>/`;
videos from `start_recording`/`stop_recording` in `apps/testbed/.e2e/videos/`.
A later `e2e run` clears `results/`; videos stay.

## Run: the deterministic suite

The repo's own gate (and the fastest full-app sanity check):

```bash
cd apps/testbed && node node_modules/e2e/dist/cli/bin.js run
```

Verified: 15 files / 77 tests passed, 1 skipped, ~26s. One file:

```bash
cd apps/testbed && node node_modules/e2e/dist/cli/bin.js run tests/todos.e2e.ts
```

The suite needs no model. The agentic suites (`test:agent`, `test:dogfood`)
need `AI_GATEWAY_API_KEY` and are not covered here.

## Gotchas

- **First visual-test run on a new platform writes baselines and fails once.**
  `tests/visual.e2e.ts` compares against `-linux`/`-darwin` PNGs committed in
  the repo; on win32 the first run writes `*-web-win32.png` and fails with
  `ASSERTION_FAILED: no stored screenshot` ("look at it, commit it, and run
  again"). Second run: 4/4 green. Commit the `-win32` files or accept the
  one-time failure.
- **`call` nests its arguments.** The MCP protocol is `call {tool, args}` — a
  flat `{tool, url}` is `Unrecognized key`. The driver nests for you; raw
  protocol users must not.
- **`screenshot` is a catalog tool**, not one of the four management tools
  (`open_session`/`tools`/`call`/`close_session`) — it must go through `call`.
- **Port 4271 is the playground's.** `open_session` starts the app command and
  stops it on close; if another run or session holds the port you get
  `APP_ALREADY_RUNNING` — wait for it or stop the other run, never kill a
  process you did not start.
- **Playwright CDN may crawl.** Use the `PLAYWRIGHT_DOWNLOAD_HOST` mirror line
  above; the browser install is a one-time ~310 MB.
- The CLI's `run` output is ANSI-colored; strip with `--reporter list` piping
  or read `.e2e/report.json` for the canonical result.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `pnpm` errors with a GBK-garbled path under `D:\.pnpm-store\...` | The self-managed global pnpm store link is dead. `npm install -g pnpm@12.3.4` reinstalls a working one. |
| `pnpm install` modifies `pnpm-lock.yaml` (removes `@pnpm/exe` entries) | Metadata-only diff caused by an npm-installed pnpm; harmless. Use `corepack prepare pnpm@12.3.4 --activate` instead if the lockfile must stay byte-identical. |
| Browser launch fails / missing chromium | Run the `playwright-core install chromium` line from Prerequisites. |
| `Unrecognized key: "url"` on a driver line | You flattened the args — keep them nested: `navigate {"url":"/todos"}` (or use the driver, which nests). |
| `LOCATOR_NOT_FOUND` on a scripted tap | The command sequence before it changed, renumbering ids — `observe` again in that session and use fresh ids. |
| Visual tests fail with "no stored screenshot ... win32.png" | Baseline first-run behavior; rerun, then optionally commit the new `*-win32.png`. |
