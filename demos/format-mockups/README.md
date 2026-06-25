# Marker-syntax mockups

Same narration, same actions, five candidate inline-marker syntaxes. Open each
`.md`/`.mdx` in your editor to feel it as an author (and to see what syntax
highlighting, if any, you get for free).

The marker's **inline position in the prose is the timing signal** — it fires at
that word's spoken offset. So markers must sit mid-sentence; that's the constraint
behind all of this.

| File | Delimiter | Inner grammar | New dep? | Parse difficulty | Editor highlight |
|------|-----------|---------------|----------|------------------|------------------|
| `01-backtick-positional` | `` `…` `` | `action "pos" key=val` (manifest) | none | **loose** — split on spaces but respect quotes | monospace only |
| `02-backtick-json` | `` `…` `` | a JSON step object (== JSON layer) | none | **trivial** — `JSON.parse` | monospace only |
| `03-braces-keyed` | `{{…}}` | `action key=val` (Handlebars-ish) | none | medium — tokenise `key=val`, quotes | none |
| `04-directives` | `:name{…}` | action name in title + keyed attrs | remark/unified | parser does it | some (directive-aware) |
| `05-mdx` | `<Name … />` | JSX named attrs | mdx parser | parser does it | **yes** (JSX, needs ext) |
| `06-role-backtick` | `` {name}`…` `` | name in braces + args in backtick span | none | loose (same as `01`, inside the span) | **native blue** (inline-code) |
| `07-method-backtick` | `` `name(…)` `` | the fluent-API call: `name(pos, {opts})` | none¹ | structured (call syntax; JS-literal args) | **native blue** (inline-code) |

## The three things you flagged, per option

**1. Parse clarity.** `01` is the loosest: `type "#title" "My model" duration=800`
means hand-rolling a quote-aware splitter (where do args break?). `02` sidesteps it
entirely — the marker body *is* JSON, so `JSON.parse` validates it the same way
`fromJSON` already validates steps. `03` is in between. `04`/`05` hand parsing to a
real library (at the cost of the dep).

**2. Trailing config / options bag.** Look at `waitFor … state/timeout` and
`zoom … duration` in each file — that's the "extra config" case. In `02` it's just
more keys on the same object (no special case). In `01`/`03` the `key=val` tail *is*
the options bag, but you're now parsing a mini-language. In `05` it's `timeout={20000}`
(JS-expression braces). Your point stands: anything richer than a string eventually
needs real value parsing — `02` gets that for free from JSON.

**3. Strip step.** All five need the markers removed before TTS; none is hard. The
offset of each removed marker (into the stripped text) is recorded in the same pass.

## Quick read

- `02-backtick-json` is the **consistency play**: the markdown layer becomes "JSON
  steps, inlined into prose." Reuses the existing keyed format and validator verbatim;
  most verbose to author, but unambiguous and zero new dep.
- `01-backtick-positional` is the **terse play**: nicest to type, loosest to parse.
- `05-mdx` is the **tooling play**: best highlighting, heaviest dep + semantic stretch
  (render components repurposed as actions).
- `04-directives` is the **remark-plugin play**: `:action{…}` — action name in the
  directive title, everything keyed. **Not** native markdown — it's `remark-directive`
  (a CommonMark *proposal*), so it costs a dependency just like MDX; the only "native"
  trait is that unknown directives degrade to plain text in dumb renderers. No real
  VS Code highlighting exists (only a snippets extension).
- `06-role-backtick` is the **best-of-both play**: borrows MyST's `` {name}`args` ``
  role syntax. The `{name}` prefix structures the action; the args live in a backtick
  span so they get **native blue inline-code highlighting with no dependency** (we
  borrow the syntax, not the MyST parser). Args inside the span are still loose to
  parse (like `01`), but the visual cue is free and the action name is unambiguous.

- `07-method-backtick` is the **API-mirror play**: `` `zoom(1.5, "#rationale", {duration:800})` ``
  — the literal fluent-API call, in backticks. One mental model across the whole stack
  (chain → JSON → markdown), native blue highlighting, and the trailing options bag is a
  real object `{duration:800}` (no invented `key=val`). Args map positionally onto the
  `ACTIONS` manifest → a JSON step → the existing validator, so it's the original
  roadmap intent ("positional args in the marker, mapped via the manifest") with proper
  call punctuation instead of loose spaces.

  ¹ Parsing needs JS-literal args (numbers, strings, `{}` objects), not just
  `JSON.parse` — a small quote/bracket-aware scanner, or JSON5 to parse the arg list as
  `[ … ]`. More than `02`'s one-liner, but bounded and robust (handles commas/parens
  inside quoted selectors, unlike a naive `01` splitter).

## Prior art (researched)

Inline "command-in-prose" syntaxes that already exist elsewhere, and what we can learn:

- **MyST roles** (Jupyter Book / Sphinx) — `` {rolename}`content` ``, with optional
  attrs `` {role key="value"}`content` ``. Source of `06`. The one that gives free
  backtick highlighting + a named prefix.
- **Markdoc** (Stripe, runs their entire docs site) — tags `{% name attr=val %}` and
  *annotations* `{% attr=val %}` placed after a node. Battle-tested at huge scale, but
  `{% %}` gets no backtick highlighting — it's the same shape as `03`/`04`, just a
  different fence.
- **remark-directive** — implements the **unadopted** CommonMark generic-directives
  proposal (open since 2014). A dependency, not native, no real editor highlighting.
- **MDX** — best highlighting (with the MDX VS Code extension installed) but heaviest
  dep and repurposes render-components as actions.
