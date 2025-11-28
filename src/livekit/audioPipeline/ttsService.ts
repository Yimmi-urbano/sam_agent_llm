import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { ElevenLabsClient } from 'elevenlabs';
import { logger } from '../../utils/logger.js';
import { AudioConfig } from '../../db/agentConfigRepo.js';
import { decryptApiKey } from '../../utils/encryption.js';

export type TTSProvider = 'aws-polly' | 'elevenlabs';

/**
 * Servicio de Text-to-Speech (TTS) unificado que soporta AWS Polly y ElevenLabs
 */
export class TTSService {
  private pollyClient: PollyClient | null = null;
  private elevenlabsClient: ElevenLabsClient | null = null;
  private provider: TTSProvider;
  private defaultVoiceId: string;
  private awsRegion?: string;

  /**
   * Constructor que acepta configuración de audio desde la base de datos
   */
  constructor(audioConfig: AudioConfig) {
    this.provider = audioConfig.tts === 'disabled' ? 'aws-polly' : audioConfig.tts;
    this.defaultVoiceId = audioConfig.voiceId || (this.provider === 'elevenlabs' ? '21m00Tcm4TlvDq8ikWAM' : 'Lupe');
    this.awsRegion = audioConfig.awsRegion || 'us-east-1';

    // Inicializar cliente según el proveedor
    if (this.provider === 'aws-polly') {
      this.initializePolly(audioConfig);
    } else if (this.provider === 'elevenlabs') {
      this.initializeElevenLabs(audioConfig);
    }
  }

  /**
   * Inicializa el cliente de AWS Polly
   */
  private initializePolly(audioConfig: AudioConfig): void {
    try {
      let accessKeyId: string | undefined;
      let secretAccessKey: string | undefined;

      // Desencriptar credenciales si están disponibles
      if (audioConfig.awsAccessKeyIdEncrypted && audioConfig.awsSecretAccessKeyEncrypted) {
        try {
          accessKeyId = decryptApiKey(audioConfig.awsAccessKeyIdEncrypted);
          secretAccessKey = decryptApiKey(audioConfig.awsSecretAccessKeyEncrypted);
        } catch (error) {
          logger.warn('Failed to decrypt AWS credentials, attempting to use IAM role or default credentials', error);
        }
      }

      // Validar región
      const validRegions = [
        'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
        'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
        'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1',
        'ca-central-1', 'sa-east-1'
      ];

      const normalizedRegion = (this.awsRegion || 'us-east-1').trim().toLowerCase();
      const region = validRegions.includes(normalizedRegion) ? normalizedRegion : 'us-east-1';

      if (!validRegions.includes(normalizedRegion)) {
        logger.warn(`Invalid AWS region: ${this.awsRegion}, using us-east-1 as fallback`);
      }

      this.pollyClient = new PollyClient({
        region,
        credentials: accessKeyId && secretAccessKey ? {
          accessKeyId,
          secretAccessKey,
        } : undefined, // Usar credenciales por defecto de AWS SDK si no se proporcionan
      });
    } catch (error) {
      logger.error('Error initializing AWS Polly client', error);
      throw error;
    }
  }

  /**
   * Inicializa el cliente de ElevenLabs
   */
  private initializeElevenLabs(audioConfig: AudioConfig): void {
    try {
      if (!audioConfig.elevenlabsApiKeyEncrypted) {
        throw new Error('ElevenLabs API key is required but not provided in audio config');
      }

      const apiKey = decryptApiKey(audioConfig.elevenlabsApiKeyEncrypted);
      this.elevenlabsClient = new ElevenLabsClient({
        apiKey,
      });
    } catch (error) {
      logger.error('Error initializing ElevenLabs client', error);
      throw error;
    }
  }

  /**
   * Sintetiza texto a audio usando el proveedor configurado
   * @param text Texto a sintetizar
   * @param options Opciones de síntesis
   * @returns Buffer de audio (formato: MP3 por defecto)
   */
  public async synthesize(
    text: string,
    options: {
      voiceId?: string;
      languageCode?: string;
      outputFormat?: 'mp3' | 'ogg_vorbis' | 'pcm';
      sampleRate?: string;
      engine?: 'standard' | 'neural';
    } = {}
  ): Promise<Buffer> {
    if (this.provider === 'aws-polly') {
      return this.synthesizeWithPolly(text, options);
    } else if (this.provider === 'elevenlabs') {
      return this.synthesizeWithElevenLabs(text, options.voiceId);
    } else {
      throw new Error(`Unsupported TTS provider: ${this.provider}`);
    }
  }

