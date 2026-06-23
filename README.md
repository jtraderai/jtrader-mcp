# jtrader-mcp

The jtrader [Model Context Protocol](https://modelcontextprotocol.com/) server allows AI agents to interact with [jtrader.ai](https://jtrader.ai). This protocol supports various tools to fetch research reports and autonomously execute x402 USDC micropayments to purchase market reports.

## Features

- **List Reports**: Retrieve a list of all available research reports, optionally sorted and limited to easily find the latest.
- **Report Metadata**: Inspect a report's `discovery_objective`, `sectors_covered`, and `catalysts` before committing to a purchase.
- **Autonomous Purchasing**: Execute an x402 compliant USDC payment using the agent's configured wallet to unlock full institutional-grade research.

## Prerequisites

- Node.js (v22 or newer)
- A Base Mainnet wallet with USDC.
- An API Key from jtrader.ai OR an Agent Wallet Private Key for SIWX login.

## Local

To run the jtrader MCP server locally using `npx`, use the following command:

```bash
# Basic usage
npx -y @jtrader.ai/mcp
```

This server requires environment variables to function correctly. You can configure these in your MCP client's configuration file or pass them directly in your environment.

### Environment Variables Explained

Depending on your goals, you can provide different combinations of the following keys:

- `JTRADER_WALLET_PRIVATE_KEY`: The 32-byte private key of an Ethereum wallet. **This is required if you want your agent to make purchases.** The wallet must be funded with USDC on the Base network to authorize x402 micropayments.
  > **⚠️ CRITICAL SECURITY WARNING:** jtrader.ai will **NEVER** ask for, process, transmit, or store your private key. The key never leaves your local machine. It is used exclusively by the MCP server running on your computer to cryptographically sign x402 payment payloads. **Never share your private key.**
- `JTRADER_API_KEY`: Your persistent API key generated from the jtrader.ai dashboard. This allows the agent to act on behalf of your human account to view reports you have already purchased.
- `JTRADER_REQUIRE_APPROVAL`: Set to `false` to disable the manual purchase confirmation loop. (Defaults to `true` for safety).
- `JTRADER_MAX_SPEND_LIMIT`: The maximum amount of USDC the agent is allowed to spend on a single report purchase. Set to `-1` or `0` to disable. (Defaults to `5.0`).
- `JTRADER_MAX_SESSION_SPEND`: The maximum cumulative amount of USDC the agent is allowed to spend during its entire session lifetime. (Defaults to `20.0`).

## Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`. See [here](https://modelcontextprotocol.io/quickstart/user) for more details.

```json
{
  "mcpServers": {
    "jtrader": {
      "command": "npx",
      "args": [
        "-y",
        "@jtrader.ai/mcp"
      ],
      "env": {
        "JTRADER_API_KEY": "jtr_live_...",
        "JTRADER_WALLET_PRIVATE_KEY": "0xYourAgentPrivateKeyHere"
      }
    }
  }
}
```

## Usage with Cursor

Cursor supports standard MCP configuration. You can configure it directly through the UI. For the most up-to-date instructions, please see the [Cursor MCP Documentation](https://cursor.com/docs/mcp#installing-mcp-servers).

1. Open **Cursor Settings**
2. Navigate to **Features** > **MCP**
3. Click **+ Add New MCP Server**
4. Set the Name to `jtrader`
5. Set the Type to `command`
6. Set the Command to `npx -y @jtrader.ai/mcp`

*Note: Environment variables for Cursor MCP servers are inherited from the environment Cursor was launched in. You can also specify them in a `.env` file depending on your setup.*

## Usage with Antigravity CLI

To use this server with Google Antigravity, add the configuration to your global `mcp_config.json` (typically located in `~/.gemini/config/mcp_config.json` on Windows/Linux or `~/.config/gemini/mcp_config.json` on Mac). For the most up-to-date instructions, please see the [Antigravity MCP Documentation](https://antigravity.google/docs/mcp):

```json
{
  "mcpServers": {
    "jtrader": {
      "command": "npx",
      "args": [
        "-y",
        "@jtrader.ai/mcp"
      ],
      "env": {
        "JTRADER_API_KEY": "jtr_live_...",
        "JTRADER_WALLET_PRIVATE_KEY": "0xYourAgentPrivateKeyHere"
      }
    }
  }
}
```

## Available Tools

- `list_reports(limit?: number)`: Retrieve a list of reports. Use `limit: 1` to quickly get the latest report's metadata.
- `get_report_metadata(report_id: string)`: Inspect a locked report's metadata (including its objective and catalysts) without paying.
- `get_report(report_id: string)`: Purchase and fetch the full contents of a specific report. If the report requires payment, the server will automatically authorize the x402 payment using the agent's wallet.
- `bind_account(binding_token: string)`: Bind the autonomous agent's wallet to a human user account using a one-time binding token.

## Debugging the Server

To debug your server, you can use the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector).

First, build the server:

```bash
npm run build
```

Then run the following command in your terminal:

```bash
# Start MCP Inspector and server
npx @modelcontextprotocol/inspector node dist/index.js
```

### Instructions

1. Run the command to start the MCP Inspector.
2. Open the MCP Inspector UI in your browser and click Connect to start the MCP server.
3. You can see the list of tools and test each tool individually.
