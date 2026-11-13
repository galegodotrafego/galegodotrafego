import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../dist/tools/index.js';
for (const writes of [false, true]) {
  const server = new McpServer({ name: 'schema-smoke', version: '1.0.0' });
  // Any unexpected API access fails the test; no network client is created.
  const api = new Proxy({}, { get() { throw new Error('Unexpected API call'); } });
  registerTools(server, api, { enableWrites: writes, enableBroadcasts: writes });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 7);
  if (!writes) assert.ok(tools.every(t => t.annotations.readOnlyHint));
  else assert.ok(tools.some(t => !t.annotations.readOnlyHint));
  const result = await client.callTool({ name: 'list_conversations', arguments: { limit: 101 } });
  assert.equal(result.isError, true);
  assert.ok(JSON.stringify(result).includes('100'));
  await client.close(); await server.close();
}
console.log('MCP/Zod smoke passed: read-only and write schemas, invalid-input rejection, no external calls.');
