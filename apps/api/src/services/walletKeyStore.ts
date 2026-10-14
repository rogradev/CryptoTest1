import type { SecretCipher } from '../lib/secretCipher.js';
import type { WalletAccount, WalletAccountRepository } from '../repositories/walletAccountRepository.js';

/**
 * The only place a wallet secret key is ever decrypted.
 *
 * The plaintext key exists only for the duration of `use` (signing) and is
 * zeroed afterwards. It is never returned, logged or sent over HTTP.
 */
export class WalletKeyStore {
  constructor(
    private readonly wallets: WalletAccountRepository,
    private readonly cipher: SecretCipher,
  ) {}

  async withSecretKey<T>(wallet: WalletAccount, use: (secretKey: Uint8Array) => Promise<T>): Promise<T> {
    const envelope = await this.wallets.getEncryptedSecret(wallet.id);
    if (!envelope) throw new Error('Wallet secret not found');
    const secretKey = this.cipher.decrypt(envelope, wallet.address);
    try {
      return await use(new Uint8Array(secretKey.buffer, secretKey.byteOffset, secretKey.byteLength));
    } finally {
      secretKey.fill(0);
    }
  }
}
