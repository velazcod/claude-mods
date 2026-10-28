# claude-mods

Mods for Claude Code. Each mod is a Claude Code plugin in `mods/<name>/`. The file `.claude-plugin/marketplace.json` makes this repository the `claude-mods` plugin marketplace.

## Mods

| Mod | What it does |
| --- | --- |
| [session-status](./mods/session-status) | Shows the prompt cache timer above the prompt in the Claude Desktop app, with a Keep warm button. |
| [handoff](./mods/handoff) | Writes a handoff prompt of the session and opens a new session with it. Proposes it when the context is large. |
| [session-pane](./mods/session-pane) | Shows a Session Pane beside the chat: the to-do list, the context window, and the connectors, skills, and files that the session used or made. |

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

### session-pane

- In the Desktop app, the mod opens a pane named **Session Pane** when the session starts. In the terminal, or to open it again, enter `/session-pane`.
- The pane has these sections, in this order:
  - **To-do**: the live task list, from the desktop app's task list, `TodoWrite`, or `TaskCreate` and `TaskUpdate`, with "2 of 6" done.
  - **Context**: the context window used, with a bar and one row for each category, in the same order and colors as the session pane of the Desktop app. The mod estimates the categories locally, so the numbers can differ a little from `/context`.
  - **Connectors**: each MCP server that the session called, with a logo, the tools it called, and the number of calls. The logo is a colored letter, not the service's own logo.
  - **Skills**: each skill that ran, typed as `/name` or run by the `Skill` tool, with the number of uses.
  - **Context files**: the instruction files (`CLAUDE.md`) that loaded, marked `auto`, and each file that the `Read` tool read.
  - **Files created/edited**: each file that `Write`, `Edit`, or `NotebookEdit` created or changed, marked new or edited.
- Click a section title to collapse the section to its title and count. The Context section keeps its bar when it is collapsed. The mod keeps this choice for the session.
- Click a file name to open it. In the Desktop app, the file opens in the Files pane. A file outside the session's folders, or a click in the terminal, opens the file in its default app.
- When the mod loads in a session that already has a transcript, it reads the tool calls from the transcript. It cannot read instruction files that loaded before the mod, or skills that the person typed as `/name` before the mod.
- The Desktop app names some connectors with an ID. The mod identifies Google Calendar, Gmail, and Google Drive from their tool names. It shows other such connectors as "Connector" and the first 8 characters of the ID.
- The mod does not count files that `Bash` commands read or write.

## Install

Install each mod that you want. The mods are `session-status`, `handoff`, and `session-pane`.

At the prompt of a Claude Code terminal session, enter one command for each mod:

```
/plugin install session-status --marketplace velazcod/claude-mods
```

```
/plugin install handoff --marketplace velazcod/claude-mods
```

```
/plugin install session-pane --marketplace velazcod/claude-mods
```

Answer `y` to add the marketplace, then select a scope.

From a shell:

```bash
claude plugin install session-status --marketplace velazcod/claude-mods
```

```bash
claude plugin install handoff --marketplace velazcod/claude-mods
```

```bash
claude plugin install session-pane --marketplace velazcod/claude-mods
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

```bash
claude plugin update session-pane@claude-mods
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
