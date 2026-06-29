import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfig, dirsToScan } from "../src/config-file.js";
import { normalizeVarName } from "../src/variables.js";
import { isRecordableError } from "../src/errors.js";

// ─── File discovery: recordable.config.json + .env ───────────────────────────
//
// The bounded walk baseDir → ceiling, depth-merged (deeper wins), surfacing
// config / voiceover / config-file variables / `.env` `VAR_*`. Temp dirs sit
// under the OS tmp so we drive the walk explicitly with an explicit `ceiling`;
// any `process.env` keys these set are cleared in `after`.

// Track temp dirs + process.env keys for teardown.
const tmpDirs: string[] = [];
const envKeys = new Set<string>();

function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "rc-discover-"));
  tmpDirs.push(d);
  return d;
}

function writeConfig(dir: string, obj: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "recordable.config.json"), JSON.stringify(obj));
}

function writeEnv(dir: string, contents: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".env"), contents);
}

function setEnv(key: string, value: string): void {
  envKeys.add(key);
  process.env[key] = value;
}

after(() => {
  for (const k of envKeys) delete process.env[k];
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// ─── dirsToScan ──────────────────────────────────────────────────────────────

test("dirsToScan: start === ceiling → just [start]", () => {
  assert.deepEqual(dirsToScan("/a/b/c", "/a/b/c"), ["/a/b/c"]);
});

test("dirsToScan: nested start → shallow → deep, ceiling included", () => {
  assert.deepEqual(dirsToScan("/a/b/c/d", "/a/b"), [
    "/a/b",
    "/a/b/c",
    "/a/b/c/d",
  ]);
});

test("dirsToScan: start not under ceiling → just [start] (never wander)", () => {
  assert.deepEqual(dirsToScan("/x/y", "/a/b"), ["/x/y"]);
});

test("dirsToScan: empty baseDir falls back to the ceiling", () => {
  assert.deepEqual(dirsToScan("", "/a/b"), ["/a/b"]);
});

// ─── discoverConfig: config + variables depth-merge ──────────────────────────

test("discoverConfig: deeper config key wins; shallow var inherited, deeper var overrides", () => {
  const root = freshDir();
  const sub = join(root, "demo");
  writeConfig(root, {
    fps: 24,
    outputName: "shallow",
    variables: { shared: "root", onlyRoot: "R" },
  });
  writeConfig(sub, {
    fps: 50,
    variables: { shared: "sub", onlySub: "S" },
  });

  const d = discoverConfig({ baseDir: sub, ceiling: root });

  // Config: deeper (sub) wins on `fps`; the untouched root key is inherited.
  assert.equal(d.config.fps, 50);
  assert.equal(d.config.outputName, "shallow");

  // Variables: deeper wins on `shared`; both unique keys present.
  const v = d.variables;
  assert.equal(v.get(normalizeVarName("shared"))?.value, "sub");
  assert.equal(v.get(normalizeVarName("onlyRoot"))?.value, "R");
  assert.equal(v.get(normalizeVarName("onlySub"))?.value, "S");

  // Both files appear in the source log, shallow → deep.
  assert.equal(d.sources.filter((s) => s.startsWith("config:")).length, 2);
});

test("discoverConfig: the voiceover section is surfaced as defaults", () => {
  const dir = freshDir();
  writeConfig(dir, {
    voiceover: { provider: "elevenlabs", voiceId: "v1" },
  });
  const d = discoverConfig({ baseDir: dir, ceiling: dir });
  assert.deepEqual(d.voiceover, { provider: "elevenlabs", voiceId: "v1" });
});

test("discoverConfig: no files → empty layers, no sources, defaults unfilled", () => {
  const dir = freshDir();
  const d = discoverConfig({ baseDir: dir, ceiling: dir });
  assert.deepEqual(d.config, {});
  assert.equal(d.variables.size, 0);
  assert.equal(d.envVariables.size, 0);
  assert.deepEqual(d.sources, []);
});

// ─── discoverConfig: .env handling ───────────────────────────────────────────

test("discoverConfig: .env VAR_* → envVariables layer, prefix stripped + normalized", () => {
  const dir = freshDir();
  writeEnv(dir, "VAR_EMAIL_ADDRESS=ada@example.com\nVAR_PLAN=pro\n");
  const d = discoverConfig({ baseDir: dir, ceiling: dir });

  // `VAR_EMAIL_ADDRESS` ≡ {{emailAddress}} ≡ {{email_address}}.
  assert.equal(
    d.envVariables.get(normalizeVarName("emailAddress"))?.value,
    "ada@example.com",
  );
  assert.equal(d.envVariables.get(normalizeVarName("plan"))?.value, "pro");
  assert.equal(d.envVariables.get(normalizeVarName("plan"))?.source, ".env");
});

test("discoverConfig: non-VAR secrets inject into process.env; VAR_* never leak there", () => {
  const dir = freshDir();
  envKeys.add("ELEVENLABS_API_KEY"); // discovery injects it — clean up after
  envKeys.add("VAR_SECRET_TOKEN"); // belt-and-braces, in case of a regression
  delete process.env.ELEVENLABS_API_KEY;
  writeEnv(dir, "ELEVENLABS_API_KEY=sk-from-file\nVAR_SECRET_TOKEN=hush\n");

  discoverConfig({ baseDir: dir, ceiling: dir });

  // The non-VAR secret flows into process.env for the voiceover layer …
  assert.equal(process.env.ELEVENLABS_API_KEY, "sk-from-file");
  // … but the VAR_-prefixed secret is allowlisted *out* of process.env.
  assert.equal(process.env.VAR_SECRET_TOKEN, undefined);
});

test("discoverConfig: a real process.env secret wins over the .env file", () => {
  const dir = freshDir();
  setEnv("ELEVENLABS_API_KEY", "sk-from-real-env");
  writeEnv(dir, "ELEVENLABS_API_KEY=sk-from-file\n");

  discoverConfig({ baseDir: dir, ceiling: dir });
  assert.equal(process.env.ELEVENLABS_API_KEY, "sk-from-real-env");
});

test("discoverConfig: process.env VAR_* overlays .env VAR_* (real env wins)", () => {
  const dir = freshDir();
  setEnv("VAR_PLAN", "from-real-env");
  writeEnv(dir, "VAR_PLAN=from-file\n");

  const d = discoverConfig({ baseDir: dir, ceiling: dir });
  const entry = d.envVariables.get(normalizeVarName("plan"));
  assert.equal(entry?.value, "from-real-env");
  assert.equal(entry?.source, "process.env");

  // Don't leak VAR_PLAN — a real-env VAR_* overlays *every* later discovery.
  delete process.env.VAR_PLAN;
});

// ─── discoverConfig: explicit overrides bypass the walk ──────────────────────

test("discoverConfig: configPath/envFile use exactly those files, not the walk", () => {
  const walked = freshDir();
  const sub = join(walked, "demo");
  // Files in the walk that must NOT be read when explicit paths are given.
  writeConfig(walked, { fps: 24, variables: { plan: "walked" } });
  writeEnv(sub, "VAR_PLAN=walked\n");

  // The explicit pair lives in an unrelated dir.
  const pick = freshDir();
  writeConfig(pick, { fps: 99, variables: { plan: "picked" } });
  writeEnv(pick, "VAR_PLAN=picked\n");

  const d = discoverConfig({
    baseDir: sub,
    ceiling: walked,
    configPath: join(pick, "recordable.config.json"),
    envFile: join(pick, ".env"),
  });

  assert.equal(d.config.fps, 99); // from the picked config, not the walked 24
  assert.equal(d.variables.get(normalizeVarName("plan"))?.value, "picked");
  assert.equal(d.envVariables.get(normalizeVarName("plan"))?.value, "picked");
  // Exactly one config + one env file contributed.
  assert.equal(d.sources.filter((s) => s.startsWith("config:")).length, 1);
  assert.equal(d.sources.filter((s) => s.startsWith("env:")).length, 1);
});

// ─── discoverConfig: validation errors ───────────────────────────────────────

test("discoverConfig: malformed JSON throws CONFIG_INVALID naming the file", () => {
  const dir = freshDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "recordable.config.json"), "{ not valid json ");
  try {
    discoverConfig({ baseDir: dir, ceiling: dir });
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(isRecordableError(err));
    assert.equal(err.code, "CONFIG_INVALID");
    assert.match(err.message, /invalid JSON/);
  }
});

test("discoverConfig: a non-string variable value is a validation error", () => {
  const dir = freshDir();
  writeConfig(dir, { variables: { plan: 5 } });
  assert.throws(
    () => discoverConfig({ baseDir: dir, ceiling: dir }),
    (err: unknown) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

test("discoverConfig: a non-object `variables` section is rejected", () => {
  const dir = freshDir();
  writeConfig(dir, { variables: "nope" });
  assert.throws(
    () => discoverConfig({ baseDir: dir, ceiling: dir }),
    /"variables" must be an object/,
  );
});
