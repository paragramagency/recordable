import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Recordable } from "../../src/index.js";
import { tmpDir } from "../helpers.js";

// ─── End-to-end: browser language ────────────────────────────────────────────
//
// Proves the `language` config takes real effect in a live browser, across both
// layers it touches:
//   • the `Accept-Language` request header (page.setExtraHTTPHeaders)
//   • `navigator.language` / `navigator.languages` (the `--lang` launch flag)
//
// A `file://` page sends no Accept-Language and gives nothing to observe, so we
// serve the fixture from a throwaway local HTTP server: it records the header off
// the document request, and the page beacons its navigator locale back to a
// `/report` endpoint. Headless + --no-sandbox so it runs in CI/containers.
//
// Run via `npm run test:e2e`.

/** Fixture page: beacons navigator.language/languages back so the server (and so
 *  the test) can read what the browser actually exposed. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script>
  fetch("/report?lang=" + encodeURIComponent(navigator.language) +
        "&langs=" + encodeURIComponent(navigator.languages.join(",")));
</script></head><body><p id="ok">ready</p></body></html>`;

interface Observed {
  /** Accept-Language header the server saw on the document request. */
  acceptLanguage?: string;
  /** navigator.language the page reported. */
  navLang?: string;
  /** navigator.languages (comma-joined) the page reported. */
  navLangs?: string;
}

/**
 * Drive a real recording against a local server with the given `language` config
 * (omitted entirely when undefined), returning what the browser exposed. A fresh
 * ephemeral-port server per call keeps runs isolated.
 */
async function record(language?: string): Promise<Observed> {
  const seen: Observed = {};
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/report") {
      seen.navLang = url.searchParams.get("lang") ?? undefined;
      seen.navLangs = url.searchParams.get("langs") ?? undefined;
      res.writeHead(204).end();
      return;
    }
    // Document request — capture the negotiated header, then serve the page.
    seen.acceptLanguage = req.headers["accept-language"];
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;

  try {
    await new Recordable({
      headless: true,
      launchArgs: ["--no-sandbox"],
      outputDir: tmpDir(),
      outputName: "lang",
      outputTimestamp: false,
      silent: true,
      ...(language ? { language } : {}),
    })
      .fromJSON([
        { action: "visit", url },
        // The beacon fires during head parse; networkidle2 + this gate ensure it
        // has landed before the run ends.
        { action: "waitFor", target: "#ok" },
      ])
      .run();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  return seen;
}

// Two explicit locales (not one) so the assertions prove the *config value*
// drives the result rather than coincidentally matching the host locale.
for (const { locale, prefix } of [
  { locale: "fr-FR", prefix: "fr" },
  { locale: "de-DE", prefix: "de" },
]) {
  test(
    `language: "${locale}" sets Accept-Language and navigator.language`,
    { timeout: 120_000 },
    async () => {
      const { acceptLanguage, navLang, navLangs } = await record(locale);

      assert.ok(
        acceptLanguage?.startsWith(locale),
        `Accept-Language should start with "${locale}", got "${acceptLanguage}"`,
      );
      assert.ok(
        navLang?.startsWith(prefix),
        `navigator.language should start with "${prefix}", got "${navLang}"`,
      );
      assert.ok(
        navLangs?.includes(prefix),
        `navigator.languages should include "${prefix}", got "${navLangs}"`,
      );
    },
  );
}

test(
  "no language config leaves the locale unforced (opt-in)",
  { timeout: 120_000 },
  async () => {
    // Assumes the host/CI locale is neither French nor German — true on the
    // standard en-US CI image. Guards against the feature being always-on.
    const { acceptLanguage, navLang } = await record();
    assert.ok(
      !acceptLanguage?.startsWith("fr-FR") &&
        !acceptLanguage?.startsWith("de-DE"),
      `default Accept-Language unexpectedly forced: "${acceptLanguage}"`,
    );
    assert.ok(
      !navLang?.startsWith("fr") && !navLang?.startsWith("de"),
      `default navigator.language unexpectedly forced: "${navLang}"`,
    );
  },
);
