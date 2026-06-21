import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import axios, { AxiosInstance } from 'axios';

import { wrapAxiosWithPayment, x402Client } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm/exact/client';

export interface JTraderClientConfig {
  baseUrl?: string;
  apiKey?: string;
  walletPrivateKey?: `0x${string}`;
  bindingToken?: string;
  requireApproval?: boolean;
  maxSpendLimit?: number;
  maxSessionSpend?: number;
  network?: string;
}

export class JTraderClient {
  private baseAxios: AxiosInstance;
  private paymentAxios?: AxiosInstance;
  private jwtToken?: string;
  private sessionSpend: bigint = 0n;

  constructor(private config: JTraderClientConfig) {
    this.baseAxios = axios.create({
      baseURL: config.baseUrl || 'http://localhost:5106/api',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (config.walletPrivateKey) {
      const account = privateKeyToAccount(config.walletPrivateKey);
      
      const paymentClient = new x402Client();
      paymentClient.register('eip155:*', new ExactEvmScheme(account));

      const expectedNetwork = config.network === 'base-sepolia' ? 'eip155:84532' : 'eip155:8453';
      const maxSpendLimitBigInt = config.maxSpendLimit && config.maxSpendLimit > 0 
        ? BigInt(Math.floor(config.maxSpendLimit * 1_000_000)) 
        : -1n;
      const maxSessionSpendBigInt = config.maxSessionSpend && config.maxSessionSpend > 0 
        ? BigInt(Math.floor(config.maxSessionSpend * 1_000_000)) 
        : -1n;

      paymentClient.registerPolicy((version, reqs) => {
        return reqs.filter(req => {
          if (req.network !== expectedNetwork) return false;

          const amount = BigInt(req.amount);
          
          if (maxSpendLimitBigInt !== -1n && amount > maxSpendLimitBigInt) {
            console.error(`[x402] Rejected: Amount ${amount} exceeds max spend limit ${maxSpendLimitBigInt}`);
            return false;
          }

          if (maxSessionSpendBigInt !== -1n && (this.sessionSpend + amount) > maxSessionSpendBigInt) {
            console.error(`[x402] Rejected: Amount ${amount} would exceed max session spend ${maxSessionSpendBigInt}`);
            return false;
          }

          return true;
        });
      });

      paymentClient.onAfterPaymentCreation(async (ctx) => {
        this.sessionSpend += BigInt(ctx.selectedRequirements.amount);
      });
      paymentClient.onPaymentResponse(async (ctx) => {
        if (ctx.error) {
          throw ctx.error;
        }
        if (ctx.settleResponse && !ctx.settleResponse.success) {
          const reason = ctx.settleResponse.errorReason || ctx.settleResponse.errorMessage || 'Settlement failed';
          throw new Error(`[x402] Payment rejected by server: ${reason}`);
        }
        if (ctx.paymentRequired && (ctx.paymentRequired as any).errorReason) {
          throw new Error(`[x402] Payment rejected by server: ${(ctx.paymentRequired as any).errorReason}`);
        }
      });

      this.paymentAxios = wrapAxiosWithPayment(axios.create({
        baseURL: config.baseUrl || 'http://localhost:5106/api',
        headers: {
          'Content-Type': 'application/json',
        },
      }), paymentClient);
    }
  }

  /**
   * Initializes the client. If using Path B (Wallet Private Key),
   * this will perform the SIWX login to get a JWT.
   */
  async initialize() {
    if (this.config.apiKey) {
      // Path A: Use Persistent API Key directly
      return;
    }

    if (this.config.walletPrivateKey) {
      // Path B: Autonomous Agent SIWX Login
      await this.performSiwxLogin();
      return;
    }

    throw new Error('JTraderClient requires either JTRADER_API_KEY or JTRADER_WALLET_PRIVATE_KEY');
  }

  private getAuthHeader(): string {
    if (this.config.apiKey) {
      return `Bearer ${this.config.apiKey}`;
    }
    if (this.jwtToken) {
      return `Bearer ${this.jwtToken}`;
    }
    return '';
  }

  private async performSiwxLogin() {
    if (!this.config.walletPrivateKey) return;

    const account = privateKeyToAccount(this.config.walletPrivateKey);

    // 1. Fetch nonce
    const nonceRes = await this.baseAxios.get('/agents/auth/nonce');
    const nonce = nonceRes.data.nonce;

    // 2. Construct SIWE Message
    const baseUrl = this.config.baseUrl || 'http://localhost:5106/api';
    const domain = new URL(baseUrl).hostname;
    const uri = baseUrl;
    const chainId = this.config.network === 'base-sepolia' ? baseSepolia.id : base.id;
    const issuedAt = new Date().toISOString();
    
    const statement = 'Sign in with X to JTrader.ai';
    const message = `${domain} wants you to sign in with your Ethereum account:\n${account.address}\n\n${statement}\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;

    // 3. Sign the message
    const signature = await account.signMessage({ message });

    // 4. Submit to login
    const payload: any = {
      message,
      signature,
    };
    if (this.config.bindingToken) {
      payload.binding_token = this.config.bindingToken;
    }

    const loginRes = await this.baseAxios.post('/agents/auth/siwx-login', payload);
    this.jwtToken = loginRes.data.token;
  }

  // --- API Endpoints ---

  async getReportMetadata(reportId: string) {
    const res = await this.baseAxios.get(`/agents/research/reports/${reportId}/metadata`, {
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });
    return res.data;
  }

  async getReport(reportId: string, confirmPurchase?: boolean) {
    const usePaymentAxios = (confirmPurchase || !this.config.requireApproval) && this.paymentAxios;
    const client = usePaymentAxios ? this.paymentAxios! : this.baseAxios;

    try {
      const res = await client.get(`/agents/research/reports/${reportId}`, {
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });
      if (res.status === 402 && usePaymentAxios) {
        // Fallback catch: the @x402/axios interceptor resolved the promise because
        // it expects us to handle the final 402 response. If we reach here, 
        // payment failed (likely verify phase) and the hook didn't throw.
        throw new Error(`[x402] Payment rejected by server (Insufficient funds or invalid signature).\nResponse Data: ${JSON.stringify(res.data)}`);
      }
      return res.data;
    } catch (err: any) {
      if (err.response && err.response.status === 402 && !usePaymentAxios) {
        if (!this.paymentAxios) {
          throw new Error('JTRADER_WALLET_PRIVATE_KEY is required to authorize x402 payments.');
        }
        let metadataInfo = "";
        try {
          const metaRes = await this.baseAxios.get(`/agents/research/reports/${reportId}/metadata`, {
            headers: { Authorization: this.getAuthHeader() }
          });
          metadataInfo = `\n\nREPORT METADATA:\n${JSON.stringify(metaRes.data, null, 2)}`;
        } catch (metaErr) {
          metadataInfo = "\n(Could not fetch metadata automatically)";
        }
        
        throw new Error(`[ACTION REQUIRED] Report is locked and requires an x402 USDC payment.

CRITICAL LLM INSTRUCTION: 
1. DO NOT automatically retry this tool call.
2. You MUST end your turn immediately and wait for human input.
3. Present the metadata below to the user and explicitly ask if they approve the purchase.
4. Only AFTER the user replies with their approval, you may call this tool again with confirm_purchase: true.
${metadataInfo}`);
      }
      throw err;
    }
  }

  async listReports(limit?: number, ownedOnly?: boolean) {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());
    if (ownedOnly) params.append('owned_only', 'true');
    const queryString = params.toString();
    
    const url = queryString ? `/agents/research/reports?${queryString}` : `/agents/research/reports`;
    const res = await this.baseAxios.get(url, {
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });
    return res.data;
  }

  async purchaseReport(reportId: string) {
    return this.getReport(reportId);
  }
}
