#!/usr/bin/env node
// MCP adapter: the six facade tools, no logic. A thin client of the daemon (or of an in-process engine when no daemon
// runs). There is deliberately no approval tool here: approving a staging write is a human, CLI/dashboard-only step.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { facadeTools } from '../contracts/index.js';
import { loadConfig } from '../modules/config/index.js';
import { makeGateway } from '../service/gateway.js';
import { version } from '../service/paths.js';

const gateway = makeGateway(loadConfig());
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const server = new McpServer({ name: 'reddog-toolkit', version: version() });

const [describeTool, ...dispatchTools] = facadeTools;

server.registerTool(describeTool.name, {
    description: describeTool.description,
    inputSchema: { operation: z.string().optional() },
}, async ({ operation }) => {
    try { return text(await gateway.describe(operation)); }
    catch (error) { return { isError: true, ...text(String((error as Error).message)) }; }
});

for (const tool of dispatchTools) {
    server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: { request: z.record(z.string(), z.unknown()) },
    }, async ({ request }) => text(await gateway.call(request)));
}

await server.connect(new StdioServerTransport());
