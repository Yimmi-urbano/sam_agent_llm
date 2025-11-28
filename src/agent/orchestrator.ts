import { AgentConfig, AgentConfigRepo } from '../db/agentConfigRepo.js';
import { ConversationsRepo, ConversationMessage } from '../db/conversationsRepo.js';
import { LLMRouter, LLMMessage } from './llmRouter.js';
import { ToolRegistry, ToolContext } from './toolRegistry.js';
import { PromptBuilder } from './promptBuilder.js';
import { logger } from '../utils/logger.js';

export interface AgentResponse {
  message: string;
  audio_description: string;
  conversationId?: string;
  action: {
    type: string | null;
    payload: Record<string, any>;
  };
  meta?: {
    model: string;
    tokens?: number;
    tokensInput?: number;
    tokensOutput?: number;
    latency: number;
    toolsUsed?: string[];
    estimatedCost?: number;
  };
}

export interface OrchestratorContext {
  tenantId: string;
  userId: string;
  conversationId: string;
  agentId?: string;
}

/**
 * Orquestador principal que coordina todo el flujo:
 * 1. Carga configuración del agente
 * 2. Carga contexto (últimos mensajes)
 * 3. Construye prompt
 * 4. Llama al LLM
 * 5. Ejecuta tools si es necesario
 * 6. Genera respuesta final
 */
export class AgentOrchestrator {
  private agentConfigRepo: AgentConfigRepo;
  private conversationsRepo: ConversationsRepo;
  private llmRouter: LLMRouter;
  private toolRegistry: ToolRegistry;
  private promptBuilder: PromptBuilder;

  constructor(
    agentConfigRepo: AgentConfigRepo,
    conversationsRepo: ConversationsRepo,
    llmRouter: LLMRouter,
    toolRegistry: ToolRegistry
  ) {
    this.agentConfigRepo = agentConfigRepo;
    this.conversationsRepo = conversationsRepo;
    this.llmRouter = llmRouter;
    this.toolRegistry = toolRegistry;
    this.promptBuilder = new PromptBuilder();
  }

