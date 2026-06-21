#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { JTraderClient } from './jtraderClient.js';

// Load configuration from environment variables
const API_KEY = process.env.JTRADER_API_KEY;
let WALLET_PRIVATE_KEY = process.env.JTRADER_WALLET_PRIVATE_KEY?.trim() as `0x${string}` | undefined;
if (WALLET_PRIVATE_KEY && !WALLET_PRIVATE_KEY.startsWith('0x')) {
  WALLET_PRIVATE_KEY = `0x${WALLET_PRIVATE_KEY}` as `0x${string}`;
}
const BINDING_TOKEN = process.env.JTRADER_BINDING_TOKEN;
const REQUIRE_APPROVAL = process.env.JTRADER_REQUIRE_APPROVAL !== 'false';
const MAX_SPEND_LIMIT = parseFloat(process.env.JTRADER_MAX_SPEND_LIMIT || '5.0');
const MAX_SESSION_SPEND = parseFloat(process.env.JTRADER_MAX_SESSION_SPEND || '20.0');
const BASE_URL = 'https://api.jtrader.ai/api';
const NETWORK = 'base';

const client = new JTraderClient({
  apiKey: API_KEY,
  walletPrivateKey: WALLET_PRIVATE_KEY,
  bindingToken: BINDING_TOKEN,
  requireApproval: REQUIRE_APPROVAL,
  maxSpendLimit: MAX_SPEND_LIMIT,
  maxSessionSpend: MAX_SESSION_SPEND,
  baseUrl: BASE_URL,
  network: NETWORK,
});

const server = new Server(
  {
    name: 'jtrader-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_reports',
        description: 'Retrieve a list of research reports currently accessible to the agent. Some reports may be locked until purchased. You can optionally filter to only see reports you own, and limit the number of reports returned. Reports you own will include a purchased_at timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Optional maximum number of reports to return. Defaults to all reports.',
            },
            owned_only: {
              type: 'boolean',
              description: 'Optional flag to return ONLY reports that you have already purchased/own.',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_report_metadata',
        description: 'Fetch ONLY the metadata for a specific research report by ID without triggering a payment. Useful for inspecting a reports discovery_objective and catalysts before deciding to purchase it.',
        inputSchema: {
          type: 'object',
          properties: {
            report_id: {
              type: 'string',
              description: 'The unique ID of the report to inspect.',
            },
          },
          required: ['report_id'],
        },
      },

      {
        name: 'get_report',
        description: 'Fetch the full contents of a specific research report by ID. If the report requires payment and you have a configured wallet, this tool will automatically execute an x402 USDC micropayment to purchase it.',
        inputSchema: {
          type: 'object',
          properties: {
            report_id: {
              type: 'string',
              description: 'The unique ID of the report to fetch or purchase.',
            },
            confirm_purchase: {
              type: 'boolean',
              description: 'Set this to true ONLY if you have explicitly asked the user for permission to spend USDC and they have approved it.',
            },
          },
          required: ['report_id'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case 'list_reports': {
        const { limit, owned_only } = (request.params.arguments || {}) as { limit?: number; owned_only?: boolean };
        const reports = await client.listReports(limit, owned_only);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(reports, null, 2),
            },
          ],
        };
      }

      case 'get_report_metadata': {
        const { report_id } = request.params.arguments as { report_id: string };
        if (!report_id) {
          throw new Error('report_id is required');
        }
        const metadata = await client.getReportMetadata(report_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(metadata, null, 2),
            },
          ],
        };
      }


      case 'get_report': {
        const { report_id, confirm_purchase } = request.params.arguments as { report_id: string; confirm_purchase?: boolean };
        if (!report_id) {
          throw new Error('report_id is required');
        }
        const report = await client.getReport(report_id, confirm_purchase);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    let errorMessage = error.message || error.toString();
    
    // Extract detailed error message from axios response if available
    if (error.response?.data) {
      const data = error.response.data;
      if (typeof data === 'string') {
        errorMessage += `\nResponse: ${data}`;
      } else if (typeof data === 'object') {
        if (data.message) {
           errorMessage += `\nDetails: ${data.message}`;
        } else if (data.error) {
           errorMessage += `\nDetails: ${data.error}`;
        } else {
           errorMessage += `\nResponse: ${JSON.stringify(data)}`;
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  try {
    // Initialize the JTrader client (handles SIWE auth if needed)
    await client.initialize();

    // Start the stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    // We cannot console.log here because it would break JSON-RPC over stdout.
    // Use console.error for logging if needed.
    console.error('JTrader MCP Server running on stdio');
  } catch (error) {
    console.error('Failed to start JTrader MCP Server:', error);
    process.exit(1);
  }
}

main();
