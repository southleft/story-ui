#!/usr/bin/env bash
#
# Durability bench — does generation + verification hold up on design systems
# the model has NOT memorised, from the packed tarball, with nothing hand-set?
#
#   bench/durability.sh [options] dir:mcpPort:sbPort [dir:mcpPort:sbPort ...]
#
#   bench/durability.sh ../test-storybooks/carbon:4109:6109 \
#                       ../test-storybooks/mui-material:4107:6107 \
#                       ../test-storybooks/atlaskit:4108:6108
#
# Options (before the environments):
#   --scenarios ids   comma-separated fidelity scenario ids (default: the three
#                     whose prompts name no library: pricing-page,data-table,settings-page)
#   --provider name   LLM provider passed to the bench (default: claude)
#   --model id        model passed to the bench (default: the server's default)
#   --tgz path        tarball to install (default: newest tpitre-story-ui-*.tgz in the repo root)
#   --key-from path   .env to copy ANTHROPIC_API_KEY from when a project lacks one
#                     (default: ../test-storybooks/react-mantine/.env). Never printed.
#   --reinstall       install the tarball even when the marker says it is current
#
# Per environment, in order, each step recorded in <results>/<env>.env.txt:
#   1. ports free                       ENVIRONMENT problem if not
#   2. tarball installed                npm install --no-save <tgz>, when the
#                                       marker sha differs, the package is a
#                                       symlink (a `file:` link to the repo is
#                                       not the tarball), or it is missing
#   3. story-ui.config.js exists        else `npx story-ui init --yes --json`;
#                                       what detection chose is recorded
#   4. ANTHROPIC_API_KEY in .env        copied from --key-from if absent
#   5. Playwright Chromium present      else `npx playwright install chromium`
#   6. server up (/health)              PORT=<mcp> node node_modules/@tpitre/story-ui/dist/mcp-server/index.js
#   7. storybook up (/index.json)       npx storybook dev -p <sb> --no-open --ci
#   8. node bench/fidelity.mjs --generic ...
#   9. both processes stopped
#
# Output: bench/results/durability-<timestamp>/
#   <env>.md            that environment's fidelity report
#   <env>/<stamp>/      the full bench run (events, code, screenshots, summary.json)
#   <env>.env.txt       setup facts, one key=value per line
#   <env>.server.log    <env>.storybook.log   <env>.setup.log
#   README.md           the combined table, from bench/durability/summarize.mjs
#
# Timeouts are the bench's own (720s per generation); this script adds none
# around generation. A step that cannot run is recorded as such and the
# environment is skipped — a skipped environment is not a failed one.

set -u

STORY_UI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIOS="pricing-page,data-table,settings-page"
PROVIDER="claude"
MODEL=""
TGZ=""
KEY_FROM="$STORY_UI_ROOT/../test-storybooks/react-mantine/.env"
REINSTALL=0
ENVS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --scenarios) SCENARIOS="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --tgz) TGZ="$2"; shift 2 ;;
    --key-from) KEY_FROM="$2"; shift 2 ;;
    --reinstall) REINSTALL=1; shift ;;
    --help|-h) sed -n '2,45p' "$0"; exit 0 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) ENVS+=("$1"); shift ;;
  esac
done