  /**
   * Procesa un mensaje del usuario y genera una respuesta
   */
  public async processMessage(
    context: OrchestratorContext,
    userMessage: string
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // 1. Cargar configuración del agente
      const agentConfig = await this.agentConfigRepo.getByTenant(
        context.tenantId,
        context.agentId || 'default'
      );

      if (!agentConfig) {
        throw new Error(`Agent config not found for tenant: ${context.tenantId}`);
      }

      // 2. Cargar últimos mensajes (política: últimos 4 para mantener mejor contexto)
      const lastMessages = await this.conversationsRepo.getLastMessages(
        context.tenantId,
        context.userId,
        context.conversationId,
        4
      );

      // 3. Extraer contexto para resolver anáforas
      const extractedContext = this.promptBuilder.extractContext(lastMessages);

      // 4. Obtener definiciones de herramientas
      const toolDefinitions = this.toolRegistry.getToolDefinitions(agentConfig);

      // 5. Construir prompt del sistema
      const systemPrompt = this.promptBuilder.buildSystemPrompt(agentConfig, toolDefinitions);

      // 6. Construir mensajes de conversación (incluir contexto extraído)
      const messages = this.promptBuilder.buildConversationMessages(
        systemPrompt,
        lastMessages,
        userMessage,
        extractedContext
      );

      // 7. Calcular tokens aproximados del prompt (input)
      const estimatedInputTokens = this.estimatePromptTokens(messages, toolDefinitions);
      
      // 8. Llamar al LLM
      const llmResponse = await this.llmRouter.generate(
        agentConfig.llm,
        messages,
        toolDefinitions.length > 0 ? toolDefinitions : undefined
      );

      // 9. Obtener tokens reales del LLM (si están disponibles)
      const actualInputTokens = llmResponse.tokens?.prompt || estimatedInputTokens;
      
      // Si no hay tokens de output del LLM, estimarlos desde la respuesta generada
      let outputTokens = llmResponse.tokens?.completion || 0;
      if (outputTokens === 0 && llmResponse.content) {
        // Estimar tokens de output: 1 token ≈ 4 caracteres
        outputTokens = Math.ceil(llmResponse.content.length / 4);
      }
      
      const totalTokens = llmResponse.tokens?.total || (actualInputTokens + outputTokens);

      // 10. Calcular costo estimado
      const estimatedCost = this.calculateEstimatedCost(
        agentConfig.llm.provider,
        agentConfig.llm.model,
        actualInputTokens,
        outputTokens
      );

      // 11. Ejecutar tools si el LLM los solicitó
      let finalResponse: AgentResponse;
      const toolsUsed: string[] = [];

      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        // Ejecutar tools
        const toolContext: ToolContext = {
          tenantId: context.tenantId,
          userId: context.userId,
          conversationId: context.conversationId,
          agentConfig,
        };

        const toolResults: any[] = [];

        for (const toolCall of llmResponse.toolCalls) {
          const toolResult = await this.toolRegistry.executeTool(
            toolCall.name,
            toolCall.arguments,
            toolContext
          );

          toolsUsed.push(toolCall.name);
          toolResults.push({
            tool: toolCall.name,
            result: toolResult,
          });

          // Si la herramienta falla, continuar con las demás
          if (!toolResult.success) {
            logger.warn('Tool execution failed', {
              tool: toolCall.name,
              error: toolResult.error,
            });
          }
        }

        // 13. Si se ejecutaron tools, hacer una segunda llamada al LLM con los resultados
        // Esto permite que el LLM genere una respuesta natural basada en los datos obtenidos
        finalResponse = await this.generateResponseFromToolResults(
          agentConfig,
          messages,
          toolResults,
          extractedContext,
          userMessage
        );
      } else {
        // 14. Si no hay tools, parsear respuesta JSON del LLM
        const parsedResponse = this.parseLLMResponse(llmResponse.content, agentConfig);
        
        // Si la respuesta contiene una acción, ejecutarla
        if (parsedResponse.action?.type && parsedResponse.action.type !== null) {
          finalResponse = await this.executeActionFromResponse(
            parsedResponse,
            context,
            agentConfig,
            extractedContext,
            userMessage
          );
        } else {
          finalResponse = parsedResponse;
        }
      }

      // 12. Añadir metadata con información detallada de tokens
      finalResponse.meta = {
        model: llmResponse.model,
        tokens: totalTokens,
        tokensInput: actualInputTokens,
        tokensOutput: outputTokens,
        latency: Date.now() - startTime,
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
        estimatedCost: estimatedCost.totalCost,
      };

      // 15. Guardar mensajes en la conversación
      await this.saveConversation(context, userMessage, finalResponse, agentConfig);

      // 16. Incluir conversationId en la respuesta
      finalResponse.conversationId = context.conversationId;

