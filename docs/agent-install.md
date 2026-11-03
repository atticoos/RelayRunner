# Install RelayRunner with an agent

Use the user's current checkout unless they specify another path.

1. Check for Node.js 22+, npm, Git, GitHub CLI, curl, and tar. Runner setup
   supports macOS and Linux on x64 or ARM64 and requires the official GitHub
   runner's OS dependencies. Verify the existing GitHub session with
   `gh auth status --hostname github.com`.
2. Use the exact npm version the user requests. Otherwise, resolve the current
   stable version with `npm view relayrunner@latest version`. If no version is
   published, tell the user that the npm install is unavailable. Install the
   resolved version with `npm install --global relayrunner@<version>` and verify
   it with `relayrunner --help`.
3. For a local session, copy `$(npm root --global)/relayrunner/dist/SKILL.md`
   from the installed package to the personal skill directory for the agent
   the user is running:

   | Agent | Destination |
   | --- | --- |
   | Codex | `${CODEX_HOME:-$HOME/.codex}/skills/relayrunner/SKILL.md` |
   | Claude Code | `$HOME/.claude/skills/relayrunner/SKILL.md` |
   | Cursor | `$HOME/.cursor/skills/relayrunner/SKILL.md` |

   Create the destination directory if needed. If the destination file is
   identical, reuse it. If it differs, show the diff and ask before replacing
   it. The bundled skill describes the setup flow and can be read directly
   during this chat.

4. Run `relayrunner discover --cwd <checkout> --json` and ask the user which jobs
   to opt in. Check that the selected jobs can run on the user's machine.
5. Run `relayrunner preview --cwd <checkout> --job <id> --json`, repeating
   `--job` for each selected job. Show the patch, target branch, and hosted
   fallback. Stop for review before running setup, which registers and starts
   a runner under the user's local account.