if [ ${#ENVS[@]} -eq 0 ]; then echo "usage: bench/durability.sh [options] dir:mcpPort:sbPort ..." >&2; exit 2; fi

if [ -z "$TGZ" ]; then
  TGZ="$(ls -t "$STORY_UI_ROOT"/tpitre-story-ui-*.tgz 2>/dev/null | head -1 || true)"
fi
if [ -z "$TGZ" ] || [ ! -f "$TGZ" ]; then echo "no tarball found (run \`npm pack\` or pass --tgz)" >&2; exit 2; fi
TGZ="$(cd "$(dirname "$TGZ")" && pwd)/$(basename "$TGZ")"
TGZ_SHA="$(shasum -a 256 "$TGZ" | cut -d' ' -f1)"
TGZ_VERSION="$(tar -xzOf "$TGZ" package/package.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"

STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
RESULTS="$STORY_UI_ROOT/bench/results/durability-$STAMP"
mkdir -p "$RESULTS"

MAIN_LOG="$RESULTS/durability.log"
say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$MAIN_LOG"; }

say "durability bench $STAMP"
say "tarball $TGZ (v$TGZ_VERSION, sha256 ${TGZ_SHA:0:12})"
say "scenarios $SCENARIOS  provider $PROVIDER  model ${MODEL:-(server default)}"
say "results $RESULTS"

# ---------------------------------------------------------------- helpers

# Kill a process and everything under it. `npx storybook dev` is a chain of
# node processes; killing only the top one leaves Vite holding the port.
kill_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

port_pids() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true; }

free_port() {
  local port="$1" pids
  pids="$(port_pids "$port")"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 2
    pids="$(port_pids "$port")"
    # shellcheck disable=SC2086
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
}

# Wait for an HTTP 200 on a URL. Prints the seconds waited, returns 1 on timeout.
wait_http() {
  local url="$1" limit="$2" started now code
  started=$(date +%s)
  while :; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)"
    now=$(date +%s)
    if [ "$code" = "200" ]; then echo $((now - started)); return 0; fi
    if [ $((now - started)) -ge "$limit" ]; then echo $((now - started)); return 1; fi
    sleep 2
  done
}

# ---------------------------------------------------------------- per env

