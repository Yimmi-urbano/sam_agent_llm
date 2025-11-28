import { Collection, ObjectId } from 'mongodb';
import { DatabaseManager } from './databaseManager.js';
import { logger } from '../utils/logger.js';

export interface LLMConfig {
  provider: 'openai' | 'gemini' | 'groq';
  model: string;
  apiKeyEncrypted: string;
  temperature?: number;
  maxTokens?: number;
}

export interface KnowledgeSource {
  source: 'rag' | 'api' | 'mongodb';
  vectorIndex?: string;
  apiUrl?: string;
  apiKeyEncrypted?: string;
}

export interface KnowledgeConfig {
  companyInfo?: KnowledgeSource;
  products?: KnowledgeSource;
  [key: string]: KnowledgeSource | undefined;
}

export interface ToolConfig {
  enabled: boolean;
  type?: 'mongodb' | 'api' | 'rag';
  [key: string]: any;
}

export interface CustomTool {
  name: string;
  baseUrl: string;
  path?: string; // Ruta específica de la API (ej: "/api/students/{studentId}")
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; // Método HTTP (default: POST)
  apiKeyEncrypted?: string;
  enabled: boolean;
  description?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface PlanConfig {
  type: 'free' | 'basic' | 'pro' | 'enterprise';
  monthlyLimit: number;
  usedThisMonth: number;
  renewsAt: Date;
}

export interface PoliciesConfig {
  allowExternalApi: boolean;
  toolUseThreshold: number; // 0-1, umbral de confianza para usar tools
  maxToolCallsPerMessage?: number;
}

export interface AudioConfig {
  tts: 'aws-polly' | 'elevenlabs' | 'disabled';
  voiceId?: string;
  enabled: boolean;
  // Credenciales para AWS Polly (encriptadas)
  awsAccessKeyIdEncrypted?: string;
  awsSecretAccessKeyEncrypted?: string;
  awsRegion?: string;
  // Credenciales para ElevenLabs (encriptadas)
  elevenlabsApiKeyEncrypted?: string;
}

export interface AgentConfig {
  _id?: ObjectId;
  tenantId: string;
  agentId: string;
  name_agent?: string;
  llm: LLMConfig;
  knowledge: KnowledgeConfig;
  tools: {
    mode?: 'default' | 'custom' | 'hybrid'; // default: 'default'
    searchProduct?: ToolConfig;
    addToCart?: ToolConfig;
    getOrder?: ToolConfig;
    custom?: CustomTool[];
  };
  plan: PlanConfig;
  policies: PoliciesConfig;
  personality: 'friendly' | 'formal' | 'professional' | 'casual';
  audio: AudioConfig;
  systemPrompt: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repositorio para gestionar configuraciones de agentes
 */
export class AgentConfigRepo {
  private collection: Collection<AgentConfig>;
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    this.collection = dbManager.getCollection<AgentConfig>('agentConfigs');
  }

  /**
   * Crea una nueva configuración de agente
   */
  public async create(config: Omit<AgentConfig, '_id' | 'createdAt' | 'updatedAt'>): Promise<AgentConfig> {
    const agentConfig: AgentConfig = {
      ...config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.collection.insertOne(agentConfig);
    return { ...agentConfig, _id: result.insertedId };
  }

  /**
   * Obtiene la configuración de un agente por tenantId y agentId
   */
  public async getByTenantAndAgent(
    tenantId: string,
    agentId: string
  ): Promise<AgentConfig | null> {
    const result = await this.collection.findOne({ tenantId, agentId });
    return result;
  }

  /**
   * Obtiene la configuración por tenantId (usa el agente por defecto si no se especifica)
   */
  public async getByTenant(tenantId: string, agentId: string = 'default'): Promise<AgentConfig | null> {
    return this.getByTenantAndAgent(tenantId, agentId);
  }

  /**
   * Actualiza una configuración existente
   */
  public async update(
    tenantId: string,
    agentId: string,
    updates: Partial<Omit<AgentConfig, '_id' | 'tenantId' | 'agentId' | 'createdAt'>>,
  ): Promise<AgentConfig | null> {
    const result = await this.collection.findOneAndUpdate(
      { tenantId, agentId },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (result) {
      logger.info(`Agent config updated: ${tenantId}/${agentId}`);
    }

    return result;
  }

  /**
   * Elimina una configuración
   */
  public async delete(tenantId: string, agentId: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ tenantId, agentId });
    logger.info(`Agent config deleted: ${tenantId}/${agentId}`);
    return result.deletedCount > 0;
  }

  /**
   * Lista todas las configuraciones de un tenant
   */
  public async listByTenant(tenantId: string): Promise<AgentConfig[]> {
    return this.collection.find({ tenantId }).toArray();
  }

  /**
   * Incrementa el contador de uso mensual
   */
  public async incrementUsage(tenantId: string, agentId: string, amount: number = 1): Promise<void> {
    const config = await this.getByTenantAndAgent(tenantId, agentId);
    if (!config) {
      throw new Error(`Agent config not found: ${tenantId}/${agentId}`);
    }

    // Verificar si necesita renovación mensual
    const now = new Date();
    if (config.plan.renewsAt < now) {
      // Renovar plan
      const nextRenewal = new Date(now);
      nextRenewal.setMonth(nextRenewal.getMonth() + 1);

      await this.update(tenantId, agentId, {
        plan: {
          ...config.plan,
          usedThisMonth: amount,
          renewsAt: nextRenewal,
        },
      });
    } else {
      // Incrementar uso
      await this.update(tenantId, agentId, {
        plan: {
          ...config.plan,
          usedThisMonth: config.plan.usedThisMonth + amount,
        },
      });
    }
  }

  /**
   * Verifica si el tenant ha excedido su límite mensual
   */
  public async checkUsageLimit(tenantId: string, agentId: string): Promise<{
    allowed: boolean;
    used: number;
    limit: number;
    remaining: number;
  }> {
    const config = await this.getByTenantAndAgent(tenantId, agentId);
    if (!config) {
      throw new Error(`Agent config not found: ${tenantId}/${agentId}`);
    }

    const used = config.plan.usedThisMonth;
    const limit = config.plan.monthlyLimit;
    const remaining = Math.max(0, limit - used);

    return {
      allowed: used < limit,
      used,
      limit,
      remaining,
    };
  }

  /**
   * Crea índices para optimizar búsquedas
   */
  public async createIndexes(): Promise<void> {
    await this.collection.createIndex({ tenantId: 1, agentId: 1 }, { unique: true });
    await this.collection.createIndex({ tenantId: 1 });
    logger.info('AgentConfig indexes created');
  }
}

