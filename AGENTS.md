# AGENTS.md

This repository holds Claude Code mods. A mod is a Claude Code plugin made of a hooks module (`on(event, matcher?, hook)` with `($, e, next)` hooks). The repository is also a plugin marketplace, so people install the mods from GitHub (`velazcod/claude-mods`).

## Layout

```
.claude-plugin/marketplace.json   The marketplace: one entry for each mod
mods/<name>/
  .claude-plugin/plugin.json      The mod's manifest
  hooks/hooks.json                Names the hooks module: { "modules": ["./register.js"] }
  hooks/register.js               The hooks module: export function register(on) { ... }
  hooks/format.js                 Pure logic with no `$` calls, so tests can import it
  types/index.d.ts                The $.state contract (only for a mod that uses $.state)
  tests/<name>.test.ts            Tests for `claude plugin test`
  tsconfig.json                   Extends ./.claude-plugin/types/tsconfig.json
```

Claude Code writes `mods/<name>/.claude-plugin/types/` when it loads a mod. Do not commit it; `.gitignore` excludes it.

## Rules for a mod

- The folder name, the `name` in `plugin.json`, and the `name` of its marketplace entry are the same.
- The marketplace entry's `source` is `./mods/<name>`, and its `description` is the same as the one in `plugin.json`.
- Do not set `version` in `plugin.json`. Without it, installs follow commits.
- Declare each `$.state` value in `types/index.d.ts`, under the mod's name in `interface PluginState`, and name the file in `plugin.json` as `"types": "./types/index.d.ts"`.
- Keep the mod's display and parsing logic in a file with no `$` calls, so tests can import it.
- Do not put keys, tokens, internal hostnames, or another person's data in a mod.

## Add a mod

1. Make `mods/<name>/` with the files in the layout.
2. Add an entry for it to `.claude-plugin/marketplace.json`.
3. Add a row and a short section for it to `README.md`.
4. Run the checks below.

## Checks

Run these after each change, from the repository root:

```bash
claude plugin validate .
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

To try a mod in a session: `claude --plugin-dir mods/<name>`. A session watches that folder and reloads the mod when a file changes.

## Writing style

Write documentation and comments in ASD-STE100 Simplified Technical English: short sentences, literal words, one instruction for each step.
