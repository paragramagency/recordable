# Spec: Variables system

ROADMAP #2. Reusable values (URLs, credentials, names, labels, selectors) defined once and
referenced across a script with `{{name}}`, instead of hard-coded inline. Works across
JSON, Markdown, and the programmatic API. Builds on the `.env` loading shipped with
default-config.

## Guiding principle: split the three jobs `.env` was doing

Today `.env` is overloaded with three unrelated concerns. This feature separates them:

- **Secrets** (ElevenLabs key, passwords) → stay in **`.env`** (gitignored).
- **Default config** (fps, viewport, …) → move to a committed **`recordable.config.json`**
  (retires the `DEFAULT_*` env prefix and `env.ts`'s string-coercion).
- **Variables** → a `variables` section of `recordable.config.json` (committed, non-secret)
  plus secret `VAR_*` in `.env`.

The one rule: **`.env` = secrets only; `recordable.config.json` = everything committable.**

## Files

**`recordable.config.json`** — committed; **flat**, identical in shape to Markdown
frontmatter and the constructor argument (config keys at the top level; `variables` and
`voiceover` are reserved sibling objects):

```jsonc
{
  "fps": 30,
  "viewport": { "width": 1920, "height": 1080 },
  "variables": { "siteUrl": "https://app.example.com", "userName": "Ada" },
  "voiceover": { "voiceId": "..." },
}
```

Values are **natively typed** and validated straight through `ConfigSchema` — no
`DEFAULT_` prefix, no string coercion. Variable values are **strings** (a non-string in
`variables` is a validation error).

**`.env`** — gitignored, secrets only:

```sh
ELEVENLABS_API_KEY=...
VAR_ADMIN_PASSWORD=...   # secret variables, VAR_ prefix
```

This subsumes the old `variables.json` concept (variables are now a section of the config
file — symmetric with `{ config, actions }` in a JSON script).

## Decisions

- **Reference syntax `{{ name }}`** — not `${}` (collides with JS template literals and
  shell expansion). Whitespace inside the braces is trimmed.
- **Case- and separator-insensitive names.** One normaliser (lowercase, strip `_`/`-`)
  applied to every source key (after stripping the `VAR_` prefix from env) and every
  token, so `VAR_EMAIL_ADDRESS` ≡ `emailAddress` ≡ `{{email_address}}` are one variable.
- **String-only, two surfaces.** Interpolation applies to **action string args** (incl.
  `visit` URLs) and **narration prose** — not config values. A token in a numeric slot
  (`wait("{{ms}}")`) fails validation naturally, so string-only needs no special casing.
- **Resolved by immediate substitution at enqueue time**, positional and chain-ordered: a
  mid-chain `.variable()` affects only later actions; a `.variable()` after `fromMarkdown`
  does not retroactively touch already-enqueued steps. `run()` carries no variable logic —
  tokens are already baked in.
- **Source-layered precedence, not last-write-wins.** Constructor variables are set before
  `fromMarkdown` in time but outrank frontmatter, so the map is one resolved view over
  layered sources; only the programmatic layer mutates as the chain advances.
- **Missing variable = hard error**, thrown eagerly at enqueue, naming the variable and the
  sources searched.
- **Non-name content stays literal.** `{{ some code }}` (not a valid name) is left
  verbatim, so technical narration won't trip the system. `\{{name}}` escapes a literal
  that _does_ look like a valid name. No other escape machinery.
- **No recursion** — a value is substituted once; `{{}}` inside a resolved value is not
  re-expanded (single pass, no cycle detection).

## Precedence

Both files are discovered by **walking up from the script's `baseDir` to `cwd` (the
ceiling)**, merging each `recordable.config.json` and each `.env` depth-first — **deeper
overrides shallower per key**. A startup source-log reports where each value resolved from.

Resolution order, lowest → highest:

- **Variables:** `.env` `VAR_*` + `process.env` `VAR_*` < `config.json` `variables`
  (depth-merged) < frontmatter / JSON `variables` < programmatic (constructor +
  `.variables()` / `.variable()` + CLI `--var`). **Type-major**: all variables files beat
  all env files; depth is the within-type tiebreak.
- **Config:** defaults < `config.json` config (depth-merged) < frontmatter / JSON config <
  constructor / CLI.

`process.env` `VAR_*` sits at the top of the env layer (real env beats a committed `.env`
file — standard dotenv semantics; the `VAR_` prefix is the allowlist, so CI can inject
secrets and `HOME`/`PATH` can never leak).

## API

Programmatic — variables provided three interchangeable ways, all feeding the top-priority
programmatic layer:

```ts
new Recordable({ viewport, variables: { siteUrl: "..." } }) // constructor sibling key
  .variables({ userName: "Ada" }) // merge a map
  .variable("plan", "pro") // set one
  .fromMarkdown("./demo.md")
  .run();
```

Authoring — one surface across formats:

```ts
click("{{submit_btn}}");
type("{{email_input}}", "{{email_address}}");
visit("{{siteUrl}}/dashboard");
```

```md
Welcome to {{productName}} — let's sign in.
```

CLI:

- `--var name=value` (repeatable; the programmatic layer's CLI equivalent, highest
  precedence)
- `--config <path>` / `--env-file <path>` — override auto-discovery
- `--base-dir <path>` — the scan ceiling

## What this deletes

- The `DEFAULT_*` env-variable prefix and the config-from-env path.
- `env.ts`'s string→type coercion (config.json is natively typed).
- The standalone `variables.json` concept (folded into `recordable.config.json`).

## Notes / non-goals (v1)

- No interpolation in config values (config resolves at config-time, before the chain can
  set programmatic variables — keeps the two resolution phases independent).
- No recursive/nested variable expansion.
- Two-endpoint vs full ancestor walk: the scan is the full bounded walk `baseDir → cwd`.
- Per-document overrides use frontmatter; there is no per-subdir `variables.json` (the
  config-file cascade already covers shared-vs-local).
