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
    }),
    x402Client: class MockX402Client {
      register = vi.fn();
      registerPolicy = mockRegisterPolicy;
      onAfterPaymentCreation = mockOnAfterPaymentCreation;
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
    it('should throw an explicit error if requireApproval is true and 402 is returned on getReport', async () => {
      const client = new JTraderClient({
        walletPrivateKey: MOCK_PRIVATE_KEY,
        requireApproval: true,
      });

      // We must mock the baseAxios which is used for the non-approved path
      const mockBaseAxiosGet = vi.fn().mockRejectedValue({
        response: { status: 402 }
      });
      // @ts-ignore - reaching into private for test
      client.baseAxios = { get: mockBaseAxiosGet, interceptors: { request: { use: vi.fn() } } };

      await expect(client.getReport('report-1')).rejects.toThrow(/\[ACTION REQUIRED\] Report is locked and requires an x402 USDC payment/);
    });

    it('should throw an error if 402 is returned but no wallet private key is configured', async () => {
      const client = new JTraderClient({ apiKey: 'jtr_live_123' }); // No private key!
      
      const mockBaseAxiosGet = vi.fn().mockRejectedValue({
        response: { status: 402 }
      });
      // @ts-ignore
      client.baseAxios = { get: mockBaseAxiosGet, interceptors: { request: { use: vi.fn() } } };

      await expect(client.getReport('report1')).rejects.toThrow('JTRADER_WALLET_PRIVATE_KEY is required to authorize x402 payments.');
    });
  });

  describe('Initialization', () => {
    it('throws error if neither API Key nor Private Key is provided', async () => {
      const client = new JTraderClient({});
      await expect(client.initialize()).rejects.toThrow('JTraderClient requires either JTRADER_API_KEY or JTRADER_WALLET_PRIVATE_KEY');
    });
  });
});
