import { Collection, ObjectId } from 'mongodb';
import { DatabaseManager } from './databaseManager.js';
import { logger } from '../utils/logger.js';

export interface ConversationMessage {
  _id?: ObjectId;
  tenantId: string;
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  audioUrl?: string;
  action?: {
    type: string;
    payload: any;
  };
  metadata?: {
    model?: string;
    tokens?: number;
    latency?: number;
    toolsUsed?: string[];
  };
  createdAt: Date;
}

export interface Conversation {
  _id?: ObjectId;
  tenantId: string;
  userId: string;
  conversationId: string;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repositorio para gestionar conversaciones
 * Política: mantener últimos 2 mensajes por user+tenant para contexto
 */
export class ConversationsRepo {
  private collection: Collection<ConversationMessage>;
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    this.collection = dbManager.getCollection<ConversationMessage>('conversations');
  }

  /**
   * Guarda un mensaje en la conversación
   */
  public async saveMessage(
    tenantId: string,
    userId: string,
    conversationId: string,
    message: Omit<ConversationMessage, '_id' | 'tenantId' | 'userId' | 'conversationId' | 'createdAt'>
  ): Promise<ConversationMessage> {
    const conversationMessage: ConversationMessage = {
      ...message,
      tenantId,
      userId,
      conversationId,
      createdAt: new Date(),
    };

    const result = await this.collection.insertOne(conversationMessage);
    return { ...conversationMessage, _id: result.insertedId };
  }

  /**
   * Obtiene los últimos N mensajes de una conversación
   * Por defecto: últimos 2 mensajes (política del sistema)
   */
  public async getLastMessages(
    tenantId: string,
    userId: string,
    conversationId: string,
    limit: number = 2
  ): Promise<ConversationMessage[]> {
    const messages = await this.collection
      .find({
        tenantId,
        userId,
        conversationId,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Invertir para tener orden cronológico
    return messages.reverse();
  }

  /**
   * Obtiene todos los mensajes de una conversación
   */
  public async getConversationMessages(
    tenantId: string,
    userId: string,
    conversationId: string
  ): Promise<ConversationMessage[]> {
    return this.collection
      .find({
        tenantId,
        userId,
        conversationId,
      })
      .sort({ createdAt: 1 })
      .toArray();
  }

  /**
   * Crea o actualiza una conversación
   */
  public async upsertConversation(
    tenantId: string,
    userId: string,
    conversationId: string
  ): Promise<void> {
    const conversationsCollection = this.dbManager.getCollection<Conversation>('conversation_metadata');

    await conversationsCollection.updateOne(
      { tenantId, userId, conversationId },
      {
        $set: {
          tenantId,
          userId,
          conversationId,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  /**
   * Elimina mensajes antiguos (mantener solo últimos N por conversación)
   * Útil para limpieza periódica
   */
  public async cleanupOldMessages(
    tenantId: string,
    keepLast: number = 2
  ): Promise<number> {
    const conversations = await this.collection.distinct('conversationId', { tenantId });

    let deletedCount = 0;

    for (const conversationId of conversations) {
      const messages = await this.collection
        .find({ tenantId, conversationId })
        .sort({ createdAt: -1 })
        .toArray();

      if (messages.length > keepLast) {
        const toDelete = messages.slice(keepLast);
        const idsToDelete = toDelete.map((m) => m._id!);

        const result = await this.collection.deleteMany({
          _id: { $in: idsToDelete },
          tenantId,
        });

        deletedCount += result.deletedCount;
      }
    }

    return deletedCount;
  }

  /**
   * Obtiene estadísticas de conversaciones por tenant
   */
  public async getConversationStats(tenantId: string): Promise<{
    totalMessages: number;
    totalConversations: number;
    lastMessageAt?: Date;
  }> {
    const totalMessages = await this.collection.countDocuments({ tenantId });
    const totalConversations = await this.collection.distinct('conversationId', { tenantId }).then((ids) => ids.length);

    const lastMessage = await this.collection
      .findOne(
        { tenantId },
        { sort: { createdAt: -1 } }
      );

    return {
      totalMessages,
      totalConversations,
      lastMessageAt: lastMessage?.createdAt,
    };
  }
}

