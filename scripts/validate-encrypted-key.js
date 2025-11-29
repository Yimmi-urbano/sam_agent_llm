#!/usr/bin/env node
/**
 * Script para validar el formato de claves encriptadas
 * 
 * Uso:
 *   node scripts/validate-encrypted-key.js "clave-encriptada"
 */

function validateEncryptedKeyFormat(encrypted) {
  const errors = [];
  const warnings = [];
  const info = [];

  // Validar que no esté vacío
  if (!encrypted || typeof encrypted !== 'string' || encrypted.trim().length === 0) {
    errors.push('La clave encriptada está vacía o es inválida');
    return { valid: false, errors, warnings, info };
  }

  // Validar formato: debe tener 3 partes separadas por ':'
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    errors.push(`Formato inválido: se esperaban 3 partes separadas por ':', se encontraron ${parts.length}`);
    return { valid: false, errors, warnings, info };
  }

  const [ivHex, authTagHex, encryptedData] = parts;

  // Validar que cada parte tenga contenido
  if (!ivHex || !authTagHex || !encryptedData) {
    errors.push('Formato inválido: una o más partes están vacías');
    return { valid: false, errors, warnings, info };
  }

  // Validar que sean hexadecimales válidos
  const hexPattern = /^[0-9a-f]+$/i;
  if (!hexPattern.test(ivHex)) {
    errors.push(`IV inválido: debe ser una cadena hexadecimal válida. Valor: ${ivHex.substring(0, 20)}...`);
  }
  if (!hexPattern.test(authTagHex)) {
    errors.push(`AuthTag inválido: debe ser una cadena hexadecimal válida. Valor: ${authTagHex.substring(0, 20)}...`);
  }
  if (!hexPattern.test(encryptedData)) {
    errors.push(`Datos encriptados inválidos: debe ser una cadena hexadecimal válida. Valor: ${encryptedData.substring(0, 20)}...`);
  }

  // Validar longitudes
  const ivLength = ivHex.length;
  const authTagLength = authTagHex.length;
  const encryptedDataLength = encryptedData.length;

  info.push(`IV: ${ivLength} caracteres (${ivLength / 2} bytes)`);
  info.push(`AuthTag: ${authTagLength} caracteres (${authTagLength / 2} bytes)`);
  info.push(`Datos encriptados: ${encryptedDataLength} caracteres (${encryptedDataLength / 2} bytes)`);

  // Validar que IV tenga 32 caracteres (16 bytes)
  if (ivLength !== 32) {
    errors.push(`IV debe tener 32 caracteres (16 bytes), tiene ${ivLength}`);
  }

  // Validar que AuthTag tenga 32 caracteres (16 bytes)
  if (authTagLength !== 32) {
    errors.push(`AuthTag debe tener 32 caracteres (16 bytes), tiene ${authTagLength}`);
  }

  // Validar que los datos encriptados tengan al menos algunos caracteres
  if (encryptedDataLength < 2) {
    errors.push('Los datos encriptados están vacíos o son demasiado cortos');
  }

  // Advertencias
  if (encryptedDataLength < 10) {
    warnings.push('Los datos encriptados son muy cortos, puede que la clave original sea muy pequeña');
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    info,
    parts: {
      iv: ivHex,
      authTag: authTagHex,
      encryptedData: encryptedData
    }
  };
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Error: Debes proporcionar la clave encriptada');
    console.log('\nUso:');
    console.log('  node scripts/validate-encrypted-key.js "clave-encriptada"');
    console.log('\nEjemplo:');
    console.log('  node scripts/validate-encrypted-key.js "0e074dba298421bc4b0d8592006bef97:dda2dea7a8c12b982ad55935449e0b2c:836c9ebdde6186db6efb8af9dbeef8a3fd2600743bef63bd97e4b866b610275755ea0437f535c5"');
    process.exit(1);
  }

  const encryptedKey = args[0].trim();

  console.log('🔍 Validando formato de clave encriptada...\n');
  console.log(`📋 Clave: ${encryptedKey.substring(0, 60)}...\n`);

  const validation = validateEncryptedKeyFormat(encryptedKey);

  if (validation.valid) {
    console.log('✅ Formato válido\n');
  } else {
    console.log('❌ Formato inválido\n');
  }

  if (validation.info.length > 0) {
    console.log('📊 Información:');
    validation.info.forEach(msg => console.log(`   • ${msg}`));
    console.log();
  }

  if (validation.warnings.length > 0) {
    console.log('⚠️  Advertencias:');
    validation.warnings.forEach(msg => console.log(`   • ${msg}`));
    console.log();
  }

  if (validation.errors.length > 0) {
    console.log('❌ Errores:');
    validation.errors.forEach(msg => console.log(`   • ${msg}`));
    console.log();
  }

  if (validation.valid) {
    console.log('✅ La clave tiene un formato válido para AES-256-GCM');
    console.log('   Nota: Esto no garantiza que pueda ser desencriptada.');
    console.log('   La desencriptación depende de tener la ENCRYPTION_KEY correcta.\n');
    process.exit(0);
  } else {
    console.log('❌ La clave tiene un formato inválido y no puede ser desencriptada.\n');
    process.exit(1);
  }
}

main();

