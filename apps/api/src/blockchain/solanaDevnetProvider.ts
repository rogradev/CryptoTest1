import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  type ConfirmedSignatureInfo,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js';
import { base58Encode, SOLANA_NETWORK } from '@wallet/shared';
import { Errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  TransactionRejectedError,
  type BlockchainProvider,
  type BlockchainTransaction,
  type NativeTransfer,
  type NetworkStatus,
  type SignatureInfo,
  type SignatureStatus,
  type SignedTransfer,
  type TransactionDetails,
  type WalletResult,
} from './types.js';

/** Genesis hash of Solana Devnet. Used to prove we are not talking to mainnet. */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

const COMMITMENT = 'confirmed' as const;
const RPC_TIMEOUT_MS = 15_000;

export class SolanaDevnetProvider implements BlockchainProvider {
  readonly network = SOLANA_NETWORK;
  readonly #connection: Connection;
  #networkVerified = false;

  constructor(rpcUrl: string) {
    this.#connection = new Connection(rpcUrl, {
      commitment: COMMITMENT,
      disableRetryOnRateLimit: true,
      // Native fetch with a hard timeout so a slow RPC never hangs a request.
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
    });
  }

  async createWallet(): Promise<WalletResult> {
    await this.assertDevnet();
    const keypair = Keypair.generate();
    return { address: keypair.publicKey.toBase58(), secretKey: keypair.secretKey };
  }

  isValidAddress(address: string): boolean {
    try {
      return new PublicKey(address).toBase58() === address;
    } catch {
      return false;
    }
  }

  async getBalance(address: string): Promise<bigint> {
    await this.assertDevnet();
    const lamports = await this.#rpc(() => this.#connection.getBalance(new PublicKey(address), COMMITMENT));
    // web3.js returns a JS number; a u64 balance only loses precision above 2^53
    // lamports (~9M SOL), which is unreachable for a devnet wallet. Guard anyway.
    if (!Number.isSafeInteger(lamports)) throw new Error('Balance exceeds safe integer range');
    return BigInt(lamports);
  }

  async getRecentTransactions(address: string, limit = 10): Promise<BlockchainTransaction[]> {
    await this.assertDevnet();
    const pubkey = new PublicKey(address);
    const signatures = await this.#rpc(() => this.#connection.getSignaturesForAddress(pubkey, { limit }));
    if (signatures.length === 0) return [];

    const parsed = await this.#rpc(() =>
      Promise.all(
        signatures.map((info) =>
          this.#connection
            .getParsedTransaction(info.signature, { commitment: COMMITMENT, maxSupportedTransactionVersion: 0 })
            .catch(() => null),
        ),
      ),
    );

    return signatures.map((info, i) => normalizeTransaction(info, parsed[i] ?? null, address));
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    const [genesisHash, slot, version] = await this.#rpc(() =>
      Promise.all([this.#connection.getGenesisHash(), this.#connection.getSlot(), this.#connection.getVersion()]),
    );
    return { network: this.network, genesisHash, slot, version: version['solana-core'] };
  }

  explorerUrl(kind: 'address' | 'tx', value: string): string {
    return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
  }

  async getRecentSignatures(address: string, limit: number): Promise<SignatureInfo[]> {
    await this.assertDevnet();
    const infos = await this.#rpc(() =>
      this.#connection.getSignaturesForAddress(new PublicKey(address), { limit }, COMMITMENT),
    );
    return infos.map((info) => ({
      signature: info.signature,
      slot: info.slot,
      blockTime: info.blockTime ? new Date(info.blockTime * 1000) : null,
      status: info.confirmationStatus ?? 'confirmed',
      failed: info.err !== null,
    }));
  }

  async getTransaction(signature: string): Promise<TransactionDetails | null> {
    await this.assertDevnet();
    const tx = await this.#rpc(() =>
      this.#connection.getParsedTransaction(signature, { commitment: COMMITMENT, maxSupportedTransactionVersion: 0 }),
    );
    if (!tx?.meta) return null;
    const feePayer = tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? '';
    const instructions = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ];
    return {
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
      failed: tx.meta.err !== null,
      feeLamports: BigInt(tx.meta.fee),
      feePayer,
      transfers: instructions.flatMap(toNativeTransfer),
    };
  }

  async getSignatureStatuses(signatures: string[]): Promise<Map<string, SignatureStatus | null>> {
    const result = new Map<string, SignatureStatus | null>();
    if (signatures.length === 0) return result;
    await this.assertDevnet();
    for (let i = 0; i < signatures.length; i += 256) {
      const batch = signatures.slice(i, i + 256);
      const { value } = await this.#rpc(() =>
        this.#connection.getSignatureStatuses(batch, { searchTransactionHistory: true }),
      );
      batch.forEach((signature, j) => {
        const status = value[j];
        result.set(
          signature,
          status
            ? {
                status: status.confirmationStatus ?? 'processed',
                failed: status.err !== null,
                error: status.err ? JSON.stringify(status.err) : null,
              }
            : null,
        );
      });
    }
    return result;
  }

  async getBlockHeight(): Promise<number> {
    await this.assertDevnet();
    return this.#rpc(() => this.#connection.getBlockHeight(COMMITMENT));
  }

  async getMinimumBalanceForRentExemption(): Promise<bigint> {
    await this.assertDevnet();
    return BigInt(await this.#rpc(() => this.#connection.getMinimumBalanceForRentExemption(0)));
  }

  async createSignedTransfer(params: {
    secretKey: Uint8Array;
    destination: string;
    lamports: bigint;
  }): Promise<SignedTransfer> {
    await this.assertDevnet();
    const from = Keypair.fromSecretKey(params.secretKey);
    const { blockhash, lastValidBlockHeight } = await this.#rpc(() => this.#connection.getLatestBlockhash(COMMITMENT));
    const tx = new Transaction({ feePayer: from.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(params.destination),
        lamports: params.lamports,
      }),
    );
    tx.sign(from);
    if (!tx.signature) throw new Error('Transaction signing produced no signature');
    return {
      signature: base58Encode(tx.signature),
      serialized: tx.serialize(),
      lastValidBlockHeight,
    };
  }

  async sendRawTransaction(serialized: Uint8Array): Promise<string> {
    await this.assertDevnet();
    try {
      return await this.#connection.sendRawTransaction(serialized, {
        skipPreflight: false,
        preflightCommitment: COMMITMENT,
        maxRetries: 5,
      });
    } catch (error) {
      // Preflight simulation failure: the transaction is invalid and will never land.
      if (error instanceof SendTransactionError) throw new TransactionRejectedError(error.message);
      // Anything else (timeout, network) is ambiguous: it may still land.
      logger.warn('sendRawTransaction failed with an ambiguous error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw Errors.blockchainUnavailable();
    }
  }

  /** Refuses to operate unless the RPC endpoint reports the devnet genesis hash. */
  async assertDevnet(): Promise<void> {
    if (this.#networkVerified) return;
    const genesisHash = await this.#rpc(() => this.#connection.getGenesisHash());
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      logger.error('Solana RPC is not devnet — refusing to continue', { genesisHash });
      throw new Error('Configured Solana RPC endpoint is not Solana Devnet');
    }
    this.#networkVerified = true;
  }

  async #rpc<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      logger.warn('Solana RPC call failed', { error: error instanceof Error ? error.message : String(error) });
      throw Errors.blockchainUnavailable();
    }
  }
}

