#!/usr/bin/env node
/**
 * Script para probar si una clave fue encriptada con comillas incluidas
 * 
 * Uso:
 *   node scripts/test-with-quotes.js "clave-encriptada"
 */

import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'bccf34da741ac2aa43f99bfe8212499e6282242cba199d9e9fdd26ad4cadd49d';
const ALGORITHM = 'aes-256-gcm';

function decryptApiKey(encrypted, encryptionKey) {
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid format');
    }

    const [ivHex, authTagHex, encryptedData] = parts;
    const key = crypto.scryptSync(encryptionKey, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

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
    process.exit(1);
  }

  const encryptedKey = args[0].trim();

  console.log('🔍 Probando diferentes variantes de desencriptación...\n');

  // Intentar desencriptar directamente
  try {
    const result = decryptApiKey(encryptedKey, ENCRYPTION_KEY);
    console.log('✅ Desencriptación exitosa (sin comillas):');
    console.log(`   Resultado: ${result}`);
    console.log(`   Longitud: ${result.length} caracteres`);
    if (result.startsWith('"') || result.startsWith("'")) {
      console.log('   ⚠️  La clave desencriptada comienza con comillas');
    }
    if (result.endsWith('"') || result.endsWith("'")) {
      console.log('   ⚠️  La clave desencriptada termina con comillas');
    }
    return;
  } catch (error) {
    console.log('❌ No se pudo desencriptar directamente\n');
  }

  console.log('💡 La clave no se puede desencriptar con la ENCRYPTION_KEY actual.');
  console.log('   Esto significa que:');
  console.log('   1. La clave fue encriptada con una ENCRYPTION_KEY diferente, O');
  console.log('   2. La API key original tenía comillas incluidas al encriptar\n');
}

main();

