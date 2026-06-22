import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JTraderClient } from '../jtraderClient.js';
import axios from 'axios';

// Mock viem and @x402/axios
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({ address: '0x123' }),
}));

vi.mock('@x402/evm/exact/client', () => ({
  ExactEvmScheme: vi.fn(),
}));

const mockRegisterPolicy = vi.fn();
const mockOnAfterPaymentCreation = vi.fn();

vi.mock('@x402/axios', () => {
  return {
    wrapAxiosWithPayment: vi.fn().mockReturnValue({
      get: vi.fn(),
      interceptors: { response: { use: vi.fn() } }
    }),
    x402Client: class MockX402Client {
      register = vi.fn();
      registerPolicy = mockRegisterPolicy;
      onAfterPaymentCreation = mockOnAfterPaymentCreation;
      onPaymentResponse = vi.fn();
    },
  };
});

describe('JTraderClient', () => {
  const MOCK_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Policies', () => {
    it('should filter payment requirements exceeding maxSpendLimit', () => {
      new JTraderClient({
        walletPrivateKey: MOCK_PRIVATE_KEY,
        maxSpendLimit: 5.0, // 5 USDC = 5_000_000n
        network: 'base-sepolia'
      });

      const policy = mockRegisterPolicy.mock.calls[0][0];

      const reqs = [
        { amount: '4000000', network: 'eip155:84532' }, // Allowed (4 USDC)
        { amount: '6000000', network: 'eip155:84532' }, // Blocked (6 USDC)
      ];

      const filtered = policy(1, reqs as any);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].amount).toBe('4000000');
    });

    it('should filter payment requirements exceeding maxSessionSpend', () => {
      new JTraderClient({
        walletPrivateKey: MOCK_PRIVATE_KEY,
        maxSessionSpend: 10.0, // 10 USDC
        network: 'base-sepolia'
      });

      const policy = mockRegisterPolicy.mock.calls[0][0];
      const afterCreationHook = mockOnAfterPaymentCreation.mock.calls[0][0];

      // Simulate 8 USDC spend
      afterCreationHook({
        selectedRequirements: { amount: '8000000' }
      });

      // Now try to spend 3 USDC more (total 11)
      const reqs = [
        { amount: '3000000', network: 'eip155:84532' }, // Blocked
      ];

      const filtered = policy(1, reqs as any);
      expect(filtered).toHaveLength(0);
    });

    it('should filter payment requirements with mismatched networks', () => {
      new JTraderClient({
        walletPrivateKey: MOCK_PRIVATE_KEY,
        network: 'base'
      });

      const policy = mockRegisterPolicy.mock.calls[0][0];

      const reqs = [
        { amount: '1000000', network: 'eip155:8453' }, // Base Mainnet (Allowed)
        { amount: '1000000', network: 'eip155:84532' }, // Base Sepolia (Blocked)
      ];

      const filtered = policy(1, reqs as any);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].network).toBe('eip155:8453');
    });
  });

  describe('Report Fetching', () => {
    it('should return wrapped report if fetch succeeds without payment', async () => {
      const client = new JTraderClient({ apiKey: 'jtr_live_123' });
      const reportData = { id: 'report-1', content: 'Premium content' };
      const mockBaseAxiosGet = vi.fn().mockResolvedValue({
        data: reportData,
      });
      // @ts-ignore
      client.baseAxios = { get: mockBaseAxiosGet };

      const res = await client.getReport('report-1');
      expect(res).toEqual({ report: reportData });
    });

    it('should throw an explicit error if requireApproval is true and 402 is returned on getReport, extracting price if header is present', async () => {
      const client = new JTraderClient({
        walletPrivateKey: MOCK_PRIVATE_KEY,
        requireApproval: true,
      });

      // 402 with base64 encoded requirements containing accepts[0].amount = 5000000 (5 USDC)
      const mockPaymentRequired = {
        accepts: [
          { amount: '5000000' }
        ]
      };
      const encodedHeader = Buffer.from(JSON.stringify(mockPaymentRequired)).toString('base64');

      const mockBaseAxiosGet = vi.fn().mockRejectedValue({
        response: {
          status: 402,
          headers: {
            'payment-required': encodedHeader
          }
        }
      });
      // @ts-ignore - reaching into private for test
      client.baseAxios = { get: mockBaseAxiosGet, interceptors: { request: { use: vi.fn() } } };

      await expect(client.getReport('report-1')).rejects.toThrow(/\[ACTION REQUIRED\] Report is locked and requires an x402 USDC payment\.\nPrice: 5\.00 USDC/);
    });

    it('should return purchaseDetails when lastPaymentAmount is populated', async () => {
      const client = new JTraderClient({
        walletPrivateKey: MOCK_PRIVATE_KEY,
        requireApproval: false,
      });

      const reportData = { id: 'report-1', content: 'Premium content' };
      const mockPaymentAxiosGet = vi.fn().mockImplementation(() => {
        // Simulate the onAfterPaymentCreation hook setting the payment amount during execution
        // @ts-ignore
        client.lastPaymentAmount = 5.0;
        // @ts-ignore
        client.sessionSpend = 5000000n;
        return Promise.resolve({ data: reportData });
      });
      // @ts-ignore
      client.paymentAxios = { get: mockPaymentAxiosGet };

      const res = await client.getReport('report-1');
      expect(res).toEqual({
        report: reportData,
        purchaseDetails: {
          amountPaid: 5.0,
          sessionSpend: 5.0
        }
      });
    });

    it('should throw an error if 402 is returned but no wallet private key is configured', async () => {
      const client = new JTraderClient({ apiKey: 'jtr_live_123' }); // No private key!
      
      const mockBaseAxiosGet = vi.fn().mockRejectedValue({
        response: { status: 402 }
      });
      // @ts-ignore
      client.baseAxios = { get: mockBaseAxiosGet, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };

      await expect(client.getReport('report1')).rejects.toThrow('JTRADER_WALLET_PRIVATE_KEY is required to authorize x402 payments.');
    });
  });

  describe('Authentication', () => {
    it('should retry a 401 response and re-authenticate via SIWX', async () => {
      const client = new JTraderClient({
        walletPrivateKey: MOCK_PRIVATE_KEY,
      });

      // Mock performSiwxLogin
      const performSiwxLoginSpy = vi.spyOn(client as any, 'performSiwxLogin').mockResolvedValue(undefined);

      // We simulate an error from an axios interceptor when a request returns 401
      const mockRequestConfig = { _retry: false, headers: {} };
      const mockError = {
        config: mockRequestConfig,
        response: { status: 401 }
      };

      // Extract the response interceptor handler that was registered
      // @ts-ignore
      const interceptorHandlers = client.baseAxios.interceptors.response.handlers;
      // Depending on axios version/mock, it's either an array or mock calls.
      // Since baseAxios is created via real axios.create() in the constructor, we can access handlers.
      const rejectedHandler = interceptorHandlers![0].rejected!;

      // Use a mock adapter so the retried request doesn't hit the network
      // @ts-ignore
      mockRequestConfig.adapter = vi.fn().mockResolvedValue({ data: 'retried response' });

      const retryResult = await rejectedHandler!(mockError);

      expect(performSiwxLoginSpy).toHaveBeenCalled();
      expect(mockRequestConfig._retry).toBe(true);
      expect(retryResult.data).toBe('retried response');
    });
  });

  describe('Initialization', () => {
    it('throws error if neither API Key nor Private Key is provided', async () => {
      const client = new JTraderClient({});
      await expect(client.initialize()).rejects.toThrow('JTraderClient requires either JTRADER_API_KEY or JTRADER_WALLET_PRIVATE_KEY');
    });
  });
});
