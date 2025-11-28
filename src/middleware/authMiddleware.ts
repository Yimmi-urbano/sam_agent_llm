import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { TenantRequest } from './tenantMiddleware.js';

/**
 * Interfaz extendida para requests con información de usuario autenticado
 */
export interface AuthenticatedRequest extends TenantRequest {
  user?: {
    userId: string;
    tenantId?: string;
    email?: string;
    role?: string;
    [key: string]: any; // Para campos adicionales del token
  };
}

/**
 * Middleware para validar tokens JWT de sesión provenientes de otra API
 * 
 * El token debe estar en:
 * 1. Header Authorization: "Bearer <token>"
 * 2. Header x-session-token: "<token>"
 * 
 * Después de validar, añade la información del usuario a req.user
 */
export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Extraer token de múltiples fuentes
  let token: string | undefined;

  // 1. Intentar desde Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // 2. Intentar desde header personalizado
  if (!token) {
    token = req.headers['x-session-token'] as string;
  }

  // Si no hay token, retornar error
  if (!token) {
    logger.warn('Authentication required but no token provided', {
      path: req.path,
      method: req.method,
    });

    res.status(401).json({
      error: 'Authentication required',
      message: 'No authentication token provided. Include token in Authorization header (Bearer <token>) or x-session-token header.',
    });
    return;
  }

  // Obtener secret desde variables de entorno
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;

  // Validar que existe el secret
  if (!secret) {
    logger.error('JWT_SECRET or SESSION_SECRET not configured');
    res.status(500).json({
      error: 'Server configuration error',
      message: 'JWT secret not configured',
    });
    return;
  }

  try {
    // Verificar y decodificar el token
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;

    // Validar estructura básica del token
    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Invalid token structure');
    }

    // Extraer información del usuario del token
    const user = {
      userId: decoded.userId || decoded.sub || decoded.id,
      tenantId: decoded.tenantId || decoded.tenant_id,
      email: decoded.email,
      role: decoded.role,
      ...decoded, // Incluir cualquier otro campo del token
    };

    // Validar que tiene al menos userId
    if (!user.userId) {
      throw new Error('Token missing required field: userId');
    }

    // Añadir información del usuario a la request
    req.user = user;

    // Si el token tiene tenantId, también añadirlo directamente a req.tenantId
    // (para compatibilidad con tenantMiddleware)
    if (user.tenantId) {
      req.tenantId = user.tenantId;
    }

    // Si el token tiene userId, también añadirlo directamente
    if (user.userId) {
      req.userId = user.userId;
    }

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('Token expired', {
        path: req.path,
        expiredAt: error.expiredAt,
      });

      res.status(401).json({
        error: 'Token expired',
        message: 'The authentication token has expired. Please obtain a new token.',
        expiredAt: error.expiredAt,
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('Invalid token', {
        path: req.path,
        error: error.message,
      });

      res.status(401).json({
        error: 'Invalid token',
        message: 'The authentication token is invalid or malformed.',
      });
      return;
    }

    // Error desconocido
    logger.error('Error verifying token', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      path: req.path,
    });

    res.status(401).json({
      error: 'Authentication failed',
      message: 'Failed to verify authentication token.',
    });
  }
}

/**
 * Helper para obtener el usuario autenticado de la request
 */
export function getAuthenticatedUser(req: AuthenticatedRequest) {
  if (!req.user) {
    throw new Error('User not authenticated. Ensure authMiddleware is applied.');
  }
  return req.user;
}

