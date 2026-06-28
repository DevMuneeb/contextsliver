#!/usr/bin/env node
// Optional Claude Code PreToolUse hook.
//
// When enabled in Claude Code, this runs before each tool call. If the agent is about to use
// Read/Grep/Glob to explore code (instead of the cheaper cs_* MCP tools), it emits a gentle
// reminder on stderr. It never blocks — it's a nudge, consistent with the CLAUDE.md guidance.
//
// To enable (Claude Code): add to your settings.json hooks:
//   "PreToolUse": [{ "matcher": "Read|Grep|Glob", "hooks": [{ "type": "command",
//     "command": "node /path/to/hooks/pre-tool-use.js" }] }]
//
// Input (JSON on stdin): { "tool_name": "Read", "tool_input": { "file_path": "..." } }
// Exit code 0 = allow; anything on stderr is shown to the agent as feedback.
'use strict';

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Not a valid hook payload — pass through silently.
    process.exit(0);
  }

  const tool = payload?.tool_name;
  const toolsToNudge = new Set(['Read', 'Grep', 'Glob']);
  if (!toolsToNudge.has(tool)) {
    process.exit(0);
  }

  // Only nudge for code files; ignore docs/config reads.
  const target = payload?.tool_input?.file_path || payload?.tool_input?.pattern || '';
  const codeExt = /\.(ts|tsx|js|jsx|py|go|rs|java)$/i;
  if (target && !codeExt.test(target)) {
    process.exit(0);
  }

  process.stderr.write(
    '[contextsliver] Consider using cs_get_context / cs_blast_radius / cs_search_symbols ' +
      'before reading whole files — they return just the connected subgraph and cost far fewer ' +
      'tokens. Pass your session_id to skip already-sent context.\n',
  );
  process.exit(0);
});
