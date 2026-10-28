# claude-mods

Mods for Claude Code. Each mod is a Claude Code plugin in `mods/<name>/`. The file `.claude-plugin/marketplace.json` makes this repository the `claude-mods` plugin marketplace.

## Mods

| Mod | What it does |
| --- | --- |
| [session-status](./mods/session-status) | Shows the prompt cache timer above the prompt in the Claude Desktop app, with a Keep warm button. |

### session-status

- Shows "Cache warm" with the time left, or "Cache cold", and a bar for the part of the TTL that is left. The color changes when a quarter and a sixth of the TTL are left.
- Reads the cache TTL (5 minutes or 1 hour) of each session from its transcript.
- **Keep warm** (button, or `/keep-warm [on|off]`): when one minute is left and the session is idle, the mod sends a short ping that refreshes the cache. It sends at most 5 pings after each request. Each ping uses model tokens.
- In the terminal, the mod does not draw the band. It writes `/tmp/.claude_cache_ts.<session id>` and `/tmp/.claude_keep_warm.<session id>` for a shell status line script to read. This repository does not include that script.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install session-status --marketplace velazcod/claude-mods
```

Answer `y` to add the marketplace, then select a scope.

From a shell:

```bash
claude plugin install session-status --marketplace velazcod/claude-mods
```

In the Claude Desktop app, where `/plugin` does not run:

1. Click **+** next to the prompt box.
2. Click **Plugins**, then **Add marketplace**, and enter `velazcod/claude-mods`.
3. Click **Add plugin**.

Each mod has a `version`. To get a new version, run `claude plugin update session-status@claude-mods`.

## Develop

Run a mod from its folder, for one session:

```bash
claude --plugin-dir mods/session-status
```

Check the marketplace and a mod:

```bash
claude plugin validate .
```

```bash
claude plugin validate mods/session-status
```

Run the tests of a mod:

```bash
claude plugin test mods/session-status
```

See [AGENTS.md](./AGENTS.md) for how to add a mod.
