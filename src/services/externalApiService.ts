import { decryptApiKey } from '../utils/encryption.js';
import { logger } from '../utils/logger.js';

/**
 * Servicio para llamar a APIs externas
 * Soporta autenticación con API keys
 */
export class ExternalApiService {
  /**
   * Realiza una petición HTTP genérica
   */
  public async fetch(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: any;
      apiKeyEncrypted?: string;
    } = {}
  ): Promise<any> {
    const { method = 'GET', headers = {}, body, apiKeyEncrypted } = options;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    // Añadir API key si está disponible
    if (apiKeyEncrypted) {
      try {
        const apiKey = decryptApiKey(apiKeyEncrypted);
        requestHeaders['Authorization'] = `Bearer ${apiKey}`;
      } catch (error) {
        logger.error('Error decrypting API key for external API', error);
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`External API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Error calling external API', { url, error });
      throw error;
    }
  }

  /**
   * Busca productos en una API externa
   */
  public async fetchProducts(
    tenantId: string,
    apiUrl: string,
    apiKeyEncrypted?: string,
    params?: {
      query?: string;
      limit?: number;
      category?: string;
    }
  ): Promise<any[]> {
    const url = new URL(apiUrl);
    if (params?.query) {
      url.searchParams.set('q', params.query);
    }
    if (params?.limit) {
      url.searchParams.set('limit', params.limit.toString());
    }
    if (params?.category) {
      url.searchParams.set('category', params.category);
    }

    const response = await this.fetch(url.toString(), {
      method: 'GET',
      apiKeyEncrypted,
    });

    // Normalizar respuesta según formato esperado
    if (Array.isArray(response)) {
      return response;
    } else if (response.products && Array.isArray(response.products)) {
      return response.products;
    } else if (response.data && Array.isArray(response.data)) {
      return response.data;
    }

    return [];
  }

  /**
   * Ejecuta un custom tool definido en agentConfig
   */
  public async executeCustomTool(
    baseUrl: string,
    apiKeyEncrypted: string | undefined,
    toolName: string,
    args: Record<string, any>
  ): Promise<any> {
    const url = `${baseUrl}/${toolName}`;
    return this.fetch(url, {
      method: 'POST',
      body: args,
      apiKeyEncrypted,
    });
  }
}