      return finalResponse;
    } catch (error) {
      logger.error('Error in orchestrator', error);
      throw error;
    }
  }

  /**
   * Ejecuta una acción detectada en la respuesta del LLM
   */
  private async executeActionFromResponse(
    parsedResponse: AgentResponse,
    context: OrchestratorContext,
    agentConfig: AgentConfig,
    extractedContext: any,
    userMessage: string
  ): Promise<AgentResponse> {
    const actionType = parsedResponse.action.type;
    const actionPayload = parsedResponse.action.payload || {};

    const toolContext: ToolContext = {
      tenantId: context.tenantId,
      userId: context.userId,
      conversationId: context.conversationId,
      agentConfig,
    };

    try {
      let toolResult: any = null;

      // Mapear acciones a herramientas
      switch (actionType) {
        case 'search_product':
          toolResult = await this.toolRegistry.executeTool(
            'search_product',
            actionPayload,
            toolContext
          );
          break;
        case 'add_to_cart':
          // Si no hay productId pero hay productos en el contexto, usar el primero
          if (!actionPayload.productId && extractedContext?.lastSearchResults?.length > 0) {
            const firstProduct = extractedContext.lastSearchResults[0];
            actionPayload.productId = firstProduct._id?.toString() || firstProduct.id || firstProduct.slug;
          }
          toolResult = await this.toolRegistry.executeTool(
            'add_to_cart',
            actionPayload,
            toolContext
          );
          break;
        case 'show_product':
          // Si no hay productId pero hay productos en el contexto, usar el primero
          if (!actionPayload.productId && extractedContext?.lastSearchResults?.length > 0) {
            const firstProduct = extractedContext.lastSearchResults[0];
            actionPayload.productId = firstProduct._id?.toString() || firstProduct.id || firstProduct.slug;
          }
          toolResult = await this.toolRegistry.executeTool(
            'show_product',
            actionPayload,
            toolContext
          );
          break;
        case 'get_order':
          toolResult = await this.toolRegistry.executeTool(
            'get_order',
            actionPayload,
            toolContext
          );
          break;
        default:
          // Verificar si es una custom tool
          if (actionType) {
            const customTool = this.toolRegistry.findCustomToolByName(actionType, agentConfig);
            if (customTool) {
              // Mapear parámetros: si viene "query" pero la tool espera otro nombre, intentar mapear
              let mappedPayload = { ...actionPayload };
              
              // Si el payload tiene "query" y el path tiene {query}, mantenerlo
              // Si el payload tiene "query" pero el path tiene otro nombre, mapear
              if (actionPayload.query && customTool.path) {
                // Buscar el nombre del parámetro en el path (ej: {nombreEspecialidad})
                const pathParamMatch = customTool.path.match(/\{(\w+)\}/);
                if (pathParamMatch && pathParamMatch[1] !== 'query') {
                  const paramName = pathParamMatch[1];
                  mappedPayload[paramName] = actionPayload.query;
                  // Mantener query también por si acaso
                }
              }
              
              toolResult = await this.toolRegistry.executeTool(
                actionType,
                mappedPayload,
                toolContext
              );
            } else {
              logger.warn('Unknown action type', { actionType });
              return parsedResponse; // Retornar respuesta original si no se reconoce la acción
            }
          } else {
            logger.warn('Unknown action type', { actionType });
            return parsedResponse; // Retornar respuesta original si no se reconoce la acción
          }
          break;
      }

      // Si la herramienta necesita información del usuario, retornar pregunta
      if (toolResult && toolResult.needsUserInput) {
        return {
          message: toolResult.question || parsedResponse.message || 'Necesito más información para ayudarte.',
          audio_description: this.generateAudioDescription(toolResult.question || 'Necesito más información'),
          action: { type: null, payload: {} }, // No ejecutar acción hasta tener la información
        };
      }

      if (toolResult && toolResult.success) {
        // Construir respuesta con los resultados de la herramienta
        let message = parsedResponse.message;
        let action: AgentResponse['action'] = parsedResponse.action;

        // Si es search_product, incluir los productos en la respuesta
        if (actionType === 'search_product' && toolResult.data) {
          const products = toolResult.data.products || [];
          const count = toolResult.data.count || products.length;

          if (count > 0) {
            // Construir mensaje con los productos encontrados
            const productList = products.slice(0, 5).map((p: any, idx: number) => {
              const price = p.price?.regular || p.price?.sale || p.price || 'N/A';
              const priceStr = typeof price === 'number' ? `S/ ${price.toFixed(2)}` : price;
              return `${idx + 1}. ${p.title || p.name || 'Producto sin nombre'} - ${priceStr}`;
            }).join('\n');

            message = `Encontré ${count} producto${count > 1 ? 's' : ''}:\n\n${productList}${count > 5 ? `\n\n... y ${count - 5} más.` : ''}`;
            
            // Incluir productos en el payload de la acción
            action = {
              type: 'search_product',
              payload: {
                query: actionPayload.query || '',
                products: products,
                count: count,
              },
            };
          } else {
            message = `No encontré productos que coincidan con "${actionPayload.query || 'tu búsqueda'}". ¿Podrías ser más específico?`;
            action = {
              type: 'search_product',
              payload: {
                query: actionPayload.query || '',
                products: [],
                count: 0,
              },
            };
          }
        } else if (actionType === 'show_product' && toolResult.data) {
          // Para show_product, incluir los datos del producto
          action = {
            type: 'show_product',
            payload: toolResult.data,
          };
        } else if (actionType === 'add_to_cart' && toolResult.data) {
          // Para add_to_cart, incluir el carrito actualizado
          action = {
            type: 'add_to_cart',
            payload: toolResult.data,
          };
          message = toolResult.data.message || parsedResponse.message;
        } else if (actionType === 'get_order' && toolResult.data) {
          // Para get_order, incluir información de la orden
          const orderData = toolResult.data;
          const productList = orderData.products?.map((p: any, idx: number) => 
            `${idx + 1}. ${p.title} (x${p.qty}) - S/ ${p.valid_price}`
          ).join('\n') || 'Sin productos';
          
          message = `Orden #${orderData.orderNumber}\n\n` +
            `Productos:\n${productList}\n\n` +
            `Total: ${orderData.currency} ${orderData.total}\n` +
            `Estado: ${orderData.orderStatus?.typeStatus || 'N/A'}\n` +
            `Pago: ${orderData.paymentStatus?.typeStatus || 'N/A'}`;
          
          action = {
            type: 'get_order',
            payload: orderData,
          };
        } else {
          // Para custom tools, generar respuesta usando el LLM con los datos obtenidos
          // Hacer una llamada al LLM para generar respuesta basada en los datos
          if (actionType) {
            const customToolResponse = await this.generateResponseFromCustomTool(
              agentConfig,
              parsedResponse.message || userMessage,
              toolResult.data,
              actionType,
              context
            );
            
            return {
              message: customToolResponse.message,
              audio_description: customToolResponse.audio_description,
              action: {
                type: actionType,
                payload: toolResult.data || {},
              },
            };
          }
        }

        return {
          message,
          audio_description: this.generateAudioDescription(message, action),
          action,
        };
      } else {
        // Si la herramienta falló, retornar mensaje de error
        logger.warn('Tool execution failed', {
          actionType,
          error: toolResult?.error,
        });

        return {
          message: toolResult?.error || `No pude ejecutar la acción ${actionType}. Por favor, intenta de nuevo.`,
          audio_description: this.generateAudioDescription(`Error al ejecutar ${actionType}`),
          action: { type: null, payload: {} },
        };
      }
    } catch (error) {
      logger.error('Error executing action from response', error);
      return {
        message: parsedResponse.message || 'Ocurrió un error al procesar tu solicitud.',
        audio_description: this.generateAudioDescription('Error al procesar'),
        action: { type: null, payload: {} },
      };
    }
  }

  /**
   * Genera respuesta para una custom tool usando el LLM con los datos obtenidos
   */
  private async generateResponseFromCustomTool(
    agentConfig: AgentConfig,
    originalMessage: string,
    toolData: any,
    toolName: string,
    context: OrchestratorContext
  ): Promise<AgentResponse> {
    // Construir mensaje con los resultados de la tool
    const toolResultsMessage = `He ejecutado la herramienta "${toolName}" y obtuve estos resultados:\n\n${JSON.stringify(toolData, null, 2)}\n\nBasándote en estos resultados, genera una respuesta natural y útil para el usuario. Responde SIEMPRE en formato JSON con esta estructura:\n{\n  "message": "tu respuesta al usuario",\n  "audio_description": "descripción para audio",\n  "action": { "type": null, "payload": {} }\n}\n\nSi los resultados contienen información relevante, inclúyela en tu respuesta de manera clara y natural.`;

    // Construir mensajes para el LLM
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: this.promptBuilder.buildSystemPrompt(agentConfig, []), // Sin tools en la segunda llamada
      },
      {
        role: 'user',
        content: originalMessage,
      },
      {
        role: 'assistant',
        content: 'Voy a consultar la información que necesitas.',
      },
      {
        role: 'user',
        content: toolResultsMessage,
      },
    ];

    // Hacer llamada al LLM sin tools
    const llmResponse = await this.llmRouter.generate(
      agentConfig.llm,
      messages,
      undefined
    );

    // Parsear respuesta del LLM
    const parsedResponse = this.parseLLMResponse(llmResponse.content, agentConfig);

    return {
      message: parsedResponse.message,
      audio_description: parsedResponse.audio_description || this.generateAudioDescription(parsedResponse.message),
      action: parsedResponse.action || { type: null, payload: {} },
    };
  }

  /**
   * Genera respuesta desde resultados de tools haciendo una segunda llamada al LLM
   * Esto permite que el LLM genere una respuesta natural basada en los datos obtenidos
   */
  private async generateResponseFromToolResults(
    agentConfig: AgentConfig,
    originalMessages: LLMMessage[],
    toolResults: any[],
    extractedContext: any,
    userMessage: string
  ): Promise<AgentResponse> {
    // Construir mensaje con los resultados de las tools
    let toolResultsMessage = 'He ejecutado las siguientes herramientas y obtuve estos resultados:\n\n';
    
    for (const toolResult of toolResults) {
      toolResultsMessage += `**Herramienta: ${toolResult.tool}**\n`;
      
      if (toolResult.result.success) {
        // Formatear los datos de manera legible
        const dataStr = JSON.stringify(toolResult.result.data, null, 2);
        toolResultsMessage += `Resultado exitoso:\n${dataStr}\n\n`;
      } else {
        toolResultsMessage += `Error: ${toolResult.result.error}\n\n`;
      }
    }

    toolResultsMessage += '\nBasándote en estos resultados, genera una respuesta natural y útil para el usuario. Responde SIEMPRE en formato JSON con esta estructura:\n';
    toolResultsMessage += '{\n';
    toolResultsMessage += '  "message": "tu respuesta al usuario",\n';
    toolResultsMessage += '  "audio_description": "descripción para audio",\n';
    toolResultsMessage += '  "action": { "type": null, "payload": {} }\n';
    toolResultsMessage += '}\n\n';
    toolResultsMessage += 'Si los resultados contienen información relevante, inclúyela en tu respuesta de manera clara y natural.';

    // Construir mensajes para la segunda llamada al LLM
    const followUpMessages: LLMMessage[] = [
      ...originalMessages,
      {
        role: 'assistant',
        content: 'Voy a consultar la información que necesitas.',
      },
      {
        role: 'user',
        content: toolResultsMessage,
      },
    ];

    // Hacer segunda llamada al LLM sin tools (solo para generar respuesta)
    const followUpResponse = await this.llmRouter.generate(
      agentConfig.llm,
      followUpMessages,
      undefined // No pasar tools en la segunda llamada
    );

    // Parsear respuesta del LLM
    const parsedResponse = this.parseLLMResponse(followUpResponse.content, agentConfig);

    // Determinar acción basada en tools ejecutados (para mantener compatibilidad)
    let action: AgentResponse['action'] = parsedResponse.action || { type: null, payload: {} };
    
    // Si es una core tool conocida, mantener la estructura de acción
    for (const toolResult of toolResults) {
      if (toolResult.result.success) {
        if (toolResult.tool === 'search_product') {
          action = {
            type: 'search_product',
            payload: {
              query: toolResult.result.data?.query || '',
              products: toolResult.result.data?.products || [],
              count: toolResult.result.data?.count || 0,
            },
          };
        } else if (toolResult.tool === 'add_to_cart') {
          action = {
            type: 'add_to_cart',
            payload: toolResult.result.data,
          };
        } else if (toolResult.tool === 'show_product') {
          action = {
            type: 'show_product',
            payload: toolResult.result.data,
          };
        } else if (toolResult.tool === 'get_order') {
          action = {
            type: 'get_order',
            payload: toolResult.result.data,
          };
        } else {
          // Para custom tools, incluir los datos en el payload
          action = {
            type: toolResult.tool,
            payload: toolResult.result.data || {},
          };
        }
      }
    }

    return {
      message: parsedResponse.message,
      audio_description: parsedResponse.audio_description || this.generateAudioDescription(parsedResponse.message, action),
      action,
    };
  }

  /**
   * Construye respuesta desde resultados de tools (método legacy, mantenido para compatibilidad)
   */
  private buildResponseFromToolResults(
    llmResponse: any,
    toolResults: any[],
    context: any,
    agentConfig: AgentConfig
  ): AgentResponse {
    // Extraer información de los resultados de tools
    let action: AgentResponse['action'] = { type: null, payload: {} };
    let message = llmResponse.content || '';

    // Determinar acción basada en tools ejecutados
    for (const toolResult of toolResults) {
      if (toolResult.tool === 'search_product' && toolResult.result.success) {
        const products = toolResult.result.data?.products || [];
        const count = toolResult.result.data?.count || 0;
        
        if (count > 0) {
          // Construir mensaje con los productos encontrados
          const productList = products.slice(0, 5).map((p: any, idx: number) => 
            `${idx + 1}. ${p.title || p.name} - S/ ${p.price?.regular || p.price || 'N/A'}`
          ).join('\n');

          message = `Encontré ${count} producto${count > 1 ? 's' : ''}:\n\n${productList}${count > 5 ? `\n\n... y ${count - 5} más.` : ''}`;
        } else {
          message = message || `No encontré productos que coincidan con tu búsqueda.`;
        }
        
        action = {
          type: 'search_product',
          payload: {
            query: toolResult.result.data?.query || '',
            products: products,
            count: count,
          },
        };
      } else if (toolResult.tool === 'add_to_cart' && toolResult.result.success) {
        action = {
          type: 'add_to_cart',
          payload: toolResult.result.data,
        };
        message = message || `Producto agregado al carrito exitosamente.`;
      } else if (toolResult.tool === 'show_product' && toolResult.result.success) {
        action = {
          type: 'show_product',
          payload: toolResult.result.data,
        };
      } else if (toolResult.tool === 'get_order' && toolResult.result.success) {
        action = {
          type: 'show_order',
          payload: toolResult.result.data,
        };
      }
    }

    // Si no hay mensaje del LLM, generar uno genérico
    if (!message) {
      message = 'Operación completada exitosamente.';
    }

    return {
      message,
      audio_description: this.generateAudioDescription(message, action),
      action,
    };
  }

  /**
   * Parsea la respuesta JSON del LLM
   */
  private parseLLMResponse(content: string, agentConfig: AgentConfig): AgentResponse {
    try {
      // Intentar extraer JSON del contenido
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          message: parsed.message || content,
          audio_description: parsed.audio_description || this.generateAudioDescription(parsed.message || content),
          action: parsed.action || { type: null, payload: {} },
        };
      }

      // Si no hay JSON, devolver respuesta simple
      return {
        message: content,
        audio_description: this.generateAudioDescription(content),
        action: { type: null, payload: {} },
      };
    } catch (error) {
      logger.warn('Failed to parse LLM JSON response', { error, content });
      // Fallback: respuesta simple
      return {
        message: content,
        audio_description: this.generateAudioDescription(content),
        action: { type: null, payload: {} },
      };
    }
  }

  /**
   * Estima el número de tokens en un prompt
   * Aproximación: 1 token ≈ 4 caracteres (conservador)
   */
  private estimatePromptTokens(messages: LLMMessage[], tools?: any[]): number {
    let totalChars = 0;
    
    // Sumar caracteres de todos los mensajes
    for (const msg of messages) {
      totalChars += msg.content.length;
    }
    
    // Agregar overhead de tokens por mensaje (formato, roles, etc.)
    const messageOverhead = messages.length * 4; // ~4 tokens por mensaje
    
    // Agregar tokens de herramientas si existen
    let toolsTokens = 0;
    if (tools && tools.length > 0) {
      for (const tool of tools) {
        toolsTokens += JSON.stringify(tool).length / 4; // Aproximación
        toolsTokens += 50; // Overhead por herramienta
      }
    }
    
    // Aproximación: 1 token ≈ 4 caracteres
    const estimatedTokens = Math.ceil(totalChars / 4) + messageOverhead + toolsTokens;
    
    return Math.round(estimatedTokens);
  }

  /**
   * Calcula el costo estimado basado en el proveedor y modelo
   * Precios por 1M tokens (a noviembre 2024)
   */
  private calculateEstimatedCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): {
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    totalCost: number;
    currency: string;
  } {
    // Precios por 1M tokens (USD)
    const pricing: Record<string, { input: number; output: number }> = {
      // OpenAI
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4-turbo': { input: 10.00, output: 30.00 },
      'gpt-4': { input: 30.00, output: 60.00 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
      
      // Gemini
      'gemini-2.5-flash': { input: 0.075, output: 0.30 },
      'gemini-2.0-flash-exp': { input: 0.075, output: 0.30 },
      'gemini-1.5-pro': { input: 1.25, output: 5.00 },
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
      
      // Groq
      'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
      'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
      'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
    };

    // Buscar precio exacto o usar defaults por proveedor
    let price = pricing[model.toLowerCase()];
    
    if (!price) {
      // Defaults por proveedor si no se encuentra el modelo específico
      if (provider === 'openai') {
        price = { input: 0.50, output: 1.50 }; // GPT-3.5 default
      } else if (provider === 'gemini') {
        price = { input: 0.075, output: 0.30 }; // Gemini Flash default
      } else if (provider === 'groq') {
        price = { input: 0.59, output: 0.79 }; // Llama 3.1 70B default
      } else {
        price = { input: 0.50, output: 1.50 }; // Generic default
      }
    }

    const inputCost = (inputTokens / 1_000_000) * price.input;
    const outputCost = (outputTokens / 1_000_000) * price.output;
    const totalCost = inputCost + outputCost;

    return {
      inputCostPerMillion: price.input,
      outputCostPerMillion: price.output,
      totalCost: parseFloat(totalCost.toFixed(6)),
      currency: 'USD',
    };
  }

  /**
   * Genera descripción para audio (TTS)
   */
  private generateAudioDescription(message: string, action?: AgentResponse['action']): string {
    let description = message;

    // Acortar si es muy largo
    if (description.length > 200) {
      description = description.substring(0, 197) + '...';
    }

    // Añadir contexto de acción si existe
    if (action?.type) {
      description += ` Acción: ${action.type}.`;
    }

    return description;
  }

  /**
   * Guarda la conversación en la base de datos
   */
  private async saveConversation(
    context: OrchestratorContext,
    userMessage: string,
    response: AgentResponse,
    agentConfig: AgentConfig
  ): Promise<void> {
    try {
      // Guardar mensaje del usuario
      await this.conversationsRepo.saveMessage(
        context.tenantId,
        context.userId,
        context.conversationId,
        {
          role: 'user',
          content: userMessage,
        }
      );

      // Guardar respuesta del asistente
      await this.conversationsRepo.saveMessage(
        context.tenantId,
        context.userId,
        context.conversationId,
        {
          role: 'assistant',
          content: response.message,
          action: response.action.type ? {
            type: response.action.type,
            payload: response.action.payload,
          } : undefined,
          metadata: {
            model: response.meta?.model,
            tokens: response.meta?.tokens,
            latency: response.meta?.latency,
            toolsUsed: response.meta?.toolsUsed,
          },
        }
      );

      // Actualizar metadata de conversación
      await this.conversationsRepo.upsertConversation(
        context.tenantId,
        context.userId,
        context.conversationId
      );
    } catch (error) {
      logger.error('Error saving conversation', error);
      // No lanzar error para no interrumpir el flujo
    }
  }
}