/** Derives direction and net lamport change for `address` from pre/post balances. */
export function normalizeTransaction(
  info: ConfirmedSignatureInfo,
  tx: ParsedTransactionWithMeta | null,
  address: string,
): BlockchainTransaction {
  const status: BlockchainTransaction['status'] = info.err
    ? 'failed'
    : (info.confirmationStatus ?? 'confirmed');
  const base: BlockchainTransaction = {
    signature: info.signature,
    slot: info.slot,
    blockTime: info.blockTime ? new Date(info.blockTime * 1000) : null,
    status,
    direction: 'unknown',
    amountLamports: null,
    feeLamports: null,
  };
  if (!tx?.meta) return base;

  const index = tx.transaction.message.accountKeys.findIndex((key) => key.pubkey.toBase58() === address);
  const pre = tx.meta.preBalances[index];
  const post = tx.meta.postBalances[index];
  const feeLamports = BigInt(tx.meta.fee);
  if (index < 0 || pre === undefined || post === undefined) return { ...base, feeLamports };

  const delta = BigInt(post) - BigInt(pre);
  const isFeePayer = index === 0;
  const direction = delta > 0n ? 'inbound' : delta < 0n ? (isFeePayer && delta === -feeLamports ? 'self' : 'outbound') : 'self';
  return { ...base, direction, amountLamports: delta, feeLamports };
}

/** Extracts a native SOL transfer from a parsed System Program instruction. */
function toNativeTransfer(ix: ParsedInstruction | PartiallyDecodedInstruction): NativeTransfer[] {
  if (!('parsed' in ix) || ix.program !== 'system') return [];
  const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> };
  if (parsed.type !== 'transfer' && parsed.type !== 'transferWithSeed') return [];
  const { source, destination, lamports } = parsed.info ?? {};
  if (typeof source !== 'string' || typeof destination !== 'string') return [];
  if (typeof lamports !== 'number' && typeof lamports !== 'string') return [];
  return [{ source, destination, lamports: BigInt(lamports) }];
}
