# Guía de Despliegue en Plesk

Esta guía te ayudará a desplegar el proyecto `agente-ia-multitenant` en un servidor con Plesk.

## 📋 Prerrequisitos

- Acceso a Plesk con permisos de administrador
- Node.js instalado en el servidor (versión 20 o superior)
- MongoDB accesible (local o remoto)
- Credenciales de MongoDB, APIs externas, etc.

## 🚀 Pasos de Despliegue

### 1. Preparar el Proyecto Localmente

#### 1.1. Compilar TypeScript

```bash
npm run build
```

Esto generará la carpeta `dist/` con el código JavaScript compilado.

#### 1.2. Crear archivo `.env` para producción

Crea un archivo `.env` con las variables de entorno necesarias:

```env
# Puerto del servidor
PORT=3500

# MongoDB
MONGODB_URI=mongodb://usuario:password@host:puerto
MONGODB_DB_NAME=agente_multitenant

# JWT/Session
JWT_SECRET=tu-secret-jwt-muy-seguro
SESSION_SECRET=tu-session-secret-muy-seguro

# LiveKit (si usas)
LIVEKIT_URL=wss://tu-livekit-server.com
LIVEKIT_API_KEY=tu-api-key
LIVEKIT_API_SECRET=tu-api-secret

# APIs de LLM (según configuración)
OPENAI_API_KEY=tu-openai-key
GOOGLE_API_KEY=tu-google-key
GROQ_API_KEY=tu-groq-key

# Entorno
NODE_ENV=production
LOG_LEVEL=info
```

### 2. Subir Archivos a Plesk

#### Opción A: Usando Git (Recomendado)

1. **En Plesk, ve a "Git"** en el dominio
2. **Habilita Git** si no está habilitado
3. **Configura el repositorio:**
   - URL del repositorio: `https://github.com/tu-usuario/agente_live_sam.git`
   - Branch: `main` o `master`
   - Deploy path: `httpdocs` o `subdirectorio`

4. **Después de clonar, ejecuta en SSH:**
   ```bash
   cd httpdocs
   npm install --production
   npm run build
   ```

#### Opción B: Usando FTP/SFTP

1. **Conecta por FTP/SFTP** al servidor
2. **Sube los siguientes archivos y carpetas:**
   - `package.json`
   - `package-lock.json`
   - `tsconfig.json`
   - Carpeta `src/`
   - Carpeta `dist/` (si ya compilaste localmente)
   - Archivo `.env` (crear en el servidor, no subir por seguridad)

3. **NO subas:**
   - `node_modules/`
   - `.git/`
   - Archivos de desarrollo

### 3. Configurar Node.js en Plesk

1. **Ve a "Node.js" en Plesk**
2. **Habilita Node.js** si no está habilitado
3. **Configura la aplicación:**
   - **Node.js version:** 20.x o superior
   - **Application mode:** production
   - **Application root:** `httpdocs` (o el directorio donde subiste los archivos)
   - **Application startup file:** `dist/index.js`
   - **Application URL:** `/` o el path que desees

4. **Variables de entorno:**
   - En la sección "Environment variables", agrega todas las variables del archivo `.env`
   - O crea el archivo `.env` en el directorio raíz de la aplicación

### 4. Instalar Dependencias

#### Opción A: Desde Plesk (Node.js)

Plesk puede instalar automáticamente las dependencias. Si no:

#### Opción B: Desde SSH

```bash
# Conecta por SSH al servidor
ssh usuario@tu-servidor.com

# Navega al directorio de la aplicación
cd /var/www/vhosts/tu-dominio.com/httpdocs

# Instala dependencias de producción
npm install --production

# Si no compilaste localmente, compila ahora
npm run build
```

### 5. Configurar el Servidor Web

#### 5.1. Configurar Proxy Reverso (Recomendado)

En Plesk, ve a "Apache & nginx Settings" y agrega en "Additional nginx directives":

```nginx
location / {
    proxy_pass http://localhost:3500;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}
```

#### 5.2. O Configurar Puerto Directo

Si prefieres acceder directamente al puerto:

1. En "Node.js" de Plesk, configura el puerto (ej: 3500)
2. Asegúrate de que el firewall permita ese puerto
3. Accede a: `https://tu-dominio.com:3500`

### 6. Configurar SSL/HTTPS

