// Nota: Este worker de LiveKit está en desarrollo
// Los tipos y la API pueden variar según la versión de @livekit/agents
// Por ahora, usamos tipos any para permitir la compilación
// TODO: Implementar correctamente cuando se necesite el worker de LiveKit
import { logger } from '../utils/logger.js';
import { STTService } from './audioPipeline/sttService.js';
import { TTSService } from './audioPipeline/ttsService.js';
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

/**
 * LiveKit Agent Worker
 * Procesa sesiones de chat y audio en tiempo real
 */
class LiveKitAgentWorker {
  private orchestrator!: AgentOrchestrator;
  private sttService!: STTService;
  private agentConfigRepo!: AgentConfigRepo;
  private conversationsRepo!: ConversationsRepo;

  constructor() {
    // Inicializar servicios
    this.initializeServices();
  }

  private async initializeServices() {
    // Conectar a MongoDB
    const dbManager = DatabaseManager.getInstance({
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
      dbName: process.env.MONGODB_DB_NAME || 'agente_multitenant',
    });

    await dbManager.connect();

    // Inicializar repositorios
    this.agentConfigRepo = new AgentConfigRepo(dbManager);
    this.conversationsRepo = new ConversationsRepo(dbManager);
    const productsRepo = new ProductsRepo(dbManager);
    const ordersRepo = new OrdersRepo(dbManager);

    // Inicializar servicios
    const ragService = new RAGService();
    const externalApiService = new ExternalApiService();

    // Inicializar agent components
    const llmRouter = new LLMRouter();
    const toolRegistry = new ToolRegistry(
      productsRepo,
      ordersRepo,
      ragService,
      externalApiService
    );

    this.orchestrator = new AgentOrchestrator(
      this.agentConfigRepo,
      this.conversationsRepo,
      llmRouter,
      toolRegistry
    );

    // Inicializar STT (TTS se crea dinámicamente desde la configuración de la BD)
    this.sttService = new STTService(process.env.GROQ_API_KEY);
  }

  /**
   * Maneja cuando un participante se une a la sala
   */
  async onParticipantConnected(room: any, participant: any) {
    // Extraer metadata (tenantId, userId, etc.)
    const metadata = this.parseMetadata(participant?.metadata);
  }

  /**
   * Maneja cuando se recibe un mensaje de datos (chat)
   */
  async onDataReceived(
    room: any,
    payload: Uint8Array,
    participant?: any,
    kind?: any
  ) {
    try {
      const message = JSON.parse(new TextDecoder().decode(payload));

      // Extraer contexto del mensaje
      const { tenantId, userId, conversationId, text, agentId } = message;

      if (!tenantId || !userId || !text) {
        logger.warn('Invalid message format', { message });
        return;
      }

      // Procesar mensaje con el orquestador
      const context: OrchestratorContext = {
        tenantId,
        userId,
        conversationId: conversationId || `conv_${Date.now()}`,
        agentId,
      };

      const response = await this.orchestrator.processMessage(context, text);

      // Incrementar uso
      await incrementUsage(
        this.agentConfigRepo,
        tenantId,
        agentId || 'default',
        1
      );

      // Obtener configuración de audio
      const agentConfig = await this.agentConfigRepo.getByTenant(tenantId, agentId || 'default');

      // Enviar respuesta de texto
      await this.sendTextResponse(room, participant, response);

      // Generar y enviar audio si está habilitado
      if (agentConfig?.audio.enabled && agentConfig.audio.tts !== 'disabled') {
        await this.sendAudioResponse(room, participant, response, agentConfig);
      }
    } catch (error) {
      logger.error('Error processing data message', error);
    }
  }

  /**
   * Maneja cuando se recibe audio
   */
  async onTrackSubscribed(
    track: any,
    stream: any,
    participant?: any
  ) {
    if (track?.kind === 'audio') {
      // Procesar audio stream para STT
      // Nota: La implementación completa requiere procesar el stream de audio
      // Por ahora, esto es un placeholder
    }
  }

  /**
   * Envía respuesta de texto
   */
  private async sendTextResponse(
    room: any,
    participant: any,
    response: any
  ) {
    const data = JSON.stringify({
      type: 'agent_response',
      ...response,
    });

    // TODO: Implementar correctamente cuando se use LiveKit
    // await room.localParticipant.publishData(
    //   new TextEncoder().encode(data),
    //   DataPacket_Kind.RELIABLE
    // );
  }

  /**
   * Genera y envía respuesta de audio
   */
  private async sendAudioResponse(
    room: any,
    participant: any,
    response: any,
    agentConfig: any
  ) {
    try {
      // Crear servicio TTS dinámicamente desde la configuración de la BD
      const ttsService = new TTSService(agentConfig.audio);
      const voiceId = agentConfig.audio.voiceId || ttsService.getDefaultVoiceId();

      // Sintetizar audio desde la descripción
      const audioBuffer = await ttsService.synthesizeFromDescription(
        response.audio_description || response.message,
        voiceId
      );

      // Publicar audio track
      // Nota: La implementación completa requiere crear un AudioTrack desde el buffer
      // y publicarlo en la sala. Esto es un placeholder.
      // TODO: Implementar publicación de audio track en LiveKit
    } catch (error) {
      logger.error('Error generating audio response', error);
    }
  }

  /**
   * Parsea metadata del participante
   */
  private parseMetadata(metadata?: string): Record<string, string> {
    if (!metadata) return {};

    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
}

// Nota: El worker de LiveKit está en desarrollo
// Este código está comentado hasta que se implemente correctamente
// Para usar el worker, descomenta y ajusta según la API de @livekit/agents

/*
// Configurar y ejecutar el worker
const workerOptions: any = {
  entrypoint: async (room: any) => {
    const worker = new LiveKitAgentWorker();

    // Registrar handlers
    if (room?.on) {
      room.on('participantConnected', (participant: any) => {
        worker.onParticipantConnected(room, participant);
      });

      room.on('dataReceived', (payload: Uint8Array, participant?: any, kind?: any) => {
        worker.onDataReceived(room, payload, participant, kind);
      });

      room.on('trackSubscribed', (track: any, stream: any, participant?: any) => {
        worker.onTrackSubscribed(track, stream, participant);
      });
    }
  },
};

// Ejecutar con CLI de LiveKit
// cli(workerOptions);
*/

