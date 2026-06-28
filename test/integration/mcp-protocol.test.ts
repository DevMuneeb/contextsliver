// MCP protocol integration test: verify the server's wire behavior against a real client
// session over stdio. Exercises initialize → tools/list → tools/call round trips and checks
// the content of the responses (tool names, symbol detection, session_id issuance).
import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const hasBuild = existsSync(CLI);

describe.skipIf(!hasBuild)('MCP protocol round trips', () => {
  let projectDir: string;

  beforeAll(() => {
    // Build a tiny project to query against.
    projectDir = mkdtempSync(join(tmpdir(), 'sliver-proto-'));
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(
      join(projectDir, 'src', 'Auth.ts'),
      `export class Auth { login(u: string): string { return 't'; } }\n`,
    );
    writeFileSync(
      join(projectDir, 'src', 'Middleware.ts'),
      `import { Auth } from './Auth';\nexport class Middleware { constructor(private a: Auth) {} }\n`,
    );
  });

  it('initialize returns server info + protocol version', async () => {
    const resp = await runSession(projectDir, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 't', version: '1' } } },
    ]);
    expect(resp[1].result.serverInfo.name).toBe('contextsliver');
    expect(resp[1].result.protocolVersion).toBeDefined();
  }, 15000);

  it('tools/list returns all five tools', async () => {
    const resp = await runSession(projectDir, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const names = resp[2].result.tools.map((t: { name: string }) => t.name);
    expect(names.sort()).toEqual(
      ['cs_blast_radius', 'cs_get_context', 'cs_index_repo', 'cs_index_status', 'cs_search_symbols'].sort(),
    );
  }, 15000);

  it('tools/call cs_get_context returns the symbol + callers', async () => {
    const resp = await runSession(projectDir, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'cs_get_context', arguments: { symbol_name: 'Auth' } } },
    ]);
    const text = resp[2].result.content[0].text;
    const parsed = JSON.parse(text.split('\n\n//')[0]); // strip token annotation
    expect(parsed.symbol).toBe('Auth');
    expect(parsed.file).toBe('src/Auth.ts');
    expect(parsed.callers.map((c: { name: string }) => c.name)).toContain('Middleware');
    expect(parsed.session_id).toMatch(/^[0-9a-f-]{36}$/);
  }, 15000);

  it('tools/call returns isError for an unknown symbol', async () => {
    const resp = await runSession(projectDir, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'cs_get_context', arguments: { symbol_name: 'DoesNotExist' } } },
    ]);
    const text = resp[2].result.content[0].text;
    expect(text).toContain('not found');
  }, 15000);
});

/** Run one MCP session: spawn server, send messages in sequence, resolve with responses by id. */
function runSession(
  projectRoot: string,
  messages: Array<Record<string, unknown>>,
  // Responses are dynamic JSON-RPC payloads; we access known fields per-test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [CLI, 'start', '--root', projectRoot, '--no-watch'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = new Map<number, unknown>();
    let buf = '';
    let settled = false;

    server.stdout.on('data', (c) => {
      buf += c.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) responses.set(msg.id, msg);
        } catch {
          /* ignore */
        }
      }
    });
    server.stderr.on('data', () => {}); // drain
    server.on('error', (err) => {
      if (!settled) reject(err);
    });

    const send = (obj: Record<string, unknown>) => server.stdin?.write(JSON.stringify(obj) + '\n');

    // Send messages with small delays so the order is deterministic.
    messages.forEach((m, i) => setTimeout(() => send(m), 200 * (i + 1)));

    setTimeout(() => {
      settled = true;
      server.kill();
      resolve(Object.fromEntries(responses) as never);
    }, 200 * (messages.length + 1) + 800);
  });
}
