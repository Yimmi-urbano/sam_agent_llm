import { Request, Response, NextFunction } from 'express';
import { TenantRequest } from './tenantMiddleware.js';
import { AgentConfigRepo } from '../db/agentConfigRepo.js';
import { DatabaseManager } from '../db/databaseManager.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware para verificar límites de uso mensual
 * Debe usarse después de tenantMiddleware
 */
export function usageMiddleware(agentConfigRepo: AgentConfigRepo) {
  return async (
    req: TenantRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const tenantId = req.tenantId;
    // Obtener agentId del body, query o usar 'default'
    const agentId = (req.body?.agentId as string) || (req.query.agentId as string) || 'default';

    if (!tenantId) {
      res.status(400).json({
        error: 'Tenant context required',
      });
      return;
    }

    try {
      // Verificar si existe la configuración
      const config = await agentConfigRepo.getByTenantAndAgent(tenantId, agentId);
      
      if (!config) {
        logger.warn('Agent config not found, skipping usage check', {
          tenantId,
          agentId,
        });
        
        // Si no hay configuración, permitir continuar (útil para desarrollo)
        // En producción, puedes cambiar esto para retornar un error 404
        if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_AGENT_CONFIG === 'true') {
          res.status(404).json({
            error: 'Agent config not found',
            message: `No agent configuration found for tenant ${tenantId} and agent ${agentId}. Please create an agent config first.`,
            tenantId,
            agentId,
          });
          return;
        }
        
        // En desarrollo, continuar sin verificación de uso
        next();
        return;
      }

      const usageCheck = await agentConfigRepo.checkUsageLimit(tenantId, agentId);

      if (!usageCheck.allowed) {
        logger.warn('Usage limit exceeded', {
          tenantId,
          agentId,
          used: usageCheck.used,
          limit: usageCheck.limit,
        });

        res.status(429).json({
          error: 'Usage limit exceeded',
          message: `Monthly limit of ${usageCheck.limit} conversations reached. Used: ${usageCheck.used}`,
          used: usageCheck.used,
          limit: usageCheck.limit,
          renewsAt: config.plan.renewsAt,
        });
        return;
      }

      // Añadir información de uso a la request para logging
      (req as any).usageInfo = usageCheck;

      next();
    } catch (error) {
      logger.error('Error checking usage limit', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        tenantId,
        agentId,
      });
      
      // Si el error es que no se encontró la configuración, retornar 404
      if (error instanceof Error && error.message.includes('Agent config not found')) {
        res.status(404).json({
          error: 'Agent config not found',
          message: error.message,
          tenantId,
          agentId,
        });
        return;
      }
      
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to check usage limits',
      });
    }
  };
}

/**
 * Middleware para incrementar contador de uso después de una conversación exitosa
 * Debe llamarse después de procesar la conversación
 */
export async function incrementUsage(
  agentConfigRepo: AgentConfigRepo,
  tenantId: string,
  agentId: string = 'default',
  amount: number = 1
): Promise<void> {
  try {
    await agentConfigRepo.incrementUsage(tenantId, agentId, amount);
  } catch (error) {
    logger.error('Error incrementing usage', error);
    // No lanzar error para no interrumpir el flujo principal
  }
}

