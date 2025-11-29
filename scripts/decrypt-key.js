#!/usr/bin/env node
/**
 * Script para desencriptar y verificar API keys
 * 
 * Uso:
 *   node scripts/decrypt-key.js "clave-encriptada-aqui"
 */

import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'bccf34da741ac2aa43f99bfe8212499e6282242cba199d9e9fdd26ad4cadd49d';
const ALGORITHM = 'aes-256-gcm';

/**
 * Desencripta una API key
 */
function decryptApiKey(encrypted) {
  try {
    // Validar que el string no esté vacío
    if (!encrypted || typeof encrypted !== 'string' || encrypted.trim().length === 0) {
      throw new Error('Encrypted string is empty or invalid');
    }

    // Validar formato: debe tener 3 partes separadas por ':'
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid encrypted format: expected 3 parts separated by ':', got ${parts.length}`);
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

    console.log('📋 Analizando clave encriptada...');
    console.log(`   IV (${ivHex.length} chars): ${ivHex.substring(0, 16)}...`);
    console.log(`   AuthTag (${authTagHex.length} chars): ${authTagHex.substring(0, 16)}...`);
    console.log(`   Encrypted Data (${encryptedData.length} chars): ${encryptedData.substring(0, 32)}...`);
    console.log(`   ENCRYPTION_KEY usado: ${ENCRYPTION_KEY.substring(0, 16)}...\n`);

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

    console.log('🔓 Intentando desencriptar...\n');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    if (error.message.includes('unable to authenticate')) {
      throw new Error(
        '❌ Error de autenticación: La clave de encriptación (ENCRYPTION_KEY) es diferente a la usada para encriptar.\n' +
        '   Verifica que la variable de entorno ENCRYPTION_KEY sea la correcta.'
      );
    }
    throw error;
  }
}

/**
 * Función principal
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Error: Debes proporcionar la clave encriptada como argumento');
    console.log('\nUso:');
    console.log('  node scripts/decrypt-key.js "clave-encriptada-aqui"');
    console.log('\nEjemplo:');
    console.log('  node scripts/decrypt-key.js "f5b88fbb4d7cee7423aa20b1f849c670:7997ad5a800ce78ad926e05710b5457e:c07af04cb56731cd53ab7c87558f53b33cfafaf6cf105718d30f6540b5ae495bf7331e30d70d4e"');
    process.exit(1);
  }

  const encryptedKey = args[0].trim();

  try {
    const decryptedKey = decryptApiKey(encryptedKey);
    
    console.log('✅ Clave desencriptada exitosamente:\n');
    console.log(decryptedKey);
    console.log('\n📋 La clave desencriptada se muestra arriba.');
    console.log('   ⚠️  Mantén esta información segura y no la compartas.\n');
    
  } catch (error) {
    console.error('\n❌ Error al desencriptar:', error.message);
    console.log('\n💡 Posibles soluciones:');
    console.log('   1. Verifica que la variable de entorno ENCRYPTION_KEY sea correcta');
    console.log('   2. Asegúrate de usar la misma clave que se usó para encriptar');
    console.log('   3. Si no tienes la clave original, necesitarás re-encriptar con la clave actual\n');
    process.exit(1);
  }
}

// Ejecutar
main();