1. **Ve a "SSL/TLS Certificates"** en Plesk
2. **Instala un certificado SSL** (Let's Encrypt es gratuito)
3. **Habilita "Force HTTPS"** si usas proxy reverso

### 7. Iniciar la Aplicación

#### Desde Plesk:

1. Ve a "Node.js"
2. Haz clic en "Restart App" o "Start App"

#### Desde SSH:

```bash
# Si usas PM2 (recomendado para producción)
npm install -g pm2
pm2 start dist/index.js --name agente-ia
pm2 save
pm2 startup
```

### 8. Verificar el Despliegue

1. **Health Check:**
   ```bash
   curl https://tu-dominio.com/health
   ```

2. **Swagger Documentation:**
   ```
   https://tu-dominio.com/api-docs
   ```

3. **Probar endpoint de chat:**
   ```bash
   curl -X POST https://tu-dominio.com/api/chat \
     -H "Authorization: Bearer tu-token" \
     -H "Content-Type: application/json" \
     -d '{"text": "Hola"}'
   ```

## 🔧 Configuración Adicional

### MongoDB

Asegúrate de que MongoDB esté accesible desde el servidor:

- Si MongoDB está en otro servidor, configura el firewall
- Si MongoDB está en el mismo servidor, usa `localhost` o `127.0.0.1`
- Verifica las credenciales y permisos

### LiveKit Agent Worker

Si necesitas ejecutar el LiveKit Agent Worker como proceso separado:

```bash
# En SSH, crea un script de inicio
pm2 start npm --name "agente-worker" -- run start:agent
pm2 save
```

### Logs

Los logs se guardan en:
- **Plesk:** Ve a "Logs" en el dominio
- **PM2:** `pm2 logs agente-ia`
- **Winston:** `logs/error.log` y `logs/combined.log` (si configuraste archivos)

### Monitoreo

1. **PM2 Monitoring:**
   ```bash
   pm2 monit
   ```

2. **Health Check Endpoint:**
   - Configura un monitor que llame a `/health` periódicamente

## 🐛 Solución de Problemas

### La aplicación no inicia

1. **Verifica los logs:**
   ```bash
   pm2 logs agente-ia
   # o
   tail -f /var/www/vhosts/tu-dominio.com/logs/error_log
   ```

2. **Verifica Node.js version:**
   ```bash
   node --version  # Debe ser 20.x o superior
   ```

3. **Verifica que el build se completó:**
   ```bash
   ls -la dist/index.js  # Debe existir
   ```

4. **Verifica variables de entorno:**
   ```bash
   # En Plesk Node.js, verifica que todas las variables estén configuradas
   ```

### Error de conexión a MongoDB

1. Verifica que MongoDB esté corriendo
2. Verifica las credenciales en `.env`
3. Verifica que el firewall permita la conexión
4. Prueba la conexión manualmente:
   ```bash
   mongosh "mongodb://usuario:password@host:puerto"
   ```

### Puerto ya en uso

Si el puerto 3500 está ocupado:

1. Cambia el puerto en `.env`: `PORT=3501`
2. Actualiza la configuración de proxy reverso en Plesk
3. Reinicia la aplicación

### Permisos de archivos

```bash
# Asegúrate de que el usuario de Node.js tenga permisos
chown -R usuario:usuario /var/www/vhosts/tu-dominio.com/httpdocs
chmod -R 755 /var/www/vhosts/tu-dominio.com/httpdocs
```

## 📝 Checklist de Despliegue

- [ ] Proyecto compilado (`npm run build`)
- [ ] Archivos subidos al servidor
- [ ] Node.js configurado en Plesk
- [ ] Variables de entorno configuradas
- [ ] Dependencias instaladas (`npm install --production`)
- [ ] MongoDB accesible y configurado
- [ ] Proxy reverso configurado (si aplica)
- [ ] SSL/HTTPS configurado
- [ ] Aplicación iniciada
- [ ] Health check funcionando
- [ ] Logs configurados
- [ ] Monitoreo configurado

## 🔄 Actualizaciones Futuras

Para actualizar la aplicación:

1. **Si usas Git:**
   ```bash
   cd httpdocs
   git pull
   npm install --production
   npm run build
   pm2 restart agente-ia
   ```

2. **Si usas FTP:**
   - Sube los archivos nuevos
   - En SSH:
     ```bash
     cd httpdocs
     npm install --production
     npm run build
     pm2 restart agente-ia
     ```

## 📚 Recursos Adicionales

- [Documentación de Plesk Node.js](https://docs.plesk.com/en-US/obsidian/administrator-guide/website-management/nodejs-support.77909/)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [MongoDB Connection String](https://www.mongodb.com/docs/manual/reference/connection-string/)

