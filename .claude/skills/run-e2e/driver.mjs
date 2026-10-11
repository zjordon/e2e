#!/usr/bin/env node
/**
 * run-e2e driver: drive the e2e MCP server over stdio, no dependencies.
 *
 * Usage:  node driver.mjs [project-dir]          (default: <repo>/apps/testbed)
 *         then feed commands on stdin, one per line:
 *
 *   open [target]                 open_session (boots app + browser, observes)
 *   observe                       fresh semantic-tree observation (#id role "name")
 *   screenshot [file.png]         masked viewport -> file (default screenshot-<n>.png)
 *   locate {"role":"button","name":"Add"}
 *   tap {"id":"n12"}              any catalog tool: <name> {<json args>}
 *   type {"id":"n5","value":"hi"}
 *   navigate {"url":"/todos"}
 *   close                         close_session
 *   quit                          close stdin -> server exits 0 (EOF works too)
 *
 * Output: one result per line on stdout; images are written to the file and
 * named on stdout. Exit code 0 on clean quit, 1 on a driver error.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const projectDir = resolve(process.argv[2] ?? `${repoRoot}/apps/testbed`);
const cli = resolve(projectDir, 'node_modules/e2e/dist/cli/bin.js');

const server = spawn(process.execPath, [cli, 'mcp'], {
  cwd: projectDir,
  stdio: ['pipe', 'pipe', 'inherit'], // protocol on stdout, operator log on our stderr
});
server.on('exit', (code) => process.exit(code === 0 ? 0 : 1));

let nextId = 1;
const pending = new Map();
let buffer = '';

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line === '') continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve: ok } = pending.get(msg.id);
      pending.delete(msg.id);
      ok(msg);
    }
  }
});

function send(msg) {
  server.stdin.write(`${JSON.stringify(msg)}\n`);
}

function request(method, params) {
  const id = nextId++;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((res) => pending.set(id, { resolve: res }));
}

function callTool(name, args) {
  return request('tools/call', { name, arguments: args ?? {} });
}

function printResult(msg, label) {
  if (msg.error) {
    console.log(`! ${label}: ${msg.error.message}`);
    return;
  }
  let shot = 0;
  for (const part of msg.result?.content ?? []) {
    if (part.type === 'text') {
      console.log(part.text.replace(/\n$/, ''));
    } else if (part.type === 'image') {
      shot += 1;
      const file = resolve(`${label}-${shot}.png`);
      writeFileSync(file, Buffer.from(part.data, 'base64'));
      console.log(`[image -> ${file}]`);
    }
  }
  if (msg.result?.isError) console.log('(isError: true)');
}

async function main() {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'run-e2e-driver', version: '1.0.0' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  console.log(`# server: ${init.result.serverInfo.name} ${init.result.serverInfo.version} in ${projectDir}`);

  let session;
  let screenshotNo = 0;
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    if (text === 'quit') break;

    let [name, ...rest] = text.split(/\s+/, 2);
    const restStr = text.slice(name.length).trim();
    let args;
    if (restStr && restStr !== '') {
      try {
        args = JSON.parse(restStr);
      } catch {
        // free-form remainder is the value for tools that take one (screenshot file, open target)
        args = restStr;
      }
    }

    if (name === 'open') {
      const a = typeof args === 'string' ? { target: args } : {};
      const msg = await callTool('open_session', a);
      printResult(msg, 'open');
      const m = (msg.result?.content ?? []).find((p) => p.type === 'text')?.text ?? '';
      session = /session[^\n]*?([0-9a-f-]{8,})/i.exec(m)?.[1] ?? session;
      continue;
    }
    if (name === 'close') {
      const msg = await callTool('close_session', session ? { session } : {});
      printResult(msg, 'close');
      continue;
    }
    if (name === 'screenshot') {
      screenshotNo += 1;
      const msg = await callTool('call', {
        tool: 'screenshot',
        ...(session ? { session } : {}),
      });
      const file =
        typeof args === 'string'
          ? resolve(args)
          : resolve(`screenshot-${String(screenshotNo).padStart(2, '0')}.png`);
      const img = (msg.result?.content ?? []).find((p) => p.type === 'image');
      if (img) {
        writeFileSync(file, Buffer.from(img.data, 'base64'));
        console.log(`[screenshot -> ${file}]`);
      } else {
        printResult(msg, 'screenshot');
      }
      continue;
    }
    // generic catalog tool: observe, tap, type, press, select, navigate, locate, ...
    const callArgs = {
      tool: name,
      args: typeof args === 'object' && args !== null ? args : {},
    };
    if (session) callArgs.session = session;
    printResult(await callTool('call', callArgs), name);
  }
  server.stdin.end(); // disconnect -> sessions close, server exits 0
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
