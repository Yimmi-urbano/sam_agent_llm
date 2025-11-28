import { Request, Response } from 'express';
import { AgentConfigRepo } from '../db/agentConfigRepo.js';
import { DatabaseManager } from '../db/databaseManager.js';
import { TTSService } from '../livekit/audioPipeline/ttsService.js';
import { logger } from '../utils/logger.js';

/**
 * @swagger
 * /api/audio:
 *   post:
 *     summary: Generar audio desde texto
 *     description: Convierte texto a audio usando el servicio TTS configurado (AWS Polly o ElevenLabs)
 *     tags: [Audio]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AudioRequest'
 *     responses:
 *       200:
 *         description: Audio generado exitosamente
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Solicitud inválida o audio deshabilitado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Configuración del agente no encontrada
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
 *   get:
 *     summary: Generar audio desde texto (GET)
 *     description: Versión GET del endpoint de generación de audio
 *     tags: [Audio]
 *     security:
 *       - bearerAuth: []
 *       - tenantHeader: []
 *     parameters:
 *       - in: query
 *         name: text
 *         required: true
 *         schema:
 *           type: string
 *         description: Texto a convertir a audio
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *         description: ID del agente
 *     responses:
 *       200:
 *         description: Audio generado exitosamente
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 */
/**
 * Genera audio desde texto usando la configuración del agente
 * POST /api/audio
 * Body: { text: string, agentId?: string }
 */
export async function generateAudioHandler(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const agentId = (req.body.agentId || req.query.agentId || 'default') as string;
    const text = req.body.text || req.query.text;

    if (!tenantId) {
      res.status(400).json({ error: 'Missing tenantId in headers' });
      return;
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Missing or invalid text parameter' });
      return;
    }

    // Obtener configuración del agente
    const dbManager = DatabaseManager.getInstance();
    const agentConfigRepo = new AgentConfigRepo(dbManager);
    const agentConfig = await agentConfigRepo.getByTenant(tenantId, agentId);

    if (!agentConfig) {
      res.status(404).json({ 
        error: 'Agent config not found',
        message: `No agent configuration found for ${tenantId}/${agentId}` 
      });
      return;
    }

    // Verificar si el audio está habilitado
    if (!agentConfig.audio.enabled || agentConfig.audio.tts === 'disabled') {
      res.status(400).json({ 
        error: 'Audio is disabled',
        message: 'TTS is disabled for this agent configuration' 
      });
      return;
    }

    // Validar que el proveedor TTS tenga las credenciales necesarias
    if (agentConfig.audio.tts === 'aws-polly') {
      // Para AWS Polly, las credenciales pueden venir de la BD o usar IAM role
      if (!agentConfig.audio.awsAccessKeyIdEncrypted && !agentConfig.audio.awsSecretAccessKeyEncrypted) {
        logger.warn('AWS credentials not found in config, attempting to use IAM role or default credentials');
      }
    } else if (agentConfig.audio.tts === 'elevenlabs') {
      if (!agentConfig.audio.elevenlabsApiKeyEncrypted) {
        res.status(400).json({ 
          error: 'Missing ElevenLabs API key',
          message: 'ElevenLabs API key is required but not configured in agent audio config' 
        });
        return;
      }
    }

    // Crear servicio TTS con configuración de la BD
    const ttsService = new TTSService(agentConfig.audio);
    const voiceId = agentConfig.audio.voiceId || ttsService.getDefaultVoiceId();

    // Generar audio
    const audioBuffer = await ttsService.synthesize(text, {
      voiceId,
      languageCode: 'es-MX', // Puede ser configurable en el futuro
      outputFormat: 'mp3',
      engine: 'neural',
      
    });

    // Retornar audio como MP3
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length.toString());
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache por 1 hora
    res.setHeader('X-Voice-Id', voiceId);
    res.setHeader('X-Provider', agentConfig.audio.tts);
    res.setHeader('X-Text-Length', text.length.toString());
    
    res.send(audioBuffer);
  } catch (error) {
    logger.error('Error generating audio', error);
    
    // Mensajes de error más específicos
    let errorMessage = 'Failed to generate audio';
    if (error instanceof Error) {
      if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        errorMessage = 'TTS service unavailable. Please check network connectivity.';
      } else if (error.message.includes('credentials') || error.message.includes('Unauthorized') || error.message.includes('API key')) {
        errorMessage = 'TTS credentials not configured or invalid. Please check your agent audio configuration.';
      } else if (error.message.includes('decrypt')) {
        errorMessage = 'Failed to decrypt TTS credentials. Please check encryption configuration.';
      } else {
        errorMessage = error.message;
      }
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' 
        ? 'Failed to generate audio' 
        : errorMessage,
    });
  }
}

