# Documentación Swagger/OpenAPI

Este proyecto usa Swagger para documentar la API de forma interactiva.

## 📋 Instalación

Las dependencias ya están incluidas en `package.json`:

```bash
npm install
```

Dependencias instaladas:
- `swagger-jsdoc` - Genera la especificación OpenAPI desde comentarios JSDoc
- `swagger-ui-express` - Interfaz web interactiva para la documentación

## 🚀 Acceso a la Documentación

Una vez que el servidor esté corriendo, accede a la documentación en:

```
http://localhost:3500/api-docs
```

## 📝 Cómo Funciona

### 1. Configuración

La configuración de Swagger está en `src/config/swagger.ts`:
- Define la información básica de la API
- Configura los esquemas de seguridad (Bearer Token, Tenant Header)
- Define los schemas reutilizables

### 2. Documentación de Endpoints

Los endpoints se documentan usando comentarios JSDoc con anotaciones `@swagger`:

```typescript
/**
 * @swagger
 * /api/endpoint:
 *   get:
 *     summary: Descripción breve
 *     description: Descripción detallada
 *     tags: [TagName]
 *     responses:
 *       200:
 *         description: Respuesta exitosa
 */
export async function handler(req, res) {
  // ...
}
```

### 3. Schemas

Los schemas se definen en `src/config/swagger.ts` en la sección `components.schemas`:

```typescript
components: {
  schemas: {
    ChatRequest: {
      type: 'object',
      properties: {
        text: { type: 'string' }
      }
    }
  }
}
```

## 🔐 Autenticación

La documentación incluye dos métodos de autenticación:

1. **Bearer Token (JWT)**: `Authorization: Bearer <token>`
2. **Tenant Header**: `x-tenant-id: <tenantId>`

Puedes probar la autenticación directamente desde Swagger UI usando el botón "Authorize".

## 📚 Endpoints Documentados

- **Health**: `/health` - Health check
- **Chat**: `/api/chat` - Enviar mensajes al agente
- **LiveKit**: `/livekit/session` - Crear sesión de LiveKit
- **Audio**: 
  - `/api/audio` - Generar audio desde texto
  - `/api/audio/from-description` - Generar audio desde descripción
- **Agent Config**: CRUD de configuraciones de agentes
- **Usage**: `/api/usage/:tenantId` - Información de uso
- **Diagnostic**: `/api/diagnostic/:tenantId` - Diagnóstico

## 🛠️ Personalización

### Cambiar la URL del servidor

Edita `src/config/swagger.ts`:

```typescript
servers: [
  {
    url: process.env.API_URL || 'http://localhost:3500',
    description: 'Servidor de desarrollo',
  },
]
```

### Agregar más schemas

Añade nuevos schemas en `components.schemas`:

```typescript
components: {
  schemas: {
    NuevoSchema: {
      type: 'object',
      properties: {
        campo: { type: 'string' }
      }
    }
  }
}
```

### Documentar un nuevo endpoint

Agrega comentarios `@swagger` antes de la función handler:

```typescript
/**
 * @swagger
 * /api/nuevo-endpoint:
 *   post:
 *     summary: Nuevo endpoint
 *     tags: [NuevoTag]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Éxito
 */
export async function nuevoHandler(req, res) {
  // ...
}
```

## 📖 Recursos

- [Swagger/OpenAPI Specification](https://swagger.io/specification/)
- [swagger-jsdoc Documentation](https://github.com/Surnet/swagger-jsdoc)
- [swagger-ui-express Documentation](https://github.com/scottie1984/swagger-ui-express)

