import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../errors';

/** AES-256-GCM for secrets stored in the database (ToyyibPay User Secret Keys). Format: v1.iv.tag.ciphertext (base64url). */
const VERSION = 'v1';

function keyFrom(base64Key: string | undefined): Buffer {
  if (!base64Key) {
    throw new AppError(503, 'encryption_not_configured', 'Payments are not set up on this server yet (APP_ENCRYPTION_KEY)');
  }
  return Buffer.from(base64Key, 'base64');
}

export function encryptSecret(plain: string, base64Key: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(base64Key), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function decryptSecret(stored: string, base64Key: string | undefined): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(base64Key), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
