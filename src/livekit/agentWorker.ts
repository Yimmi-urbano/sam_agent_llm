import {
  Agent,
  WorkerOptions,
  cli,
  Room,
  Participant,
  DataPacket_Kind,
  Track,
  AudioFrame,
} from '@livekit/agents';
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
  private orchestrator: AgentOrchestrator;
  private sttService: STTService;
  private agentConfigRepo: AgentConfigRepo;
  private conversationsRepo: ConversationsRepo;

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
  async onParticipantConnected(room: Room, participant: Participant) {
    // Extraer metadata (tenantId, userId, etc.)
    const metadata = this.parseMetadata(participant.metadata);
  }

  /**
   * Maneja cuando se recibe un mensaje de datos (chat)
   */
  async onDataReceived(
    room: Room,
    payload: Uint8Array,
    participant?: Participant,
    kind?: DataPacket_Kind
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
    track: Track,
    stream: MediaStreamTrack,
    participant?: Participant
  ) {
    if (track.kind === 'audio') {
      // Procesar audio stream para STT
      // Nota: La implementación completa requiere procesar el stream de audio
      // Por ahora, esto es un placeholder
    }
  }

  /**
   * Envía respuesta de texto
   */
  private async sendTextResponse(
    room: Room,
    participant: Participant | undefined,
    response: any
  ) {
    const data = JSON.stringify({
      type: 'agent_response',
      ...response,
    });

    await room.localParticipant.publishData(
      new TextEncoder().encode(data),
      DataPacket_Kind.RELIABLE
    );
  }

  /**
   * Genera y envía respuesta de audio
   */
  private async sendAudioResponse(
    room: Room,
    participant: Participant | undefined,
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

// Configurar y ejecutar el worker
const workerOptions: WorkerOptions = {
  entrypoint: async (room: Room) => {
    const worker = new LiveKitAgentWorker();

    // Registrar handlers
    room.on('participantConnected', (participant) => {
      worker.onParticipantConnected(room, participant);
    });

    room.on('dataReceived', (payload, participant, kind) => {
      worker.onDataReceived(room, payload, participant, kind);
    });

    room.on('trackSubscribed', (track, stream, participant) => {
      worker.onTrackSubscribed(track, stream, participant);
    });
  },
};

// Ejecutar con CLI de LiveKit
cli(workerOptions);

