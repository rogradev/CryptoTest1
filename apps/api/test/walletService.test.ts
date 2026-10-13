import { Keypair } from '@solana/web3.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { SecretCipher } from '../src/lib/secretCipher.js';
import { WalletService } from '../src/services/walletService.js';
import { WithdrawalService } from '../src/services/withdrawalService.js';
import {
  InMemoryUserRepository,
  InMemoryWalletAccountRepository,
  MockBlockchainProvider,
  testKey,
} from './helpers.js';

const USER = 'demo-user-001';

describe('WalletService', () => {
  let wallets: InMemoryWalletAccountRepository;
  let chain: MockBlockchainProvider;
  let key: Buffer;
  let service: WalletService;

  beforeEach(() => {
    wallets = new InMemoryWalletAccountRepository();
    chain = new MockBlockchainProvider();
    key = testKey();
    service = new WalletService(new InMemoryUserRepository([USER]), wallets, chain, new SecretCipher(key));
  });

  it('creates a wallet on first use and persists only encrypted secret material', async () => {
    const wallet = await service.getOrCreateWallet(USER);
    expect(wallet.userId).toBe(USER);
    expect(wallet.network).toBe('solana-devnet');
    expect(chain.isValidAddress(wallet.address)).toBe(true);
    expect(wallet).not.toHaveProperty('encryptedSecret');

    const envelope = await wallets.getEncryptedSecret(wallet.id);
    expect(envelope).toMatch(/^v1\./);
    // The stored envelope decrypts to a keypair whose public key IS the wallet address.
    const secret = new SecretCipher(key).decrypt(envelope!, wallet.address);
    expect(Keypair.fromSecretKey(secret).publicKey.toBase58()).toBe(wallet.address);
  });

  it('zeroes the generated secret key in memory after encrypting it', async () => {
    await service.getOrCreateWallet(USER);
    expect(chain.lastSecretKey?.every((b) => b === 0)).toBe(true);
  });

  it('returns the persisted wallet on subsequent calls instead of generating a new one', async () => {
    const first = await service.getOrCreateWallet(USER);
    const second = await service.getOrCreateWallet(USER);
    expect(second).toEqual(first);
    expect(chain.createdWallets).toBe(1);

    // Simulates an API restart: a new service instance over the same storage.
    const restarted = new WalletService(new InMemoryUserRepository([USER]), wallets, new MockBlockchainProvider(), new SecretCipher(key));
    expect((await restarted.getOrCreateWallet(USER)).address).toBe(first.address);
  });

  it('handles concurrent first requests without creating two wallets', async () => {
    const [a, b] = await Promise.all([service.getOrCreateWallet(USER), service.getOrCreateWallet(USER)]);
    expect(a.address).toBe(b.address);
    expect(wallets.rows).toHaveLength(1);
  });

  it('fails clearly for an unknown user', async () => {
    await expect(service.getOrCreateWallet('nobody')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(chain.createdWallets).toBe(0);
  });

  it('reads the on-chain balance as bigint lamports', async () => {
    const wallet = await service.getOrCreateWallet(USER);
    chain.balances.set(wallet.address, 2_500_000_000n);
    const balance = await service.getOnChainBalance(USER);
    expect(balance.lamports).toBe(2_500_000_000n);
    expect(balance.wallet.address).toBe(wallet.address);
  });
});

describe('WithdrawalService.validate', () => {
  const setup = async (balance: bigint) => {
    const chain = new MockBlockchainProvider();
    const walletService = new WalletService(
      new InMemoryUserRepository([USER]),
      new InMemoryWalletAccountRepository(),
      chain,
      new SecretCipher(testKey()),
    );
    const wallet = await walletService.getOrCreateWallet(USER);
    chain.balances.set(wallet.address, balance);
    return { wallet, withdrawals: new WithdrawalService(walletService, chain) };
  };
  const destination = Keypair.generate().publicKey.toBase58();

  it('accepts a valid request but never enables broadcasting', async () => {
    const { withdrawals } = await setup(2_000_000_000n);
    const result = await withdrawals.validate(USER, { destinationAddress: destination, amountSol: '0.5' });
    expect(result.valid).toBe(true);
    expect(result.amountLamports).toBe('500000000');
    expect(result.broadcastEnabled).toBe(false);
  });

  it.each(['not-a-solana-address', '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', ''])(
    'rejects invalid Solana address "%s"',
    async (address) => {
      const { withdrawals } = await setup(2_000_000_000n);
      const result = await withdrawals.validate(USER, { destinationAddress: address, amountSol: '0.1' });
      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual({ field: 'destinationAddress', message: 'Not a valid Solana address' });
    },
  );

  it('rejects sending to the wallet itself', async () => {
    const { wallet, withdrawals } = await setup(2_000_000_000n);
    const result = await withdrawals.validate(USER, { destinationAddress: wallet.address, amountSol: '0.1' });
    expect(result.issues[0]?.field).toBe('destinationAddress');
  });

  it('rejects amounts above balance (including fee), zero and malformed amounts', async () => {
    const { withdrawals } = await setup(1_000_000_000n);
    for (const amountSol of ['1', '0', 'abc', '0.0000000001']) {
      const result = await withdrawals.validate(USER, { destinationAddress: destination, amountSol });
      expect(result.valid, amountSol).toBe(false);
      expect(result.issues[0]?.field).toBe('amountSol');
    }
  });

  it('reports insufficient funds against the real on-chain balance', async () => {
    const { withdrawals } = await setup(0n);
    const result = await withdrawals.validate(USER, { destinationAddress: destination, amountSol: '1' });
    expect(result.availableLamports).toBe('0');
    expect(result.issues).toContainEqual({ field: 'amountSol', message: 'Amount plus network fee exceeds the available balance' });
  });
});
