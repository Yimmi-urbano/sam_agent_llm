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
    // Validar que el string no esté vacío
    if (!encrypted || typeof encrypted !== 'string' || encrypted.trim().length === 0) {
      throw new Error('Encrypted string is empty or invalid');
    }

    // Validar formato: debe tener 3 partes separadas por ':'
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid encrypted format: expected 3 parts separated by ':', got ${parts.length}. The key may need to be re-encrypted.`);
    }

    const [ivHex, authTagHex, encryptedData] = parts;
    
    // Validar que cada parte tenga contenido
    if (!ivHex || !authTagHex || !encryptedData) {
      throw new Error('Invalid encrypted format: one or more parts are empty');
    }

    // Validar que sean hexadecimales válidos
    if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(authTagHex) || !/^[0-9a-f]+$/i.test(encryptedData)) {
      throw new Error('Invalid encrypted format: parts must be valid hexadecimal strings');
    }

    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    // Validar tamaños
    if (iv.length !== 16) {
      throw new Error(`Invalid IV length: expected 16 bytes, got ${iv.length}`);
    }
    if (authTag.length !== 16) {
      throw new Error(`Invalid auth tag length: expected 16 bytes, got ${authTag.length}`);
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Si es un error de autenticación, probablemente la clave de encriptación es diferente
    if (error instanceof Error && error.message.includes('unable to authenticate')) {
      logger.error('Decryption failed: The encryption key may be different from the one used to encrypt. Check ENCRYPTION_KEY environment variable.', error);
      throw new Error('Decryption failed: Invalid encryption key or corrupted data. The API key may have been encrypted with a different ENCRYPTION_KEY.');
    }
    logger.error('Error decrypting API key', { error, encryptedLength: encrypted?.length, encryptedPreview: encrypted?.substring(0, 50) });
    throw error;
  }
}

