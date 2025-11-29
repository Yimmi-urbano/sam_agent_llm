import crypto from 'crypto';
import { logger } from './logger.js';

// Normalizar y obtener la clave de encriptación
const rawKey = process.env.ENCRYPTION_KEY || '';
const ENCRYPTION_KEY = rawKey.trim().normalize('NFKC');

// Log de diagnóstico (solo primeros y últimos caracteres por seguridad)
if (!process.env.ENCRYPTION_KEY) {
  logger.error('ENCRYPTION_KEY not found in environment variables - using empty string (will fail)');
} else {
  const keyPreview = ENCRYPTION_KEY.length > 8 
    ? `${ENCRYPTION_KEY.substring(0, 4)}...${ENCRYPTION_KEY.substring(ENCRYPTION_KEY.length - 4)}`
    : '***';
  logger.error(`ENCRYPTION_KEY loaded: length=${ENCRYPTION_KEY.length}, preview=${keyPreview}`);
}

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
    // Validar que ENCRYPTION_KEY esté configurada
    if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length === 0) {
      throw new Error('ENCRYPTION_KEY is not configured or is empty');
    }

    // Normalizar el string encriptado (por problemas de encoding Windows/Linux)
    const normalized = encrypted.trim().normalize('NFKC');
    
    // Validar formato básico
    if (!normalized.includes(':')) {
      logger.error('Invalid encrypted format: missing colons', {
        encryptedLength: normalized.length,
        encryptedPreview: normalized.substring(0, 50),
      });
      throw new Error('Invalid encrypted format: expected format iv:authTag:encrypted');
    }

    const parts = normalized.split(':');
    if (parts.length !== 3) {
      logger.error('Invalid encrypted format: wrong number of parts', {
        partsCount: parts.length,
        encryptedPreview: normalized.substring(0, 50),
      });
      throw new Error(`Invalid encrypted format: expected 3 parts separated by ':', got ${parts.length}`);
    }

    const [ivHex, authTagHex, encryptedData] = parts;
    
    // Validar que todas las partes existan y tengan contenido
    if (!ivHex || !authTagHex || !encryptedData) {
      logger.error('Invalid encrypted format: empty parts', {
        hasIv: !!ivHex,
        hasAuthTag: !!authTagHex,
        hasEncryptedData: !!encryptedData,
        encryptedPreview: normalized.substring(0, 50),
      });
      throw new Error('Invalid encrypted format: one or more parts are empty');
    }

    // Validar longitudes esperadas (IV: 32 chars hex = 16 bytes, AuthTag: 32 chars hex = 16 bytes)
    if (ivHex.length !== 32) {
      logger.error('Invalid IV length', { ivLength: ivHex.length, expected: 32 });
      throw new Error(`Invalid IV length: expected 32 hex characters, got ${ivHex.length}`);
    }

    if (authTagHex.length !== 32) {
      logger.error('Invalid authTag length', { authTagLength: authTagHex.length, expected: 32 });
      throw new Error(`Invalid authTag length: expected 32 hex characters, got ${authTagHex.length}`);
    }

    // Generar la clave de derivación
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    
    // Convertir hex a buffers
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    // Validar que los buffers se crearon correctamente
    if (iv.length !== 16) {
      throw new Error(`Invalid IV buffer length: expected 16 bytes, got ${iv.length}`);
    }
    if (authTag.length !== 16) {
      throw new Error(`Invalid authTag buffer length: expected 16 bytes, got ${authTag.length}`);
    }

    // Crear decipher y desencriptar
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Log detallado del error
    logger.error('Error decrypting API key', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      encryptionKeyLength: ENCRYPTION_KEY.length,
      encryptionKeyConfigured: !!process.env.ENCRYPTION_KEY,
      encryptedLength: encrypted?.length,
      encryptedPreview: encrypted?.substring(0, 50),
    });
    throw error;
  }
}

