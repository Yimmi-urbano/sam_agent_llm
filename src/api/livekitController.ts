import { Request, Response } from 'express';
import { TenantRequest, getTenantId, getUserId } from '../middleware/tenantMiddleware.js';
import { LiveKitClient } from '../livekit/livekitClient.js';
import { logger } from '../utils/logger.js';

let livekitClient: LiveKitClient | null = null;

function getLiveKitClient(): LiveKitClient {
  if (!livekitClient) {
    const apiKey = process.env.LIVEKIT_API_KEY || '';
    const apiSecret = process.env.LIVEKIT_API_SECRET || '';
    
    if (!apiKey || apiKey.trim().length === 0) {
      logger.error('LIVEKIT_API_KEY is not configured');
      throw new Error('LiveKit API key is not configured. Please set LIVEKIT_API_KEY environment variable.');
    }
    
    if (!apiSecret || apiSecret.trim().length === 0) {
      logger.error('LIVEKIT_API_SECRET is not configured');
      throw new Error('LiveKit API secret is not configured. Please set LIVEKIT_API_SECRET environment variable.');
    }
    
    livekitClient = new LiveKitClient(
      process.env.LIVEKIT_URL || 'ws://localhost:7880',
      apiKey,
      apiSecret
    );
  }
  return livekitClient;
}

/**
 * @swagger
 * /livekit/session:
 *   post:
 *     summary: Crear sesión de LiveKit
 *     description: Genera un token de acceso para conectarse a una sala de LiveKit
 *     tags: [LiveKit]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LiveKitSessionRequest'
 *     responses:
 *       200:
 *         description: Token generado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LiveKitSessionResponse'
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
 * POST /livekit/session
 * Genera un token de acceso para LiveKit
 */
export async function createSessionHandler(
  req: TenantRequest,
  res: Response
): Promise<void> {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req) || req.body.userId || 'anonymous';
    const { roomName, agentId } = req.body;

    if (!roomName) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'roomName is required',
      });
      return;
    }

    const client = getLiveKitClient();
    const token = await client.generateAccessToken(roomName, userId, {
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      metadata: JSON.stringify({
        tenantId,
        userId,
        agentId: agentId || 'default',
      }),
    });

    // Validar que el token sea un string
    if (typeof token !== 'string') {
      logger.error('Generated token is not a string', { token, type: typeof token });
      throw new Error('Failed to generate valid token');
    }

    // Asegurar que la URL sea correcta (ws:// o https://)
    let livekitUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
    
    // Si la URL no tiene protocolo, añadir ws://
    if (!livekitUrl.startsWith('ws://') && !livekitUrl.startsWith('wss://') && !livekitUrl.startsWith('http://') && !livekitUrl.startsWith('https://')) {
      livekitUrl = `ws://${livekitUrl}`;
    }
    
    // Convertir http:// a ws:// para WebSocket
    if (livekitUrl.startsWith('http://')) {
      livekitUrl = livekitUrl.replace('http://', 'ws://');
    }
    if (livekitUrl.startsWith('https://')) {
      livekitUrl = livekitUrl.replace('https://', 'wss://');
    }

    res.json({
      token: String(token), // Asegurar que sea string
      roomName,
      livekitUrl: String(livekitUrl), // Asegurar que sea string
    });
  } catch (error) {
    logger.error('Error creating LiveKit session', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      hasApiKey: !!process.env.LIVEKIT_API_KEY,
      hasApiSecret: !!process.env.LIVEKIT_API_SECRET,
    });
    
    // Mensajes de error más específicos
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    
    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('API secret')) {
        statusCode = 500;
        errorMessage = 'LiveKit credentials not configured. Please check LIVEKIT_API_KEY and LIVEKIT_API_SECRET environment variables.';
      } else if (error.message.includes('Room name')) {
        statusCode = 400;
        errorMessage = error.message;
      } else {
        errorMessage = error.message;
      }
    }
    
    res.status(statusCode).json({
      error: 'Internal server error',
      message: errorMessage,
    });
  }
}

