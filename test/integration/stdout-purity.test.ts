// CRITICAL integration test: stdout purity.
//
// stdout is the MCP JSON-RPC protocol channel. ANY non-JSON-RPC byte on stdout corrupts the
// stream and silently disconnects the client (the agent stops working, with NO error). This is
// the single most common failure mode for MCP servers, so we guard it explicitly.
//
// Strategy: spawn the built server as a child process, capture stdout for a few seconds of
// startup + a tool call, and assert every stdout line is valid JSON-RPC. We also send a real
// initialize + tools/list to exercise the path, not just idle startup.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli.js');

// Skip if the project isn't built (dist/ missing) — CI runs `npm run build` first.
const hasBuild = existsSync(CLI);

describe.skipIf(!hasBuild)('MCP stdout purity', () => {
  it('produces ONLY valid JSON-RPC on stdout during startup + tool calls', async () => {
    const stdout = await runServerAndCollectStdout({
      method: 'tools/list',
      params: {},
      id: 2,
    });

    const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0); // we expect at least the responses

    for (const line of lines) {
      // Every line must be a valid JSON-RPC message object.
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // This is the failure that would silently break the client.
        throw new Error(
          `stdout contains non-JSON-RPC output (would corrupt MCP stream):\n${line}`,
        );
      }
      expect(parsed).toHaveProperty('jsonrpc', '2.0');
    }
  }, 15000);

  it('stdout contains NO console.log output (no [contextsliver:INFO] markers leak)', async () => {
    const stdout = await runServerAndCollectStdout({
      method: 'tools/list',
      params: {},
      id: 2,
    });
    // Our log() helper writes to stderr with these prefixes. They must NEVER appear on stdout.
    expect(stdout).not.toContain('[contextsliver:');
    expect(stdout).not.toContain('INFO');
    expect(stdout).not.toContain('File watcher started');
  }, 15000);
});

/** Spawn the server, send initialize + a follow-up method, resolve with the captured stdout. */
function runServerAndCollectStdout(followUp: {
  method: string;
  params: unknown;
  id: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [CLI, 'start', '--root', process.cwd(), '--no-watch'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SLIVER_DEBUG: '0' },
    });

    let stdout = '';
    let settled = false;
    server.stdout.on('data', (c) => (stdout += c.toString()));
    // Drain stderr so it doesn't block; we don't assert on it here.
    server.stderr.on('data', () => {});

    const finish = () => {
      if (!settled) {
        settled = true;
        server.kill();
        resolve(stdout);
      }
    };

    server.on('error', (err) => {
      if (!settled) reject(err);
    });

    const send = (obj: unknown) => server.stdin?.write(JSON.stringify(obj) + '\n');

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stdout-purity-test', version: '1.0.0' },
      },
    });

    setTimeout(() => {
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      send({ jsonrpc: '2.0', id: followUp.id, method: followUp.method, params: followUp.params });
    }, 400);

    // Give the server time to respond, then collect.
    setTimeout(finish, 2500);
  });
}

beforeAll(() => {
  if (!hasBuild) {
    // eslint-disable-next-line no-console
    console.warn('[stdout-purity test] dist/cli.js not found — run `npm run build` first.');
  }
});
