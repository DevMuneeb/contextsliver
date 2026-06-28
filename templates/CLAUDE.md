# ContextSliver — Code Navigation Rules

## How to navigate this codebase (IMPORTANT — read before touching any file)

This project has ContextSliver installed. Before reading any file with Read or
running grep/find to explore code, use the MCP tools below. They cost ~300–800
tokens. Reading a whole file costs 2,000–8,000 tokens and fills your context
window unnecessarily.

### Rule 1: Finding what connects to a symbol
Use `cs_blast_radius` instead of grep.

Example — before editing AuthService:
```
cs_blast_radius({ symbol_name: "AuthService", session_id: "YOUR_SESSION_ID" })
```

This returns who calls AuthService and what AuthService depends on.
Only then read the specific files you actually need.

### Rule 2: Getting a single symbol + its immediate neighbors
Use `cs_get_context` to start a session and get a symbol's definition + 1-hop neighbors:
```
cs_get_context({ symbol_name: "AuthService" })
```
This returns a `session_id` — save it and pass it to every subsequent cs_* call.

### Rule 3: Searching for a symbol you don't know the exact location of
Use `cs_search_symbols` instead of find or grep:
```
cs_search_symbols({ query: "token validation", limit: 10 })
```

### Rule 4: Understanding the current index state
```
cs_index_status()
```

### Rule 5: After making changes
Run the project's test command. Do not assume changes are correct without
running tests.

## Session ID
Get a session ID from the first `cs_get_context` call and pass it to every
subsequent tool call this session. This prevents re-sending context you already
have and saves tokens. Already-sent symbols are listed in `already_in_context`.

<!-- Keep this file under 200 lines.
     These are nudges, not hard rules. Hard enforcement is via the PreToolUse
     hook in /hooks/pre-tool-use.js — enable it for stricter control. -->
