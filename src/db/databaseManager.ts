import { MongoClient, Db, Collection, Document } from 'mongodb';
import { logger } from '../utils/logger.js';

export interface DatabaseConfig {
  uri: string;
  dbName: string;
  options?: {
    maxPoolSize?: number;
    minPoolSize?: number;
    connectTimeoutMS?: number;
  };
}

/**
 * DatabaseManager multitenant
 * Soporta conexiones separadas por tenant o collections con tenantId filter
 */
export class DatabaseManager {
  private static instance: DatabaseManager;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private tenantConnections: Map<string, Db> = new Map();
  private config: DatabaseConfig;

  private constructor(config: DatabaseConfig) {
    this.config = config;
  }

  public static getInstance(config?: DatabaseConfig): DatabaseManager {
    if (!DatabaseManager.instance) {
      if (!config) {
        throw new Error('DatabaseManager requires config on first initialization');
      }
      DatabaseManager.instance = new DatabaseManager(config);
    }
    return DatabaseManager.instance;
  }

  /**
   * Conecta a la base de datos principal
   */
  public async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      this.client = new MongoClient(this.config.uri, {
        maxPoolSize: this.config.options?.maxPoolSize || 10,
        minPoolSize: this.config.options?.minPoolSize || 2,
        connectTimeoutMS: this.config.options?.connectTimeoutMS || 30000,
      });

      await this.client.connect();
      this.db = this.client.db(this.config.dbName);
      logger.info(`Connected to MongoDB: ${this.config.dbName}`);
    } catch (error) {
      logger.error('Failed to connect to MongoDB', error);
      throw error;
    }
  }

  /**
   * Obtiene la base de datos principal
   */
  public getDb(): Db {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Obtiene una colección con filtro automático por tenantId
   * Todas las queries deben incluir tenantId en el filtro
   */
  public getCollection<T extends Document = Document>(collectionName: string, tenantId?: string): Collection<T> {
    const db = this.getDb();
    const collection = db.collection<T>(collectionName);

    // Si se proporciona tenantId, podemos crear un proxy que automáticamente
    // añada el filtro tenantId a todas las queries
    if (tenantId) {
      return this.createTenantScopedCollection(collection, tenantId);
    }

    return collection;
  }

  /**
   * Crea una colección con scope de tenant (añade tenantId automáticamente)
   */
  private createTenantScopedCollection<T extends Document>(
    collection: Collection<T>,
    tenantId: string
  ): Collection<T> {
    // Proxy para interceptar métodos y añadir tenantId
    return new Proxy(collection, {
      get: (target, prop) => {
        const originalMethod = target[prop as keyof Collection<T>];

        if (typeof originalMethod === 'function') {
          return (...args: any[]) => {
            // Métodos que necesitan filtro tenantId
            const methodsWithFilter = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'countDocuments', 'deleteMany', 'updateMany'];

            if (methodsWithFilter.includes(prop as string)) {
              // Añadir tenantId al filtro
              if (args[0] && typeof args[0] === 'object') {
                args[0] = { ...args[0], tenantId };
              } else {
                args[0] = { tenantId };
              }
            }

            // Métodos de inserción/actualización que necesitan añadir tenantId al documento
            if (prop === 'insertOne' || prop === 'insertMany') {
              if (args[0]) {
                if (Array.isArray(args[0])) {
                  args[0] = args[0].map((doc: any) => ({ ...doc, tenantId }));
                } else {
                  args[0] = { ...args[0], tenantId };
                }
              }
            }

            if (prop === 'updateOne' || prop === 'updateMany' || prop === 'replaceOne') {
              if (args[0] && typeof args[0] === 'object') {
                args[0] = { ...args[0], tenantId };
              }
            }

            return (originalMethod as any).apply(target, args);
          };
        }

        return originalMethod;
      },
    }) as Collection<T>;
  }

  /**
   * Obtiene una conexión dedicada para un tenant específico
   * Útil para casos donde se requiere aislamiento completo
   */
  public async getTenantDb(tenantId: string, tenantDbName?: string): Promise<Db> {
    if (this.tenantConnections.has(tenantId)) {
      return this.tenantConnections.get(tenantId)!;
    }

    // Por defecto, usar la misma DB pero con collections separadas
    // Para aislamiento completo, se puede usar una DB diferente por tenant
    const dbName = tenantDbName || `${this.config.dbName}_${tenantId}`;
    const db = this.getDb().client.db(dbName);
    this.tenantConnections.set(tenantId, db);

    return db;
  }

  /**
   * Desconecta todas las conexiones
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.tenantConnections.clear();
    }
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      if (!this.db) {
        return false;
      }
      await this.db.admin().ping();
      return true;
    } catch (error) {
      logger.error('Database health check failed', error);
      return false;
    }
  }
}

