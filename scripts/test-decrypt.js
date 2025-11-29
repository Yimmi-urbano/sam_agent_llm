#!/usr/bin/env node
/**
 * Script para probar desencriptación con diferentes ENCRYPTION_KEY
 * 
 * Uso:
 *   node scripts/test-decrypt.js "clave-encriptada" [ENCRYPTION_KEY_OPCIONAL]
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function decryptApiKey(encrypted, encryptionKey) {
  try {
    if (!encrypted || typeof encrypted !== 'string' || encrypted.trim().length === 0) {
      throw new Error('Encrypted string is empty or invalid');
    }

    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid encrypted format: expected 3 parts, got ${parts.length}`);
    }

    const [ivHex, authTagHex, encryptedData] = parts;
    
    if (!ivHex || !authTagHex || !encryptedData) {
      throw new Error('Invalid encrypted format: one or more parts are empty');
    }

    if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(authTagHex) || !/^[0-9a-f]+$/i.test(encryptedData)) {
      throw new Error('Invalid encrypted format: parts must be valid hexadecimal strings');
    }

    const key = crypto.scryptSync(encryptionKey, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

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
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Error: Debes proporcionar la clave encriptada');
    console.log('\nUso:');
    console.log('  node scripts/test-decrypt.js "clave-encriptada" [ENCRYPTION_KEY]');
    process.exit(1);
  }

  const encryptedKey = args[0].trim();
  const testKey = args[1] || process.env.ENCRYPTION_KEY || 'bccf34da741ac2aa43f99bfe8212499e6282242cba199d9e9fdd26ad4cadd49d';

  console.log('🔍 Probando desencriptación...\n');
  console.log(`📋 Clave encriptada: ${encryptedKey.substring(0, 50)}...`);
  console.log(`🔑 ENCRYPTION_KEY: ${testKey.substring(0, 32)}...\n`);

  try {
    const decryptedKey = decryptApiKey(encryptedKey, testKey);
    
    console.log('✅ ¡Éxito! Clave desencriptada:\n');
    console.log(decryptedKey);
    console.log('\n💡 Esta es la ENCRYPTION_KEY correcta. Configúrala en tu .env:\n');
    console.log(`ENCRYPTION_KEY=${testKey}\n`);
    
  } catch (error) {
    if (error.message.includes('unable to authenticate')) {
      console.error('❌ Error: La ENCRYPTION_KEY no es correcta');
      console.log('\n💡 Prueba con:');
      console.log('   1. La ENCRYPTION_KEY original que usaste para encriptar');
      console.log('   2. O re-encripta la API key con la clave actual usando:');
      console.log('      node scripts/encrypt-key.js "tu-api-key-plana"\n');
    } else {
      console.error('❌ Error:', error.message);
    }
    process.exit(1);
  }
}

main();

