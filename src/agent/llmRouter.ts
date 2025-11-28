import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { LLMConfig } from '../db/agentConfigRepo.js';
import { logger } from '../utils/logger.js';
import { decryptApiKey } from '../utils/encryption.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  latency: number;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponseWithTools extends LLMResponse {
  toolCalls?: ToolCall[];
}

/**
 * Router para orquestar múltiples proveedores de LLM
 * Soporta: OpenAI, Gemini, Groq
 */
export class LLMRouter {
  private openaiClients: Map<string, OpenAI> = new Map();
  private geminiClients: Map<string, GoogleGenerativeAI> = new Map();
  private groqClients: Map<string, Groq> = new Map();

  /**
   * Obtiene o crea un cliente OpenAI para una API key
   */
  private getOpenAIClient(apiKey: string): OpenAI {
    if (!this.openaiClients.has(apiKey)) {
      this.openaiClients.set(apiKey, new OpenAI({ apiKey }));
    }
    return this.openaiClients.get(apiKey)!;
  }

  /**
   * Obtiene o crea un cliente Gemini para una API key
   */
  private getGeminiClient(apiKey: string): GoogleGenerativeAI {
    if (!this.geminiClients.has(apiKey)) {
      this.geminiClients.set(apiKey, new GoogleGenerativeAI(apiKey));
    }
    return this.geminiClients.get(apiKey)!;
  }

  /**
   * Obtiene o crea un cliente Groq para una API key
   */
  private getGroqClient(apiKey: string): Groq {
    if (!this.groqClients.has(apiKey)) {
      this.groqClients.set(apiKey, new Groq({ apiKey }));
    }
    return this.groqClients.get(apiKey)!;
  }

  /**
   * Genera una respuesta usando el LLM configurado
   */
  public async generate(
    config: LLMConfig,
    messages: LLMMessage[],
    tools?: Array<{ name: string; description: string; parameters: any }>
  ): Promise<LLMResponseWithTools> {
    const startTime = Date.now();
    const decryptedApiKey = decryptApiKey(config.apiKeyEncrypted);

    try {
      switch (config.provider) {
        case 'openai':
          return await this.generateOpenAI(config, decryptedApiKey, messages, tools, startTime);
        case 'gemini':
          return await this.generateGemini(config, decryptedApiKey, messages, tools, startTime);
        case 'groq':
          return await this.generateGroq(config, decryptedApiKey, messages, tools, startTime);
        default:
          throw new Error(`Unsupported LLM provider: ${config.provider}`);
      }
    } catch (error) {
      logger.error('LLM generation error', {
        provider: config.provider,
        model: config.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Genera respuesta usando OpenAI
   */
  private async generateOpenAI(
    config: LLMConfig,
    apiKey: string,
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: any }> | undefined,
    startTime: number
  ): Promise<LLMResponseWithTools> {
    const client = this.getOpenAIClient(apiKey);

    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const openaiTools = tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const response = await client.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      tools: openaiTools,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 2000,
    });

    const latency = Date.now() - startTime;
    const choice = response.choices[0];
    const message = choice.message;

    const result: LLMResponseWithTools = {
      content: message.content || '',
      model: response.model,
      tokens: response.usage ? {
        prompt: response.usage.prompt_tokens,
        completion: response.usage.completion_tokens,
        total: response.usage.total_tokens,
      } : undefined,
      latency,
    };

    // Extraer tool calls si existen
    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls
        .filter((tc) => tc && tc.function && tc.function.name && tc.function.arguments)
        .map((tc) => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        }));
    }

    return result;
  }

  /**
   * Genera respuesta usando Gemini
   */
  private async generateGemini(
    config: LLMConfig,
    apiKey: string,
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: any }> | undefined,
    startTime: number
  ): Promise<LLMResponseWithTools> {
    const client = this.getGeminiClient(apiKey);
    const model = client.getGenerativeModel({ model: config.model });

    // Convertir mensajes al formato de Gemini
    const geminiMessages = messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    // Gemini tiene soporte limitado para tools, usar function calling si está disponible
    const generationConfig = {
      temperature: config.temperature ?? 0.7,
      maxOutputTokens: config.maxTokens ?? 2000,
    };

    const result = await model.generateContent({
      contents: geminiMessages as any,
      generationConfig,
    });

    const response = result.response;
    const text = response.text();
    const latency = Date.now() - startTime;

    // Gemini no siempre proporciona tokens en la respuesta, intentar obtenerlos
    let tokens: { prompt: number; completion: number; total: number } | undefined;
    try {
      // Intentar obtener usageMetadata de diferentes formas según la versión de la API
      let usageMetadata: any = null;
      
      // Método 1: response.usageMetadata (propiedad directa)
      if ((response as any).usageMetadata) {
        usageMetadata = (response as any).usageMetadata;
      }
      
      // Método 2: result.response.usageMetadata (propiedad)
      if (!usageMetadata && (result.response as any).usageMetadata) {
        usageMetadata = (result.response as any).usageMetadata;
      }
      
      // Método 3: result.usageMetadata (propiedad del result)
      if (!usageMetadata && (result as any).usageMetadata) {
        usageMetadata = (result as any).usageMetadata;
      }
      
      // Método 4: Intentar como método si existe
      if (!usageMetadata && typeof (response as any).usageMetadata === 'function') {
        try {
          usageMetadata = (response as any).usageMetadata();
        } catch (e) {
          // Ignorar error
        }
      }
      
      if (usageMetadata) {
        // Intentar diferentes nombres de propiedades según la versión de la API
        const promptTokens = 
          usageMetadata.promptTokenCount || 
          usageMetadata.prompt_token_count || 
          (usageMetadata as any).promptTokens ||
          0;
        
        const completionTokens = 
          usageMetadata.candidatesTokenCount || 
          usageMetadata.candidates_token_count || 
          usageMetadata.totalTokenCount ||
          (usageMetadata as any).completionTokens ||
          (usageMetadata as any).candidatesTokens ||
          0;
        
        if (promptTokens > 0 || completionTokens > 0) {
          tokens = {
            prompt: promptTokens,
            completion: completionTokens,
            total: promptTokens + completionTokens,
          };
        }
      }
    } catch (error) {
      // Si no se pueden obtener tokens, continuar sin ellos
    }

    return {
      content: text,
      model: config.model,
      tokens,
      latency,
    };
  }

  /**
   * Genera respuesta usando Groq
   */
  private async generateGroq(
    config: LLMConfig,
    apiKey: string,
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: any }> | undefined,
    startTime: number
  ): Promise<LLMResponseWithTools> {
    const client = this.getGroqClient(apiKey);

    // Groq usa un formato similar a OpenAI
    // Usar tipo genérico ya que Groq SDK no exporta el tipo específico en esta versión
    const groqMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = messages.map((msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    }));

    const groqTools = tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const response = await client.chat.completions.create({
      model: config.model,
      messages: groqMessages,
      tools: groqTools,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 2000,
    });

    const latency = Date.now() - startTime;
    const choice = response.choices[0];
    const message = choice.message;

    const result: LLMResponseWithTools = {
      content: message.content || '',
      model: response.model || config.model,
      tokens: response.usage ? {
        prompt: response.usage.prompt_tokens || 0,
        completion: response.usage.completion_tokens || 0,
        total: response.usage.total_tokens || 0,
      } : undefined,
      latency,
    };

    // Extraer tool calls si existen
    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls
        .filter((tc): tc is NonNullable<typeof tc> & { function: { name: string; arguments: string } } => 
          !!(tc && tc.function && tc.function.name && tc.function.arguments)
        )
        .map((tc) => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        }));
    }

    return result;
  }
}

