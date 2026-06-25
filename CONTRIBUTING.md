# Contributing

Thanks for your interest in improving `recordable`.

## Setup

Requires Node.js >= 18.

```bash
npm install
```

## Common tasks

```bash
npm run build        # compile src/ → dist/ (tsc)
npm run gen:schema   # regenerate recordable.schema.json from src/script.ts
npm run clean        # remove dist/
```

## Project layout

- `src/` — the package source; the only thing compiled to `dist/` and published.
- `demos/` — runnable examples; not part of the published package.
- `scripts/` — build tooling (e.g. schema generation); not published.
- `recordable.schema.json` — generated; do not edit by hand. Run `npm run gen:schema`.

The published tarball is restricted by the `files` field in `package.json`. If you
add a top-level file that should ship, add it there.

## Before opening a PR

- Run `npm run gen:schema` and commit the result if `src/script.ts` changed —
  CI fails if the committed schema is stale.
- Run `npm run build` to confirm the package compiles.
- Validate any new sample scripts with `node dist/cli.js <script>.json --check`.

## Releasing

`npm run prepublishOnly` runs `clean → gen:schema → build` automatically on
`npm publish`. Update `CHANGELOG.md` and bump the version (`npm version <patch|minor|major>`)
before publishing.
