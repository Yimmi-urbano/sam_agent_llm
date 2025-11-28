import { logger } from '../../utils/logger.js';

/**
 * Servicio de Speech-to-Text (STT)
 * Por defecto usa Groq Whisper, pero puede configurarse para otros proveedores
 */
export class STTService {
  private groqApiKey?: string;

  constructor(groqApiKey?: string) {
    this.groqApiKey = groqApiKey;
  }

  /**
   * Convierte audio a texto
   * @param audioBuffer Buffer de audio (formato: PCM, WAV, etc.)
   * @param options Opciones de transcripción
   */
  public async transcribe(
    audioBuffer: Buffer,
    options: {
      language?: string;
      model?: string;
    } = {}
  ): Promise<string> {
    try {
      // Por ahora, usar Groq Whisper API
      // En producción, se puede integrar con otros proveedores (Deepgram, AssemblyAI, etc.)

      if (!this.groqApiKey) {
        throw new Error('Groq API key not configured for STT');
      }

      // Convertir audio buffer a formato base64 o usar FormData
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', options.model || 'whisper-large-v3');
      if (options.language) {
        formData.append('language', options.language);
      }

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`STT API error: ${response.status} - ${error}`);
      }

      const result = await response.json();
      return result.text || '';
    } catch (error) {
      logger.error('STT transcription error', error);
      throw error;
    }
  }

  /**
   * Transcribe audio desde URL (útil para LiveKit)
   */
  public async transcribeFromUrl(audioUrl: string, options: any = {}): Promise<string> {
    // Descargar audio y transcribir
    const response = await fetch(audioUrl);
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return this.transcribe(audioBuffer, options);
  }
}

