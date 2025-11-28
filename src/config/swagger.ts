import swaggerJsdoc from 'swagger-jsdoc';
import { SwaggerDefinition } from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Agente IA Multitenant API',
      version: '1.0.0',
      description: 'API para agente conversacional SaaS multitenant con LiveKit, orquestación LLM y RAG',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3500',
        description: 'Servidor de desarrollo',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT de autenticación',
        },
        tenantHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'x-tenant-id',
          description: 'ID del tenant (alternativa al token JWT)',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Tipo de error',
            },
            message: {
              type: 'string',
              description: 'Mensaje de error descriptivo',
            },
          },
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'ok',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
            database: {
              type: 'string',
              example: 'connected',
            },
          },
        },
        ChatRequest: {
          type: 'object',
          required: ['text'],
          properties: {
            text: {
              type: 'string',
              description: 'Mensaje del usuario',
              example: 'Hola, ¿cómo estás?',
            },
            conversationId: {
              type: 'string',
              description: 'ID de la conversación (opcional, se genera automáticamente si no se proporciona)',
              example: 'conv_1234567890',
            },
            agentId: {
              type: 'string',
              description: 'ID del agente a usar (default: "default")',
              example: 'default',
            },
            userId: {
              type: 'string',
              description: 'ID del usuario (opcional)',
              example: 'user123',
            },
          },
        },
        ChatResponse: {
          type: 'object',
          properties: {
            response: {
              type: 'string',
              description: 'Respuesta del agente',
            },
            conversationId: {
              type: 'string',
              description: 'ID de la conversación',
            },
            metadata: {
              type: 'object',
              description: 'Metadatos adicionales de la respuesta',
            },
          },
        },
        LiveKitSessionRequest: {
          type: 'object',
          required: ['roomName'],
          properties: {
            roomName: {
              type: 'string',
              description: 'Nombre de la sala de LiveKit',
              example: 'room-123',
            },
            userId: {
              type: 'string',
              description: 'ID del usuario',
              example: 'user123',
            },
            agentId: {
              type: 'string',
              description: 'ID del agente',
              example: 'default',
            },
          },
        },
        LiveKitSessionResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Token de acceso de LiveKit',
            },
            roomName: {
              type: 'string',
              description: 'Nombre de la sala',
            },
            livekitUrl: {
              type: 'string',
              description: 'URL del servidor LiveKit',
            },
          },
        },
        AudioRequest: {
          type: 'object',
          required: ['text'],
          properties: {
            text: {
              type: 'string',
              description: 'Texto a convertir a audio',
              example: 'Hola, este es un mensaje de prueba',
            },
            voiceId: {
              type: 'string',
              description: 'ID de la voz a usar (opcional, usa la configurada por defecto)',
              example: 'Lupe',
            },
            tenantId: {
              type: 'string',
              description: 'ID del tenant',
            },
            agentId: {
              type: 'string',
              description: 'ID del agente',
              example: 'default',
            },
          },
        },
        AudioResponse: {
          type: 'object',
          properties: {
            audio: {
              type: 'string',
              format: 'base64',
              description: 'Audio en formato base64',
            },
            format: {
              type: 'string',
              example: 'mp3',
            },
            sampleRate: {
              type: 'string',
              example: '22050',
            },
          },
        },
        UsageResponse: {
          type: 'object',
          properties: {
            used: {
              type: 'number',
              description: 'Número de conversaciones usadas',
            },
            limit: {
              type: 'number',
              description: 'Límite de conversaciones',
            },
            allowed: {
              type: 'boolean',
              description: 'Si el uso está permitido',
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
      {
        tenantHeader: [],
      },
    ],
  },
  apis: ['./src/**/*.ts'], // Rutas donde buscar anotaciones JSDoc
};

export const swaggerSpec = swaggerJsdoc(options);

