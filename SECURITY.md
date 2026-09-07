# Security Policy

## What this tool accesses

HP-AI-Usage runs entirely on your own machine. To read usage quotas it accesses:

- `~/.claude/.credentials.json`: the Claude Code session (OAuth access token)
- `~/.codex/auth.json`: the Codex CLI session (OAuth access token)
- The `--csrf_token` argument on the AntiGravity IDE language-server process command line

Access tokens are sent only to the matching provider's own servers:
`api.anthropic.com`, `chatgpt.com`, and the AntiGravity
language server on `127.0.0.1`. Nothing is sent to any third party, and the
built-in web server binds to `127.0.0.1` only.

## What it never does

- It does not transmit your credentials or keys anywhere except the provider APIs above.
- It does not write your tokens to disk. The on-disk cache (`.cache/`) stores only
  computed quota percentages and reset times, never tokens.
- It has no telemetry and no analytics.

## Undocumented endpoints

The Anthropic (`/api/oauth/usage`) and OpenAI (`/backend-api/wham/usage`)
endpoints are private and undocumented. They may change or stop working at any
time, and automated access may not be consistent with those providers' terms of
service. Use at your own risk.

## Reporting a vulnerability

Open a GitHub issue describing the problem. Do not include real tokens, API keys,
or the contents of your credential files in an issue. Redact them first.

## Before you contribute or share logs

Never commit your `.env`, `preferences.json`, `taskbar-pos.json`, `crash.log`, or
anything under `.cache/`. They are already listed in `.gitignore`. If you paste a
log for a bug report, remove any token or key it may contain.
