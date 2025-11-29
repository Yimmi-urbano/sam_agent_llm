import crypto from 'crypto';
import { logger } from './logger.js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'bccf34da741ac2aa43f99bfe8212499e6282242cba199d9e9fdd26ad4cadd49d';
const ALGORITHM = 'aes-256-gcm';

/**
 * Encripta una API key usando AES-256-GCM
 * En producción, usar AWS KMS o similar
 */
export function encryptApiKey(apiKey: string): string {
  try {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combinar IV, authTag y encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error('Error encrypting API key', error);
    throw error;
  }
}

/**
 * Desencripta una API key
 */
export function decryptApiKey(encrypted: string): string {
  try {
    const [ivHex, authTagHex, encryptedData] = encrypted.split(':');
    if (!ivHex || !authTagHex || !encryptedData) {
      throw new Error('Invalid encrypted format');
    }

    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('Error decrypting API key', error);
    throw error;
  }
}

