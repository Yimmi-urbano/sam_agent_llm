# Scripts de Encriptación

Scripts para encriptar credenciales de audio (AWS Polly y ElevenLabs) antes de guardarlas en la base de datos.

## Uso Rápido

### Windows

```bash
# Modo interactivo (te pedirá la clave)
scripts\encrypt-audio-credentials.bat

# O pasar la clave directamente
scripts\encrypt-audio-credentials.bat "tu-api-key-aqui"
```

### Linux/Mac

```bash
# Dar permisos de ejecución (solo la primera vez)
chmod +x scripts/encrypt-audio-credentials.sh

# Modo interactivo
./scripts/encrypt-audio-credentials.sh

# O pasar la clave directamente
./scripts/encrypt-audio-credentials.sh "tu-api-key-aqui"
```

### Directamente con Node.js

```bash
# Modo interactivo
node scripts/encrypt-key.js

# O pasar la clave como argumento
node scripts/encrypt-key.js "tu-api-key-aqui"

# Para copiar al portapapeles (Windows)
node scripts/encrypt-key.js "tu-api-key-aqui" | clip

# Para copiar al portapapeles (Linux/Mac)
node scripts/encrypt-key.js "tu-api-key-aqui" | xclip -selection clipboard
```

## Ejemplos

### Encriptar API Key de ElevenLabs

```bash
node scripts/encrypt-key.js "sk-1234567890abcdef"
```

**Salida:**
```
a1b2c3d4e5f6...:f1e2d3c4b5a6...:9876543210fedcba...
```

### Encriptar credenciales de AWS Polly

```bash
# Access Key ID
node scripts/encrypt-key.js "AKIAIOSFODNN7EXAMPLE"

# Secret Access Key
node scripts/encrypt-key.js "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
```

## Uso en la Configuración

Una vez que tengas la clave encriptada, úsala en la configuración del agente:

```json
{
  "audio": {
    "tts": "elevenlabs",
    "enabled": true,
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "elevenlabsApiKeyEncrypted": "a1b2c3d4e5f6...:f1e2d3c4b5a6...:9876543210fedcba..."
  }
}
```

O para AWS Polly:

```json
{
  "audio": {
    "tts": "aws-polly",
    "enabled": true,
    "voiceId": "Lupe",
    "awsAccessKeyIdEncrypted": "a1b2c3d4e5f6...:f1e2d3c4b5a6...:9876543210fedcba...",
    "awsSecretAccessKeyEncrypted": "a1b2c3d4e5f6...:f1e2d3c4b5a6...:9876543210fedcba...",
    "awsRegion": "us-east-1"
  }
}
```

## Notas

- El script usa la misma función de encriptación que el sistema principal
- Asegúrate de tener configurada la variable de entorno `ENCRYPTION_KEY` si usas una clave personalizada
- Las claves encriptadas tienen el formato: `iv:authTag:encryptedData`
- **Nunca** compartas las claves encriptadas públicamente