  /**
   * Sintetiza usando AWS Polly
   */
  private async synthesizeWithPolly(
    text: string,
    options: {
      voiceId?: string;
      languageCode?: string;
      outputFormat?: 'mp3' | 'ogg_vorbis' | 'pcm';
      sampleRate?: string;
      engine?: 'standard' | 'neural';
    }
  ): Promise<Buffer> {
    if (!this.pollyClient) {
      throw new Error('AWS Polly client is not initialized');
    }

    try {
      const command = new SynthesizeSpeechCommand({
        Text: text,
        VoiceId: (options.voiceId || this.defaultVoiceId) as any,
        OutputFormat: options.outputFormat || 'mp3',
        SampleRate: options.sampleRate || '22050',
        LanguageCode: (options.languageCode || 'es-ES') as any,
        Engine: options.engine || 'neural',
      });

      const response = await this.pollyClient.send(command);

      if (!response.AudioStream) {
        throw new Error('No audio stream received from Polly');
      }

      // Convertir stream a buffer
      // AudioStream puede ser Readable, Blob, o ReadableStream
      const chunks: Uint8Array[] = [];
      
      // Si es un Readable stream de Node.js
      if (response.AudioStream && typeof (response.AudioStream as any).on === 'function') {
        // Es un stream de Node.js, leerlo usando eventos
        const stream = response.AudioStream as any;
        const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
        return audioBuffer;
      } else if (response.AudioStream instanceof ReadableStream) {
        // Es un ReadableStream del navegador
        const reader = response.AudioStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        // Intentar convertir directamente a buffer
        const stream = response.AudioStream as any;
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      }

      const audioBuffer = Buffer.concat(chunks);
      return audioBuffer;
    } catch (error) {
      logger.error('TTS synthesis error (Polly)', error);
      throw error;
    }
  }

  /**
   * Sintetiza usando ElevenLabs
   */
  private async synthesizeWithElevenLabs(
    text: string,
    voiceId?: string
  ): Promise<Buffer> {
    if (!this.elevenlabsClient) {
      throw new Error('ElevenLabs client is not initialized');
    }

    try {
      const finalVoiceId = voiceId || this.defaultVoiceId;

      // Usar el método textToSpeech del cliente de ElevenLabs
      // La API puede variar según la versión del SDK
      const audio: any = await this.elevenlabsClient.textToSpeech.convert(finalVoiceId, {
        text,
        modelId: 'eleven_multilingual_sts_v2', // Modelo multilingüe (snake_case como espera el SDK)
        outputFormat: 'mp3_44100_128',
      } as any);

      // Convertir el stream a buffer
      const chunks: Uint8Array[] = [];
      
      // El resultado puede ser un stream o un buffer directamente
      if (audio instanceof ReadableStream || Symbol.asyncIterator in audio) {
        // Es un stream iterable
        for await (const chunk of audio as any) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      } else if (audio instanceof ArrayBuffer) {
        // Es un ArrayBuffer
        chunks.push(Buffer.from(audio));
      } else if (Buffer.isBuffer(audio)) {
        // Ya es un Buffer
        chunks.push(audio);
      } else {
        // Intentar convertir a buffer
        chunks.push(Buffer.from(audio as any));
      }

      const audioBuffer = Buffer.concat(chunks);
      return audioBuffer;
    } catch (error) {
      logger.error('TTS synthesis error (ElevenLabs)', error);
      throw error;
    }
  }

  /**
   * Sintetiza usando la descripción de audio (más corta que el mensaje completo)
   */
  public async synthesizeFromDescription(
    audioDescription: string,
    voiceId?: string
  ): Promise<Buffer> {
    if (this.provider === 'elevenlabs') {
      return this.synthesizeWithElevenLabs(audioDescription, voiceId);
    } else {
      return this.synthesize(audioDescription, { voiceId });
    }
  }

  /**
   * Obtiene el proveedor actual
   */
  public getProvider(): TTSProvider {
    return this.provider;
  }

  /**
   * Obtiene el voiceId por defecto
   */
  public getDefaultVoiceId(): string {
    return this.defaultVoiceId;
  }
}
