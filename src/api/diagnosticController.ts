import { Request, Response } from 'express';
import { TenantRequest, getTenantId } from '../middleware/tenantMiddleware.js';
import { AgentConfigRepo } from '../db/agentConfigRepo.js';
import { DatabaseManager } from '../db/databaseManager.js';
import { logger } from '../utils/logger.js';

/**
 * @swagger
 * /api/diagnostic/{tenantId}:
 *   get:
 *     summary: Diagnóstico de configuración
 *     description: Endpoint de diagnóstico para verificar configuraciones del tenant
 *     tags: [Diagnostic]
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
 *         description: Información de diagnóstico
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tenantId:
 *                   type: string
 *                 requestedAgentId:
 *                   type: string
 *                 found:
 *                   type: boolean
 *                 allAgentIds:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * GET /api/diagnostic/:tenantId
 * Endpoint de diagnóstico para verificar configuraciones
 */
export async function diagnosticHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const agentId = (req.query.agentId as string) || 'default';

    const dbManager = DatabaseManager.getInstance();
    const agentConfigRepo = new AgentConfigRepo(dbManager);

    // Obtener todas las configuraciones del tenant
    const allConfigs = await agentConfigRepo.listByTenant(tenantId);
    
    // Obtener la configuración específica solicitada
    const specificConfig = await agentConfigRepo.getByTenantAndAgent(tenantId, agentId);

    res.json({
      tenantId,
      requestedAgentId: agentId,
      found: !!specificConfig,
      allAgentIds: allConfigs.map(c => ({
        agentId: c.agentId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      specificConfig: specificConfig ? {
        agentId: specificConfig.agentId,
        llm: {
          provider: specificConfig.llm.provider,
          model: specificConfig.llm.model,
        },
        plan: specificConfig.plan,
        createdAt: specificConfig.createdAt,
        updatedAt: specificConfig.updatedAt,
      } : null,
    });
  } catch (error) {
    logger.error('Error in diagnostic handler', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

