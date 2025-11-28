import { AgentConfig } from '../db/agentConfigRepo.js';
import { ConversationMessage } from '../db/conversationsRepo.js';
import { LLMMessage } from './llmRouter.js';
import { ToolDefinition } from './toolRegistry.js';

/**
 * Construye el prompt maestro para el LLM
 * Incluye: instrucciones del sistema, personalidad, herramientas disponibles, contexto
 */
export class PromptBuilder {
  /**
   * Construye el mensaje del sistema con todas las instrucciones
   */
  public buildSystemPrompt(
    agentConfig: AgentConfig,
    toolDefinitions: ToolDefinition[]
  ): string {
    const personality = this.getPersonalityPrompt(agentConfig.personality);
    const toolsDescription = this.buildToolsDescription(toolDefinitions);
    const policies = this.buildPoliciesPrompt(agentConfig.policies);
    const systemPrompt = this.getSystemPrompt(agentConfig.systemPrompt);
    const nameAgent = agentConfig.name_agent || 'SAM';
    
    return `Eres ${nameAgent} un asistente virtual inteligente y profesional.

${personality}

${policies}

${toolsDescription}

${systemPrompt}

`;
  }

  /**
   * Construye los mensajes de conversación para el LLM
   */
  public buildConversationMessages(
    systemPrompt: string,
    lastMessages: ConversationMessage[],
    currentUserMessage: string,
    extractedContext?: {
      mentionedProducts?: string[];
      mentionedOrders?: string[];
      lastAction?: any;
      lastSearchResults?: any[];
      contextSummary?: string;
    }
  ): LLMMessage[] {
    // Construir prompt del sistema con contexto adicional
    let enhancedSystemPrompt = systemPrompt;
    
    if (extractedContext?.contextSummary) {
      enhancedSystemPrompt += `\n\n${extractedContext.contextSummary}\n\nIMPORTANTE: Si el usuario hace referencia a productos encontrados anteriormente (ej: "la mesa que encontraste", "ese producto", "agregalo"), usa la información de los productos listados arriba.`;
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: enhancedSystemPrompt,
      },
    ];

