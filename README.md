# claude-mods

Mods for Claude Code. Each mod is a Claude Code plugin in `mods/<name>/`. The file `.claude-plugin/marketplace.json` makes this repository the `claude-mods` plugin marketplace.

## Mods

| Mod | What it does |
| --- | --- |
| [session-status](./mods/session-status) | Shows the prompt cache timer above the prompt in the Claude Desktop app, with a Keep warm button. |
| [handoff](./mods/handoff) | Writes a handoff prompt of the session and opens a new session with it. Proposes it when the context is large. |

### session-status

- Shows "Cache warm" with the time left, or "Cache cold", and a bar for the part of the TTL that is left. The color changes when a quarter and a sixth of the TTL are left.
- Reads the cache TTL (5 minutes or 1 hour) of each session from its transcript. Until it reads the TTL (in a new session, until the first response ends), it shows "Cache warm" with no time and no bar, and Keep warm sends no pings.
- **Keep warm** (button, or `/keep-warm [on|off]`): when one minute is left and the session is idle, the mod sends a short ping that refreshes the cache. It sends at most 5 pings after each request. Each ping uses model tokens.
- In the terminal, the mod does not draw the band. It writes `/tmp/.claude_cache_ts.<session id>` and `/tmp/.claude_keep_warm.<session id>` for a shell status line script to read. This repository does not include that script.

### handoff

- When the context reaches 400k tokens, or 80% of the context window if that is lower, a band above the prompt shows "Context at 412k" with **Handoff** and **Hide**. After Hide or Close, the band shows again when the context grows by 50k tokens. To change the token value, set the `thresholdTokens` option.
- **Handoff**, `/handoff`, or the model's `handoff` tool writes the handoff. A card above the prompt shows each step:
  1. Reading the conversation.
  2. Finding the files you used (from Read, Edit, and Write calls).
  3. Listing skills, tools, and links.
  4. Writing the handoff: a forked model call reads the whole conversation and writes the goal, current state, decisions, next steps, open questions, and key files.
  5. Saving and checking: the mod saves `~/.claude/handoffs/YYYY-MM-DD-HHMM-<title>.md` and reads it back.
- When the handoff is ready, the card has these buttons:
  - **Copy handoff prompt**: copies the file's text.
  - **Start new chat with it**: opens a new session in the same folder with the handoff as its prompt. The current session does not change. In the Desktop app, it opens a new Code session (a `claude://code/new` link). In the terminal on macOS, it opens a Terminal window that runs `claude`.
  - **Open file**: opens the file in its default app.
  - **Close**: removes the card.
- To hand off at the end of autonomous work, say so in the prompt, for example: "Do XYZ, work autonomously, and when done, call handoff." The model calls the tool, and the handoff starts when its turn ends. The mod does not start a new session by itself.
- The forked call uses model tokens. It reads the conversation from the prompt cache when the cache is warm.

## Install

Install each mod that you want. The mods are `session-status` and `handoff`.

At the prompt of a Claude Code terminal session, enter one command for each mod:

```
/plugin install session-status --marketplace velazcod/claude-mods
```

```
/plugin install handoff --marketplace velazcod/claude-mods
```

Answer `y` to add the marketplace, then select a scope.

From a shell:

```bash
claude plugin install session-status --marketplace velazcod/claude-mods
```

```bash
claude plugin install handoff --marketplace velazcod/claude-mods
```

In the Claude Desktop app, where `/plugin` does not run:

1. Click **+** next to the prompt box.
2. Click **Plugins**, then **Add marketplace**, and enter `velazcod/claude-mods`.
3. Click **Add plugin**, then select the mod. Do this step again for each mod.

Each mod has a `version`. To get a new version of a mod, run `claude plugin update <name>@claude-mods`, for example:

```bash
claude plugin update session-status@claude-mods
```

```bash
claude plugin update handoff@claude-mods
```

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
