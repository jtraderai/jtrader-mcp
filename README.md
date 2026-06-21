# jtrader-mcp

An MCP (Model Context Protocol) server for interacting with [jtrader.ai](https://jtrader.ai), providing AI agents with the ability to fetch research reports and autonomously execute x402 USDC micropayments to purchase premium insights.

## Features

- **List Reports**: Retrieve a list of all available research reports, optionally sorted and limited to easily find the latest.
- **Report Metadata**: Inspect a report's `discovery_objective`, `sectors_covered`, and `catalysts` before committing to a purchase.
- **Autonomous Purchasing**: Execute an x402 compliant USDC payment using the agent's configured wallet to unlock full institutional-grade research.

## Prerequisites

- Node.js (v18 or newer)
- A Base Mainnet wallet with USDC.
- An API Key from jtrader.ai OR an Agent Wallet Private Key for SIWX login.

## Installation

```bash
npm install
npm run build
```

## Configuration

This MCP server requires environment variables to function correctly. You can configure these in your MCP client's configuration file.

### Environment Variables Explained

Depending on your goals, you can provide different combinations of the following keys:

- `JTRADER_WALLET_PRIVATE_KEY`: The 32-byte private key of an Ethereum wallet (can be provided with or without a `0x` prefix). **This is required if you want your agent to make purchases.** The wallet must be funded with USDC on the Base network to authorize x402 micropayments.
  > **⚠️ CRITICAL SECURITY WARNING:** jtrader.ai will **NEVER** ask for, process, transmit, or store your private key. The key never leaves your local machine. It is used exclusively by the MCP server running on your computer to cryptographically sign x402 payment payloads. **Never share your private key.**
- `JTRADER_API_KEY`: Your persistent API key generated from the jtrader.ai dashboard. This allows the agent to act on behalf of your human account to view reports you have already purchased.
- `JTRADER_BINDING_TOKEN`: A single-use token to permanently link an autonomous agent's wallet to your human account.
- `JTRADER_REQUIRE_APPROVAL`: Set to `false` to disable the manual purchase confirmation loop and allow the agent to blindly spend USDC. (Defaults to `true` for safety).
  > **⚠️ CAUTION:** Disabling approval (`false`) while also disabling the spend limits below gives the AI agent unrestricted access to spend your wallet's USDC balance on reports at its own discretion without human interaction.
- `JTRADER_MAX_SPEND_LIMIT`: The maximum amount of USDC the agent is allowed to spend on a single report purchase. Set to `-1` or `0` to disable. (Defaults to `5.0`).
- `JTRADER_MAX_SESSION_SPEND`: The maximum cumulative amount of USDC the agent is allowed to spend during its entire session lifetime. Set to `-1` or `0` to disable for persistent autonomous agents. (Defaults to `20.0`).

### Common Configurations

**1. Full Access (Recommended)**
Provide **both** `JTRADER_API_KEY` and `JTRADER_WALLET_PRIVATE_KEY`. 
The agent will read reports on behalf of your human account (via the API key), and it will automatically execute x402 purchases using the wallet. Any purchases the agent makes will be permanently tied to your human account. *(A binding token is not needed in this configuration).*

**2. Autonomous Agent (No API Key)**
Provide **only** `JTRADER_WALLET_PRIVATE_KEY`. 
The agent will log in via SIWX (Sign-In with X) and act as a completely independent entity. [SIWX](https://docs.x402.org/extensions/sign-in-with-x) is a decentralized authentication standard that allows the agent to securely prove ownership of its wallet address to jtrader.ai without passwords. It will buy and read reports using its own wallet. If you want its purchases to show up in your human dashboard, you can optionally provide a `JTRADER_BINDING_TOKEN` during its first run.

**3. Read-Only (No Wallet)**
Provide **only** `JTRADER_API_KEY`. 
The agent can read reports you have already bought, but it **cannot** purchase new reports (since it lacks a wallet to sign the payment transaction).

## Usage with MCP Clients

To install this server, add the following to your MCP client's configuration file:

```json
{
  "mcpServers": {
    "jtrader": {
      "command": "node",
      "args": [
        "/absolute/path/to/jtrader-mcp/dist/index.js"
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

## Development

```bash
# Run tests
npm run test

# Watch for changes and build
npm run build -- --watch
```
