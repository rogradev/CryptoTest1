import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM authenticated encryption for wallet secret material.
 *
 * Envelope format (stored in wallet_accounts.encrypted_secret):
 *   v1.<iv base64>.<auth tag base64>.<ciphertext base64>
 *
 * The wallet address is bound as Additional Authenticated Data (AAD), so an
 * encrypted secret copied onto another wallet row fails to decrypt.
 *
 * DEVNET PROTOTYPE: a single env-supplied master key. Production custody
 * would use a KMS/HSM with key rotation and envelope encryption.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretCipher {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('SecretCipher requires a 32-byte key');
    this.#key = Buffer.from(key);
  }

  encrypt(plaintext: Uint8Array, associatedData: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
  }

  decrypt(envelope: string, associatedData: string): Buffer {
    const [version, ivB64, tagB64, ctB64, ...rest] = envelope.split('.');
    if (version !== VERSION || !ivB64 || !tagB64 || !ctB64 || rest.length > 0) {
      throw new Error('Unsupported or malformed secret envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(ivB64, 'base64'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  }
}
