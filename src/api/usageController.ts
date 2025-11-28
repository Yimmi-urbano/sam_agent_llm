import { Request, Response } from 'express';
import { TenantRequest, getTenantId } from '../middleware/tenantMiddleware.js';
import { AgentConfigRepo } from '../db/agentConfigRepo.js';
import { DatabaseManager } from '../db/databaseManager.js';
import { logger } from '../utils/logger.js';

function getAgentConfigRepo(): AgentConfigRepo {
  const dbManager = DatabaseManager.getInstance();
  return new AgentConfigRepo(dbManager);
}

/**
 * @swagger
 * /api/usage/{tenantId}:
 *   get:
 *     summary: Obtener información de uso
 *     description: Obtiene el uso actual y límites de un tenant
 *     tags: [Usage]
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
 *         description: Información de uso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UsageResponse'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * GET /api/usage/:tenantId
 * Obtiene información de uso de un tenant
 */
export async function getUsageHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const agentId = (req.query.agentId as string) || 'default';

    const repo = getAgentConfigRepo();
    const usage = await repo.checkUsageLimit(tenantId, agentId);

    res.json(usage);
  } catch (error) {
    logger.error('Error getting usage', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

