#!/usr/bin/env node
/**
 * Script para encriptar API keys de audio
 * 
 * Uso:
 *   node scripts/encrypt-key.js "tu-api-key-aqui"
 * 
 * O para copiar al portapapeles (Windows):
 *   node scripts/encrypt-key.js "tu-api-key-aqui" | clip
 * 
 * O para copiar al portapapeles (Linux/Mac):
 *   node scripts/encrypt-key.js "tu-api-key-aqui" | xclip -selection clipboard
 */

import crypto from 'crypto';
import readline from 'readline';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'bccf34da741ac2aa43f99bfe8212499e6282242cba199d9e9fdd26ad4cadd49d';
const ALGORITHM = 'aes-256-gcm';

/**
 * Encripta una API key usando AES-256-GCM
 */
function encryptApiKey(apiKey) {
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
    console.error('Error encrypting API key:', error.message);
    process.exit(1);
  }
}

/**
 * Función principal
 */
function main() {
  const args = process.argv.slice(2);

  // Si se proporciona la clave como argumento
  if (args.length > 0) {
    let plainKey = args[0].trim();
    
    // Detectar y remover comillas si están incluidas
    if ((plainKey.startsWith('"') && plainKey.endsWith('"')) || 
        (plainKey.startsWith("'") && plainKey.endsWith("'"))) {
      console.warn('⚠️  Advertencia: Se detectaron comillas en la API key. Se removerán automáticamente.\n');
      plainKey = plainKey.slice(1, -1).trim();
    }
    
    // Validar que no esté vacía después de limpiar
    if (!plainKey || plainKey.length === 0) {
      console.error('❌ Error: La API key no puede estar vacía después de remover comillas y espacios');
      process.exit(1);
    }
    
    // Mostrar preview de la clave que se va a encriptar (solo primeros y últimos caracteres)
    const preview = plainKey.length > 20 
      ? `${plainKey.substring(0, 10)}...${plainKey.substring(plainKey.length - 4)}` 
      : plainKey.substring(0, Math.min(plainKey.length, 10)) + '...';
    console.log(`📝 Encriptando API key: ${preview} (${plainKey.length} caracteres)\n`);
    
    const encryptedKey = encryptApiKey(plainKey);
    
    // Si la salida se está redirigiendo (para copiar al portapapeles), solo mostrar la clave
    if (!process.stdout.isTTY) {
      console.log(encryptedKey);
      return;
    }
    
    // Mostrar información adicional si es una terminal interactiva
    console.log('\n✅ Clave encriptada exitosamente:\n');
    console.log(encryptedKey);
    console.log('\n📋 La clave encriptada está lista para copiar.');
    console.log('   Úsala en el campo correspondiente de la configuración de audio.\n');
    return;
  }

  // Modo interactivo
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('=== Encriptador de API Keys ===\n');
  console.log('Este script encripta API keys para usar en la configuración de audio.\n');
  console.log('Tipos de credenciales:');
  console.log('  1. ElevenLabs API Key');
  console.log('  2. AWS Access Key ID');
  console.log('  3. AWS Secret Access Key');
  console.log('  4. Otra clave personalizada\n');

  rl.question('Ingresa la API key a encriptar: ', (plainKey) => {
    if (!plainKey || plainKey.trim().length === 0) {
      console.error('Error: La API key no puede estar vacía');
      rl.close();
      process.exit(1);
    }

    try {
      const encryptedKey = encryptApiKey(plainKey.trim());
      
      console.log('\n✅ Clave encriptada exitosamente:\n');
      console.log(encryptedKey);
      console.log('\n📋 Puedes copiar la clave encriptada de arriba.');
      console.log('   Úsala en el campo correspondiente de la configuración de audio.\n');
      
      // Mostrar ejemplo de uso
      console.log('Ejemplo de uso en la configuración:');
      console.log(JSON.stringify({
        audio: {
          tts: 'elevenlabs', // o 'aws-polly'
          enabled: true,
          voiceId: '21m00Tcm4TlvDq8ikWAM',
          elevenlabsApiKeyEncrypted: encryptedKey
        }
      }, null, 2));
      
    } catch (error) {
      console.error('\n❌ Error al encriptar:', error.message);
      process.exit(1);
    }
    
    rl.close();
  });
}

// Ejecutar
main();

