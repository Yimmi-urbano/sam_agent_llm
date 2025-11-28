import { AccessToken } from 'livekit-server-sdk';
import { logger } from '../utils/logger.js';

/**
 * Cliente para interactuar con LiveKit Server
 */
export class LiveKitClient {
  private apiKey: string;
  private apiSecret: string;
  private livekitUrl: string;

  constructor(
    livekitUrl: string,
    apiKey: string,
    apiSecret: string
  ) {
    this.livekitUrl = livekitUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /**
   * Genera un token de acceso para un usuario
   */
  public async generateAccessToken(
    roomName: string,
    participantIdentity: string,
    options: {
      canPublish?: boolean;
      canSubscribe?: boolean;
      canPublishData?: boolean;
      metadata?: string;
    } = {}
  ): Promise<string> {
    // Validar credenciales antes de generar el token
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      logger.error('LiveKit API key is missing or empty');
      throw new Error('LiveKit API key is not configured');
    }

    if (!this.apiSecret || this.apiSecret.trim().length === 0) {
      logger.error('LiveKit API secret is missing or empty');
      throw new Error('LiveKit API secret is not configured');
    }

    if (!roomName || roomName.trim().length === 0) {
      logger.error('Room name is missing or empty');
      throw new Error('Room name is required');
    }

    if (!participantIdentity || participantIdentity.trim().length === 0) {
      logger.error('Participant identity is missing or empty');
      throw new Error('Participant identity is required');
    }

    try {
      const at = new AccessToken(this.apiKey, this.apiSecret, {
        identity: participantIdentity,
      });

      at.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: options.canPublish ?? true,
        canSubscribe: options.canSubscribe ?? true,
        canPublishData: options.canPublishData ?? true,
      });

      if (options.metadata) {
        at.metadata = options.metadata;
      }

      // toJwt() puede ser asíncrono en versiones recientes o síncrono en versiones antiguas
      let jwt: string;
      const jwtResult = at.toJwt();
      if (jwtResult instanceof Promise) {
        jwt = await jwtResult;
      } else {
        jwt = jwtResult as string;
      }
      
      // Validar que el JWT sea un string válido
      if (!jwt || typeof jwt !== 'string' || jwt.length === 0) {
        logger.error('Invalid JWT generated');
        throw new Error('Failed to generate valid JWT token: toJwt() returned invalid value');
      }

      return jwt;
    } catch (error) {
      logger.error('Error generating access token', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        roomName,
        participantIdentity,
        hasApiKey: !!this.apiKey,
        hasApiSecret: !!this.apiSecret,
      });
      throw error;
    }
  }

}

