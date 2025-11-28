import { Request, Response } from 'express';
import { TenantRequest, getTenantId, getUserId } from '../middleware/tenantMiddleware.js';
import { AgentOrchestrator, OrchestratorContext } from '../agent/orchestrator.js';
import { DatabaseManager } from '../db/databaseManager.js';
import { AgentConfigRepo } from '../db/agentConfigRepo.js';
import { ConversationsRepo } from '../db/conversationsRepo.js';
import { LLMRouter } from '../agent/llmRouter.js';
import { ToolRegistry } from '../agent/toolRegistry.js';
import { ProductsRepo } from '../db/productsRepo.js';
import { OrdersRepo } from '../db/ordersRepo.js';
import { RAGService } from '../services/ragService.js';
import { ExternalApiService } from '../services/externalApiService.js';
import { incrementUsage } from '../middleware/usageMiddleware.js';
import { logger } from '../utils/logger.js';

// Instancias singleton (en producción, usar inyección de dependencias)
let orchestrator: AgentOrchestrator | null = null;

async function getOrchestrator(): Promise<AgentOrchestrator> {
  if (orchestrator) {
    return orchestrator;
  }

  const dbManager = DatabaseManager.getInstance({
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    dbName: process.env.MONGODB_DB_NAME || 'agente_multitenant',
  });

  await dbManager.connect();

  const agentConfigRepo = new AgentConfigRepo(dbManager);
  const conversationsRepo = new ConversationsRepo(dbManager);
  const productsRepo = new ProductsRepo(dbManager);
  const ordersRepo = new OrdersRepo(dbManager);
  const ragService = new RAGService();
  const externalApiService = new ExternalApiService();
  const llmRouter = new LLMRouter();
  const toolRegistry = new ToolRegistry(
    productsRepo,
    ordersRepo,
    ragService,
    externalApiService
  );

  orchestrator = new AgentOrchestrator(
    agentConfigRepo,
    conversationsRepo,
    llmRouter,
    toolRegistry
  );

  return orchestrator;
}

/**
 * @swagger
 * /api/chat:
 *   post:
 *     summary: Enviar mensaje al agente
 *     description: Procesa un mensaje de texto y retorna la respuesta del agente IA
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: Respuesta exitosa del agente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *       400:
 *         description: Solicitud inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Límite de uso excedido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * POST /api/chat
 * Endpoint principal para chat (texto)
 */
export async function chatHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req) || req.body.userId || 'anonymous';
    const { text, conversationId, agentId } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'text field is required and must be a string',
      });
      return;
    }

    const orchestratorInstance = await getOrchestrator();
    const finalAgentId = agentId || 'default';
    const context: OrchestratorContext = {
      tenantId,
      userId,
      conversationId: conversationId || `conv_${Date.now()}`,
      agentId: finalAgentId,
    };

    const response = await orchestratorInstance.processMessage(context, text);

    // Asegurar que conversationId esté en la respuesta
    if (!response.conversationId) {
      response.conversationId = context.conversationId;
    }

    // Incrementar uso (solo si existe la configuración)
    try {
      const agentConfigRepo = new AgentConfigRepo(
        DatabaseManager.getInstance()
      );
      await incrementUsage(agentConfigRepo, tenantId, finalAgentId, 1);
    } catch (error) {
      // Si no existe la configuración, no incrementar uso
    }

    res.json(response);
  } catch (error) {
    logger.error('Error in chat handler', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

