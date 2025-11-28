import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export interface TenantRequest extends Request {
  tenantId?: string;
  userId?: string;
}

/**
 * Middleware para extraer y validar tenantId
 * Soporta múltiples fuentes: JWT, header x-tenant-id, query param
 */
export function tenantMiddleware(
  req: TenantRequest,
  res: Response,
  next: NextFunction
): void {
  // 1. Intentar desde JWT (si está disponible)
  const jwtTenantId = (req as any).user?.tenantId;
  
  // 2. Intentar desde header
  const headerTenantId = req.headers['x-tenant-id'] as string;
  
  // 3. Intentar desde query param (útil para desarrollo)
  const queryTenantId = req.query.tenantId as string;

  const tenantId = jwtTenantId || headerTenantId || queryTenantId;

  if (!tenantId) {
    logger.warn('Request without tenantId', {
      path: req.path,
      method: req.method,
      headers: req.headers,
    });
    res.status(400).json({
      error: 'Missing tenantId',
      message: 'tenantId is required. Provide it via JWT, x-tenant-id header, or tenantId query param',
    });
    return;
  }

  // Validar formato básico (ajustar según tus necesidades)
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    res.status(400).json({
      error: 'Invalid tenantId',
      message: 'tenantId must be a non-empty string',
    });
    return;
  }

  req.tenantId = tenantId.trim();

  // Extraer userId si está disponible
  const userId = (req as any).user?.userId || req.headers['x-user-id'] as string || req.query.userId as string;
  if (userId) {
    req.userId = userId;
  }

  next();
}

/**
 * Middleware para validar que tenantId existe en la request
 * Usar después de tenantMiddleware
 */
export function requireTenant(
  req: TenantRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.tenantId) {
    res.status(400).json({
      error: 'Tenant context required',
      message: 'This endpoint requires tenantId. Ensure tenantMiddleware is applied.',
    });
    return;
  }
  next();
}

/**
 * Helper para obtener tenantId de la request
 */
export function getTenantId(req: TenantRequest): string {
  if (!req.tenantId) {
    throw new Error('tenantId not found in request. Ensure tenantMiddleware is applied.');
  }
  return req.tenantId;
}

/**
 * Helper para obtener userId de la request
 */
export function getUserId(req: TenantRequest): string | undefined {
  return req.userId;
}