/**
 * @swagger
 * /api/audio/from-description:
 *   post:
 *     summary: Generar audio desde descripción
 *     description: Genera audio desde una descripción de audio (audio_description) de una respuesta del agente
 *     tags: [Audio]
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
 *               - audioDescription
 *             properties:
 *               audioDescription:
 *                 type: string
 *                 description: Descripción de audio a convertir
 *                 example: "Un mensaje de bienvenida con tono amigable"
 *               agentId:
 *                 type: string
 *                 description: ID del agente
 *                 example: "default"
 *     responses:
 *       200:
 *         description: Audio generado exitosamente
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
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
 * Genera audio desde audio_description de una respuesta del agente
 * POST /api/audio/from-description
 * Body: { audioDescription: string, agentId?: string }
 */
export async function generateAudioFromDescriptionHandler(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const agentId = (req.body.agentId || req.query.agentId || 'default') as string;
    const audioDescription = req.body.audioDescription || req.body.audio_description || req.query.audioDescription;

    if (!tenantId) {
      res.status(400).json({ error: 'Missing tenantId in headers' });
      return;
    }

    if (!audioDescription || typeof audioDescription !== 'string' || audioDescription.trim().length === 0) {
      res.status(400).json({ error: 'Missing or invalid audioDescription parameter' });
      return;
    }

    // Obtener configuración del agente
    const dbManager = DatabaseManager.getInstance();
    const agentConfigRepo = new AgentConfigRepo(dbManager);
    const agentConfig = await agentConfigRepo.getByTenant(tenantId, agentId);

    if (!agentConfig) {
      res.status(404).json({ 
        error: 'Agent config not found',
        message: `No agent configuration found for ${tenantId}/${agentId}` 
      });
      return;
    }

    // Verificar si el audio está habilitado
    if (!agentConfig.audio.enabled || agentConfig.audio.tts === 'disabled') {
      res.status(400).json({ 
        error: 'Audio is disabled',
        message: 'TTS is disabled for this agent configuration' 
      });
      return;
    }

    // Validar que el proveedor TTS tenga las credenciales necesarias
    if (agentConfig.audio.tts === 'aws-polly') {
      // Para AWS Polly, las credenciales pueden venir de la BD o usar IAM role
      if (!agentConfig.audio.awsAccessKeyIdEncrypted && !agentConfig.audio.awsSecretAccessKeyEncrypted) {
        logger.warn('AWS credentials not found in config, attempting to use IAM role or default credentials');
      }
    } else if (agentConfig.audio.tts === 'elevenlabs') {
      if (!agentConfig.audio.elevenlabsApiKeyEncrypted) {
        res.status(400).json({ 
          error: 'Missing ElevenLabs API key',
          message: 'ElevenLabs API key is required but not configured in agent audio config' 
        });
        return;
      }
    }

    // Crear servicio TTS con configuración de la BD
    const ttsService = new TTSService(agentConfig.audio);
    const voiceId = agentConfig.audio.voiceId || ttsService.getDefaultVoiceId();

    // Generar audio desde la descripción
    const audioBuffer = await ttsService.synthesizeFromDescription(audioDescription, voiceId);

    // Retornar audio como MP3
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length.toString());
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Voice-Id', voiceId);
    res.setHeader('X-Provider', agentConfig.audio.tts);
    res.setHeader('X-Description-Length', audioDescription.length.toString());
    
    res.send(audioBuffer);
  } catch (error) {
    logger.error('Error generating audio from description', error);
    
    // Mensajes de error más específicos
    let errorMessage = 'Failed to generate audio';
    if (error instanceof Error) {
      if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        errorMessage = 'TTS service unavailable. Please check network connectivity.';
      } else if (error.message.includes('credentials') || error.message.includes('Unauthorized') || error.message.includes('API key')) {
        errorMessage = 'TTS credentials not configured or invalid. Please check your agent audio configuration.';
      } else if (error.message.includes('decrypt')) {
        errorMessage = 'Failed to decrypt TTS credentials. Please check encryption configuration.';
      } else {
        errorMessage = error.message;
      }
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' 
        ? 'Failed to generate audio' 
        : errorMessage,
    });
  }
}