    // Agregar últimos mensajes (máximo 2 según política)
    // Incluir información de acciones para dar más contexto
    for (const msg of lastMessages) {
      let messageContent = msg.content;
      
      // Si el mensaje tiene una acción con productos, incluir esa información
      if (msg.action?.type === 'search_product' && msg.action.payload?.products) {
        const products = msg.action.payload.products;
        if (products.length > 0) {
          const productInfo = products.map((p: any, idx: number) => {
            const name = p.title || p.name || 'Producto';
            const price = p.price?.regular || p.price?.sale || p.price || 'N/A';
            const id = p._id?.toString() || p.id || p.slug;
            return `- ${name} (ID: ${id}, Precio: S/ ${price})`;
          }).join('\n');
          messageContent += `\n\n[Productos encontrados en esta búsqueda:\n${productInfo}]`;
        }
      } else if (msg.action?.type === 'show_product' && msg.action.payload) {
        const product = msg.action.payload;
        const name = product.title || product.name || 'Producto';
        const id = product.id || product._id?.toString() || product.slug;
        messageContent += `\n\n[Producto mostrado: ${name} (ID: ${id})]`;
      }

      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: messageContent,
      });
    }

    // Agregar mensaje actual del usuario
    messages.push({
      role: 'user',
      content: currentUserMessage,
    });

    return messages;
  }

  /**
   * Obtiene el prompt de personalidad
   */
  private getPersonalityPrompt(personality: AgentConfig['personality']): string {
    const personalities = {
      friendly: 'Tienes una personalidad amigable, cálida y cercana. Usa un tono conversacional y empático.',
      formal: 'Tienes una personalidad formal y profesional. Usa un tono respetuoso y estructurado.',
      professional: 'Tienes una personalidad profesional y eficiente. Sé claro, directo y orientado a resultados.',
      casual: 'Tienes una personalidad casual y relajada. Usa un tono informal pero respetuoso.',
    };

    return personalities[personality] || personalities.friendly;
  }

  /**
   * Construye la descripción de herramientas disponibles
   */
  private buildToolsDescription(toolDefinitions: ToolDefinition[]): string {
    if (toolDefinitions.length === 0) {
      return 'No tienes herramientas disponibles en este momento.';
    }

    let description = 'HERRAMIENTAS DISPONIBLES:\n\n';
    for (const tool of toolDefinitions) {
      description += `- ${tool.name}: ${tool.description}\n`;
      // Agregar información sobre parámetros si existen
      if (tool.parameters?.properties && Object.keys(tool.parameters.properties).length > 0) {
        const requiredParams = tool.parameters.required || [];
        const paramDescriptions = Object.entries(tool.parameters.properties)
          .map(([key, value]: [string, any]) => {
            const required = requiredParams.includes(key) ? ' (requerido)' : ' (opcional)';
            return `  - ${key}${required}: ${value.description || value.type || 'string'}`;
          })
          .join('\n');
        description += `  Parámetros:\n${paramDescriptions}\n`;
      }
    }

    description += '\nIMPORTANTE: Usa estas herramientas cuando el usuario solicite información o acciones que requieran datos externos. Si hay herramientas personalizadas disponibles, úsalas cuando sean relevantes para la consulta del usuario.';

    return description;
  }

  /**
   * Construye el prompt de políticas
   */
  private buildPoliciesPrompt(policies: AgentConfig['policies']): string {
    let prompt = 'POLÍTICAS:\n';
    prompt += `- Umbral de confianza para usar herramientas: ${(policies.toolUseThreshold * 100).toFixed(0)}%\n`;
    
    if (policies.allowExternalApi) {
      prompt += '- Puedes usar APIs externas cuando sea necesario.\n';
    } else {
      prompt += '- NO uses APIs externas.\n';
    }

    if (policies.maxToolCallsPerMessage) {
      prompt += `- Máximo ${policies.maxToolCallsPerMessage} llamadas a herramientas por mensaje.\n`;
    }

    return prompt;
  }

  /**
   * Obtiene el prompt del sistema personalizado
   */
  private getSystemPrompt(systemPrompt?: string): string {
    if (!systemPrompt || systemPrompt.trim() === '') {
      return '';
    }
    return `${systemPrompt}\n`;
  }

  /**
   * Extrae información de contexto de los últimos mensajes
   * Útil para resolver anáforas (ej: "agregalo", "ese producto", "la mesa que encontraste")
   */
  public extractContext(lastMessages: ConversationMessage[]): {
    mentionedProducts?: string[];
    mentionedOrders?: string[];
    lastAction?: any;
    lastSearchResults?: any[];
    contextSummary?: string;
  } {
    const context: {
      mentionedProducts?: string[];
      mentionedOrders?: string[];
      lastAction?: any;
      lastSearchResults?: any[];
      contextSummary?: string;
    } = {};

    for (const msg of lastMessages) {
      // Extraer productos mencionados
      if (msg.action?.type === 'show_product' || msg.action?.type === 'add_to_cart') {
        if (!context.mentionedProducts) {
          context.mentionedProducts = [];
        }
        const productId = msg.action.payload?.productId || msg.action.payload?.id;
        if (productId) {
          context.mentionedProducts.push(productId);
        }
      }

      // Extraer resultados de búsqueda (search_product)
      if (msg.action?.type === 'search_product' && msg.action.payload?.products) {
        context.lastSearchResults = msg.action.payload.products;
        // También extraer IDs de productos encontrados
        if (!context.mentionedProducts) {
          context.mentionedProducts = [];
        }
        const products = msg.action.payload.products;
        for (const product of products) {
          const productId = product._id?.toString() || product.id || product.slug;
          if (productId && !context.mentionedProducts.includes(productId)) {
            context.mentionedProducts.push(productId);
          }
        }
      }

      // Extraer órdenes mencionadas
      if (msg.action?.type === 'get_order') {
        if (!context.mentionedOrders) {
          context.mentionedOrders = [];
        }
        const orderId = msg.action.payload?.orderId;
        if (orderId) {
          context.mentionedOrders.push(orderId);
        }
      }

      // Guardar última acción
      if (msg.action) {
        context.lastAction = msg.action;
      }
    }

    // Construir resumen de contexto para el LLM
    const summaryParts: string[] = [];
    
    if (context.lastSearchResults && context.lastSearchResults.length > 0) {
      const productList = context.lastSearchResults.slice(0, 5).map((p: any, idx: number) => {
        const name = p.title || p.name || 'Producto';
        const price = p.price?.regular || p.price?.sale || p.price || 'N/A';
        return `${idx + 1}. ${name} (ID: ${p._id?.toString() || p.id || p.slug}) - S/ ${price}`;
      }).join('\n');
      summaryParts.push(`PRODUCTOS ENCONTRADOS RECIENTEMENTE:\n${productList}`);
    }

    if (context.mentionedProducts && context.mentionedProducts.length > 0) {
      summaryParts.push(`Productos mencionados en la conversación: ${context.mentionedProducts.join(', ')}`);
    }

    if (summaryParts.length > 0) {
      context.contextSummary = summaryParts.join('\n\n');
    }

    return context;
  }
}

