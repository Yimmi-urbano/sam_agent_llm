import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { logger } from './utils/logger.js';
import { tenantMiddleware } from './middleware/tenantMiddleware.js';
import { usageMiddleware } from './middleware/usageMiddleware.js';
import { authMiddleware } from './middleware/authMiddleware.js';
import { AgentConfigRepo } from './db/agentConfigRepo.js';
import { DatabaseManager } from './db/databaseManager.js';

// Importar controllers
import { chatHandler } from './api/chatController.js';
import {
  getAgentConfigHandler,
  createAgentConfigHandler,
  updateAgentConfigHandler,
  deleteAgentConfigHandler,
  listAgentConfigsHandler,
} from './api/agentConfigController.js';
import { getUsageHandler } from './api/usageController.js';
import { createSessionHandler } from './api/livekitController.js';
import { 
  generateAudioHandler, 
  generateAudioFromDescriptionHandler 
} from './api/audioController.js';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT;

// Middleware global
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Agente IA API Documentation',
}));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check del servidor
 *     description: Verifica el estado del servidor y la conexión a la base de datos
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Servidor funcionando correctamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Health check (sin tenant)
app.get('/health', async (req, res) => {
  try {
    const dbManager = DatabaseManager.getInstance();
    const dbHealthy = await dbManager.healthCheck();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbHealthy ? 'connected' : 'disconnected',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Inicializar base de datos
async function initializeDatabase() {
  try {
    const dbManager = DatabaseManager.getInstance({
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
      dbName: process.env.MONGODB_DB_NAME || 'agente_multitenant',
    });

    await dbManager.connect();

    // Crear índices
    const agentConfigRepo = new AgentConfigRepo(dbManager);
    await agentConfigRepo.createIndexes();

    logger.info('Database initialized');
  } catch (error) {
    logger.error('Failed to initialize database', error);
    process.exit(1);
  }
}

// Rutas de API

// LiveKit session (sin usage middleware, solo tenant)
app.post('/livekit/session', tenantMiddleware, createSessionHandler);

// Chat endpoint (con autenticación Bearer, tenant y usage check)
app.post(
  '/api/chat',
  authMiddleware,
  tenantMiddleware,
  async (req, res, next) => {
    const dbManager = DatabaseManager.getInstance();
    const agentConfigRepo = new AgentConfigRepo(dbManager);
    return usageMiddleware(agentConfigRepo)(req, res, next);
  },
  chatHandler
);

// Agent Config endpoints
app.get('/api/agent-config/:tenantId', tenantMiddleware, getAgentConfigHandler);
app.get('/api/agent-config/:tenantId/list', tenantMiddleware, listAgentConfigsHandler);
app.post('/api/agent-config', tenantMiddleware, createAgentConfigHandler);
app.put('/api/agent-config/:tenantId', tenantMiddleware, updateAgentConfigHandler);
app.delete('/api/agent-config/:tenantId', tenantMiddleware, deleteAgentConfigHandler);

// Usage endpoint
app.get('/api/usage/:tenantId', tenantMiddleware, getUsageHandler);

// Audio endpoints (sin usage middleware, solo tenant)
app.post('/api/audio', tenantMiddleware, generateAudioHandler);
app.post('/api/audio/from-description', tenantMiddleware, generateAudioFromDescriptionHandler);
app.get('/api/audio', tenantMiddleware, generateAudioHandler); // También soporta GET para flexibilidad

// Diagnostic endpoint (útil para debugging)
import { diagnosticHandler } from './api/diagnosticController.js';
app.get('/api/diagnostic/:tenantId', tenantMiddleware, diagnosticHandler);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
  });
});

// Iniciar servidor
async function start() {
  await initializeDatabase();

  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});