run_env() {
  local spec="$1"
  local dir mcp sb name
  dir="${spec%%:*}"; spec="${spec#*:}"
  mcp="${spec%%:*}"; sb="${spec#*:}"
  if [ -z "$dir" ] || [ -z "$mcp" ] || [ -z "$sb" ] || [ "$mcp" = "$sb" ]; then say "bad environment spec: $1 (want dir:mcpPort:sbPort)"; return; fi
  dir="$(cd "$dir" 2>/dev/null && pwd || echo "$dir")"
  name="$(basename "$dir")"
  local facts="$RESULTS/$name.env.txt"
  local setup_log="$RESULTS/$name.setup.log"
  local server_pid="" sb_pid=""
  local t_env_start
  t_env_start=$(date +%s)

  fact() { printf '%s=%s\n' "$1" "$2" >> "$facts"; }
  : > "$facts"
  fact env "$name"
  fact dir "$dir"
  fact mcpPort "$mcp"
  fact sbPort "$sb"
  fact tgz "$(basename "$TGZ")"
  fact tgzVersion "$TGZ_VERSION"

  say ""
  say "=================================================================="
  say "=== $name  ($dir)  mcp $mcp  storybook $sb"

  finish_env() {
    # $1 = outcome, $2 = reason
    fact outcome "$1"
    fact reason "${2:-}"
    fact durationS "$(( $(date +%s) - t_env_start ))"
    if [ -n "$sb_pid" ]; then kill_tree "$sb_pid"; fi
    if [ -n "$server_pid" ]; then kill_tree "$server_pid"; fi
    sleep 2
    free_port "$mcp"; free_port "$sb"
    say "=== $name: $1${2:+ — $2}"
  }

  if [ ! -f "$dir/package.json" ]; then finish_env skipped "no package.json at $dir"; return; fi

  # 1. ports
  if [ -n "$(port_pids "$mcp")" ]; then fact portCheck "mcp $mcp in use by pid $(port_pids "$mcp" | tr '\n' ' ')"; finish_env skipped "port $mcp already in use (ENVIRONMENT)"; return; fi
  if [ -n "$(port_pids "$sb")" ]; then fact portCheck "storybook $sb in use by pid $(port_pids "$sb" | tr '\n' ' ')"; finish_env skipped "port $sb already in use (ENVIRONMENT)"; return; fi
  fact portCheck "free"

  # 2. tarball
  local pkg_dir="$dir/node_modules/@tpitre/story-ui"
  local marker="$pkg_dir/.durability-tgz.sha256"
  local install_reason=""
  if [ "$REINSTALL" = 1 ]; then install_reason="--reinstall"
  elif [ -L "$pkg_dir" ]; then install_reason="package is a symlink ($(readlink "$pkg_dir")), not the tarball"
  elif [ ! -f "$pkg_dir/package.json" ]; then install_reason="package missing"
  elif [ ! -f "$marker" ]; then install_reason="no install marker (not installed by this script)"
  elif [ "$(cat "$marker")" != "$TGZ_SHA" ]; then install_reason="marker sha $(cut -c1-12 "$marker") != tarball ${TGZ_SHA:0:12}"
  fi
  if [ -n "$install_reason" ]; then
    say "    installing tarball: $install_reason"
    local t0 t1
    t0=$(date +%s)
    # A `file:` link in package.json would be re-linked by a plain
    # `npm install`; naming the tarball on the command line overrides the
    # spec for this package only, and --no-save leaves package.json alone.
    if [ -L "$pkg_dir" ]; then rm -f "$pkg_dir"; fi
    if (cd "$dir" && npm install --no-save --no-audit --no-fund --loglevel=error "$TGZ" >> "$setup_log" 2>&1); then
      t1=$(date +%s)
      if [ -L "$pkg_dir" ]; then
        fact install "npm re-linked the package to $(readlink "$pkg_dir") instead of extracting the tarball"
        finish_env skipped "tarball not installed: npm honoured the package.json file: link (ENVIRONMENT)"; return
      fi
      printf '%s' "$TGZ_SHA" > "$marker"
      fact install "installed ($install_reason) in $((t1 - t0))s"
    else
      fact install "FAILED ($install_reason); see $(basename "$setup_log")"
      finish_env skipped "npm install of the tarball failed (ENVIRONMENT)"; return
    fi
  else
    fact install "current (marker matches tarball sha)"
  fi
  local installed_version
  installed_version="$(node -e "console.log(require('$pkg_dir/package.json').version)" 2>/dev/null || echo '?')"
  fact installedVersion "$installed_version"
  if [ ! -f "$pkg_dir/dist/mcp-server/index.js" ]; then finish_env skipped "installed package has no dist/mcp-server/index.js (ENVIRONMENT)"; return; fi
  # The package's own dependencies must resolve from the PROJECT now.
  if ! (cd "$dir" && node -e "require.resolve('express', { paths: ['$pkg_dir'] })" >> "$setup_log" 2>&1); then
    fact depsResolve "express NOT resolvable from $pkg_dir"
    finish_env skipped "tarball dependencies did not install (ENVIRONMENT)"; return
  fi
  fact depsResolve "ok"

  # 3. config
  if [ -f "$dir/story-ui.config.js" ]; then
    fact config "existing story-ui.config.js"
  else
    say "    no story-ui.config.js — running npx story-ui init --yes --json"
    local init_out
    init_out="$(cd "$dir" && CI=true npx story-ui init --yes --json --skip-install 2>&1 | tee -a "$setup_log" | grep '^STORY_UI_INIT ' | tail -1 || true)"
    if [ -n "$init_out" ]; then
      fact config "created by init"
      fact initDetected "${init_out#STORY_UI_INIT }"
    else
      fact config "init ran but printed no STORY_UI_INIT line; see $(basename "$setup_log")"
    fi
    [ -f "$dir/story-ui.config.js" ] || { finish_env skipped "init did not create story-ui.config.js (ENVIRONMENT)"; return; }
  fi
  local cfg
  cfg="$(cd "$dir" && node --input-type=module -e "
    import { pathToFileURL } from 'url';
    const m = await import(pathToFileURL(process.cwd() + '/story-ui.config.js').href);
    const c = m.default || m;
    console.log(JSON.stringify({ importPath: c.importPath, importStyle: c.importStyle, generatedStoriesPath: c.generatedStoriesPath, componentFramework: c.componentFramework, componentsPath: c.componentsPath ?? null, declaredComponents: Array.isArray(c.components) ? c.components.length : null }));
  " 2>/dev/null || echo '{"error":"config not importable"}')"
  fact configFacts "$cfg"
  say "    config: $cfg"

  # 4. API key
  local envfile="$dir/.env"
  if [ -f "$envfile" ] && grep -q '^ANTHROPIC_API_KEY=.\+' "$envfile"; then
    fact apiKey "present in .env"
  elif [ -f "$KEY_FROM" ] && grep -q '^ANTHROPIC_API_KEY=.\+' "$KEY_FROM"; then
    { [ -f "$envfile" ] && [ -n "$(tail -c1 "$envfile")" ] && echo; grep '^ANTHROPIC_API_KEY=' "$KEY_FROM" | head -1; } >> "$envfile"
    fact apiKey "copied from $(basename "$(dirname "$KEY_FROM")")/.env"
    say "    ANTHROPIC_API_KEY copied into .env (value not shown)"
  else
    fact apiKey "MISSING and no source to copy from"
    finish_env skipped "no ANTHROPIC_API_KEY (ENVIRONMENT)"; return
  fi

  # 5. Playwright Chromium
  local chromium
  chromium="$(cd "$dir" && node -e "
    let pw; try { pw = require('playwright'); } catch { try { pw = require('playwright-core'); } catch { console.log('NO_PLAYWRIGHT'); process.exit(0); } }
    const p = pw.chromium.executablePath(); console.log(require('fs').existsSync(p) ? 'OK ' + p : 'MISSING ' + p);
  " 2>/dev/null || echo 'NO_PLAYWRIGHT')"
  case "$chromium" in
    OK\ *) fact playwright "chromium present (${chromium#OK })" ;;
    NO_PLAYWRIGHT) fact playwright "playwright not installed in the project — verification will be not_verified" ;;
    *)
      say "    installing Chromium for the project's Playwright"
      if (cd "$dir" && npx playwright install chromium >> "$setup_log" 2>&1); then fact playwright "chromium installed now"; else fact playwright "chromium install FAILED (was: $chromium)"; fi ;;
  esac

  # 6. server
  say "    starting server on $mcp"
  local t0 waited
  t0=$(date +%s)
  (cd "$dir" && PORT="$mcp" exec node "$pkg_dir/dist/mcp-server/index.js" > "$RESULTS/$name.server.log" 2>&1) &
  server_pid=$!
  if waited="$(wait_http "http://localhost:$mcp/health" 90)"; then
    fact serverUpS "$waited"
  else
    fact serverUpS "TIMEOUT after ${waited}s; tail: $(tail -3 "$RESULTS/$name.server.log" | tr '\n' ' ' | cut -c1-300)"
    finish_env skipped "server never answered /health (see $name.server.log)"; return
  fi

  # 7. storybook
  say "    starting storybook on $sb"
  t0=$(date +%s)
  (cd "$dir" && exec npx storybook dev -p "$sb" --no-open --ci > "$RESULTS/$name.storybook.log" 2>&1) &
  sb_pid=$!
  if waited="$(wait_http "http://localhost:$sb/index.json" 300)"; then
    fact storybookUpS "$waited"
    fact storybookEntries "$(curl -s --max-time 10 "http://localhost:$sb/index.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(Object.keys(JSON.parse(s).entries||{}).length)}catch{console.log("?")}})')"
  else
    fact storybookUpS "TIMEOUT after ${waited}s; tail: $(tail -3 "$RESULTS/$name.storybook.log" | tr '\n' ' ' | cut -c1-300)"
    finish_env skipped "storybook never served /index.json (see $name.storybook.log)"; return
  fi

  # 8. bench
  say "    running fidelity bench (--generic) — expect minutes per scenario"
  local bench_args=(--generic --server "http://localhost:$mcp" --storybook "http://localhost:$sb" --project "$dir" --only "$SCENARIOS" --out "$RESULTS/$name")
  [ -n "$PROVIDER" ] && bench_args+=(--provider "$PROVIDER")
  [ -n "$MODEL" ] && bench_args+=(--model "$MODEL")
  t0=$(date +%s)
  (cd "$STORY_UI_ROOT" && node bench/fidelity.mjs "${bench_args[@]}" 2>&1 | tee -a "$MAIN_LOG" | sed 's/^/      /')
  local bench_exit=${PIPESTATUS[0]}
  fact benchExit "$bench_exit"
  fact benchS "$(( $(date +%s) - t0 ))"
  local run_dir
  run_dir="$(ls -td "$RESULTS/$name"/*/ 2>/dev/null | head -1 || true)"
  if [ -n "$run_dir" ] && [ -f "$run_dir/report.md" ]; then
    cp "$run_dir/report.md" "$RESULTS/$name.md"
    fact runDir "${run_dir%/}"
    finish_env ran ""
  else
    fact runDir ""
    finish_env failed "bench produced no report.md (exit $bench_exit); see durability.log"
  fi
}

for spec in "${ENVS[@]}"; do
  run_env "$spec"
done

say ""
say "summarising"
node "$STORY_UI_ROOT/bench/durability/summarize.mjs" "$RESULTS" | tee -a "$MAIN_LOG"
say "done: $RESULTS/README.md"
