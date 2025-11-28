import { Request, Response } from 'express';
import { TenantRequest, getTenantId } from '../middleware/tenantMiddleware.js';
import { AgentConfigRepo, AgentConfig } from '../db/agentConfigRepo.js';
import { DatabaseManager } from '../db/databaseManager.js';
import { encryptApiKey } from '../utils/encryption.js';
import { logger } from '../utils/logger.js';

function getAgentConfigRepo(): AgentConfigRepo {
  const dbManager = DatabaseManager.getInstance();
  return new AgentConfigRepo(dbManager);
}

/**
 * @swagger
 * /api/agent-config/{tenantId}:
 *   get:
 *     summary: Obtener configuración de agente
 *     description: Obtiene la configuración de un agente específico para un tenant
 *     tags: [Agent Config]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del tenant
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *           default: default
 *         description: ID del agente
 *     responses:
 *       200:
 *         description: Configuración del agente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Configuración no encontrada
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
 * GET /api/agent-config/:tenantId
 * Obtiene la configuración de un agente
 */
export async function getAgentConfigHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const agentId = (req.query.agentId as string) || 'default';

    const repo = getAgentConfigRepo();
    const config = await repo.getByTenantAndAgent(tenantId, agentId);

    if (!config) {
      res.status(404).json({
        error: 'Not found',
        message: `Agent config not found for tenant ${tenantId} and agent ${agentId}`,
      });
      return;
    }

    // No exponer API keys encriptadas en la respuesta
    const safeConfig = {
      ...config,
      llm: {
        ...config.llm,
        apiKeyEncrypted: '[REDACTED]',
      },
      knowledge: Object.fromEntries(
        Object.entries(config.knowledge).map(([key, value]) => [
          key,
          value
            ? {
                ...value,
                apiKeyEncrypted: value.apiKeyEncrypted ? '[REDACTED]' : undefined,
              }
            : value,
        ])
      ),
      tools: {
        ...config.tools,
        custom: config.tools.custom?.map((tool) => ({
          ...tool,
          apiKeyEncrypted: tool.apiKeyEncrypted ? '[REDACTED]' : undefined,
        })),
      },
    };

    res.json(safeConfig);
  } catch (error) {
    logger.error('Error getting agent config', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @swagger
 * /api/agent-config:
 *   post:
 *     summary: Crear configuración de agente
 *     description: Crea una nueva configuración de agente para un tenant
 *     tags: [Agent Config]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tenantId
 *               - agentId
 *               - llm
 *             properties:
 *               tenantId:
 *                 type: string
 *               agentId:
 *                 type: string
 *               llm:
 *                 type: object
 *               plan:
 *                 type: object
 *     responses:
 *       201:
 *         description: Configuración creada exitosamente
 *       400:
 *         description: Solicitud inválida
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
 * POST /api/agent-config
 * Crea una nueva configuración de agente
 */
export async function createAgentConfigHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const configData: Omit<AgentConfig, '_id' | 'createdAt' | 'updatedAt'> = req.body;

    // Validar que tenantId coincida
    if (configData.tenantId !== tenantId) {
      res.status(400).json({
        error: 'Invalid tenantId',
        message: 'tenantId in body must match tenantId in request',
      });
      return;
    }

    // Encriptar API keys si vienen en texto plano
    if (configData.llm.apiKeyEncrypted && !configData.llm.apiKeyEncrypted.startsWith('encrypted:')) {
      // Asumir que viene en texto plano, encriptar
      configData.llm.apiKeyEncrypted = encryptApiKey(configData.llm.apiKeyEncrypted);
    }

    // Encriptar API keys en knowledge
    for (const [key, value] of Object.entries(configData.knowledge)) {
      if (value?.apiKeyEncrypted && !value.apiKeyEncrypted.startsWith('encrypted:')) {
        value.apiKeyEncrypted = encryptApiKey(value.apiKeyEncrypted);
      }
    }

    // Encriptar API keys en custom tools
    if (configData.tools.custom) {
      for (const tool of configData.tools.custom) {
        if (tool.apiKeyEncrypted && !tool.apiKeyEncrypted.startsWith('encrypted:')) {
          tool.apiKeyEncrypted = encryptApiKey(tool.apiKeyEncrypted);
        }
      }
    }

    const repo = getAgentConfigRepo();
    const config = await repo.create(configData);

    res.status(201).json({
      ...config,
      llm: { ...config.llm, apiKeyEncrypted: '[REDACTED]' },
    });
  } catch (error) {
    logger.error('Error creating agent config', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @swagger
 * /api/agent-config/{tenantId}:
 *   put:
 *     summary: Actualizar configuración de agente
 *     description: Actualiza una configuración existente de agente
 *     tags: [Agent Config]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del tenant
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *           default: default
 *         description: ID del agente
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Campos a actualizar (parcial)
 *     responses:
 *       200:
 *         description: Configuración actualizada exitosamente
 *       404:
 *         description: Configuración no encontrada
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
 * PUT /api/agent-config/:tenantId
 * Actualiza una configuración existente
 */
export async function updateAgentConfigHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const agentId = (req.query.agentId as string) || 'default';
    const updates: Partial<AgentConfig> = req.body;

    // Encriptar API keys si vienen en texto plano
    if (updates.llm?.apiKeyEncrypted && !updates.llm.apiKeyEncrypted.startsWith('encrypted:')) {
      updates.llm.apiKeyEncrypted = encryptApiKey(updates.llm.apiKeyEncrypted);
    }

    const repo = getAgentConfigRepo();
    const config = await repo.update(tenantId, agentId, updates);

    if (!config) {
      res.status(404).json({
        error: 'Not found',
        message: `Agent config not found for tenant ${tenantId} and agent ${agentId}`,
      });
      return;
    }

    res.json({
      ...config,
      llm: { ...config.llm, apiKeyEncrypted: '[REDACTED]' },
    });
  } catch (error) {
    logger.error('Error updating agent config', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @swagger
 * /api/agent-config/{tenantId}:
 *   delete:
 *     summary: Eliminar configuración de agente
 *     description: Elimina una configuración de agente
 *     tags: [Agent Config]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del tenant
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *           default: default
 *         description: ID del agente
 *     responses:
 *       200:
 *         description: Configuración eliminada exitosamente
 *       404:
 *         description: Configuración no encontrada
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
 * DELETE /api/agent-config/:tenantId
 * Elimina una configuración
 */
export async function deleteAgentConfigHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const agentId = (req.query.agentId as string) || 'default';

    const repo = getAgentConfigRepo();
    const deleted = await repo.delete(tenantId, agentId);

    if (!deleted) {
      res.status(404).json({
        error: 'Not found',
        message: `Agent config not found for tenant ${tenantId} and agent ${agentId}`,
      });
      return;
    }

    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting agent config', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @swagger
 * /api/agent-config/{tenantId}/list:
 *   get:
 *     summary: Listar configuraciones de agente
 *     description: Obtiene todas las configuraciones de agentes para un tenant
 *     tags: [Agent Config]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del tenant
 *     responses:
 *       200:
 *         description: Lista de configuraciones
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * GET /api/agent-config/:tenantId/list
 * Lista todas las configuraciones de un tenant
 */
export async function listAgentConfigsHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);

    const repo = getAgentConfigRepo();
    const configs = await repo.listByTenant(tenantId);

    // Redactar API keys
    const safeConfigs = configs.map((config) => ({
      ...config,
      llm: { ...config.llm, apiKeyEncrypted: '[REDACTED]' },
    }));

    res.json(safeConfigs);
  } catch (error) {
    logger.error('Error listing agent configs', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

