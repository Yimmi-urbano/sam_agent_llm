import { AgentConfig, ToolConfig, CustomTool } from '../db/agentConfigRepo.js';
import { ProductsRepo } from '../db/productsRepo.js';
import { OrdersRepo } from '../db/ordersRepo.js';
import { RAGService } from '../services/ragService.js';
import { ExternalApiService } from '../services/externalApiService.js';
import { logger } from '../utils/logger.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  needsUserInput?: boolean; // Indica que se necesita información del usuario
  question?: string; // Pregunta sugerida para el usuario
}

export type ToolExecutor = (args: Record<string, any>, context: ToolContext) => Promise<ToolResult>;

export interface ToolContext {
  tenantId: string;
  userId: string;
  conversationId: string;
  agentConfig: AgentConfig;
}

/**
 * Registry dinámico de herramientas
 * Permite registrar y ejecutar tools por tenant
 */
export class ToolRegistry {
  private tools: Map<string, ToolExecutor> = new Map();
  private productsRepo: ProductsRepo;
  private ordersRepo: OrdersRepo;
  private ragService: RAGService;
  private externalApiService: ExternalApiService;

  constructor(
    productsRepo: ProductsRepo,
    ordersRepo: OrdersRepo,
    ragService: RAGService,
    externalApiService: ExternalApiService
  ) {
    this.productsRepo = productsRepo;
    this.ordersRepo = ordersRepo;
    this.ragService = ragService;
    this.externalApiService = externalApiService;

    // Registrar herramientas core
    this.registerCoreTools();
  }

  /**
   * Registra las herramientas core del sistema
   */
  private registerCoreTools(): void {
    this.registerTool('search_product', this.searchProduct.bind(this));
    this.registerTool('add_to_cart', this.addToCart.bind(this));
    this.registerTool('get_order', this.getOrder.bind(this));
    this.registerTool('show_product', this.showProduct.bind(this));
    this.registerTool('rag_query', this.ragQuery.bind(this));
    this.registerTool('external_api', this.externalApi.bind(this));
  }

  /**
   * Registra una nueva herramienta
   */
  public registerTool(name: string, executor: ToolExecutor): void {
    this.tools.set(name, executor);
  }

  /**
   * Obtiene la definición de todas las herramientas habilitadas para un tenant
   */
  public getToolDefinitions(agentConfig: AgentConfig): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    const mode = agentConfig.tools.mode || 'default'; // default: 'default'

    // Core tools (solo si mode es 'default' o 'hybrid')
    if (mode === 'default' || mode === 'hybrid') {
      // search_product
      if (agentConfig.tools.searchProduct?.enabled) {
      definitions.push({
        name: 'search_product',
        description: 'Busca productos en el catálogo por nombre, descripción o categoría',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Término de búsqueda',
            },
            limit: {
              type: 'number',
              description: 'Número máximo de resultados (default: 10)',
            },
          },
          required: ['query'],
        },
      });
    }

    // add_to_cart
    if (agentConfig.tools.addToCart?.enabled) {
      definitions.push({
        name: 'add_to_cart',
        description: 'Agrega un producto al carrito del usuario',
        parameters: {
          type: 'object',
          properties: {
            productId: {
              type: 'string',
              description: 'ID del producto a agregar',
            },
            quantity: {
              type: 'number',
              description: 'Cantidad a agregar (default: 1)',
            },
          },
          required: ['productId'],
        },
      });
    }

    // get_order
    if (agentConfig.tools.getOrder?.enabled) {
      definitions.push({
        name: 'get_order',
        description: 'Obtiene información de una orden. Si no tienes el número de orden, pregunta al usuario por su email, teléfono o número de orden antes de usar esta herramienta.',
        parameters: {
          type: 'object',
          properties: {
            orderId: {
              type: 'string',
              description: 'ID de la orden (ObjectId)',
            },
            orderNumber: {
              type: 'string',
              description: 'Número de orden (ej: "17405329519752tYdTn9")',
            },
            email: {
              type: 'string',
              description: 'Email del cliente para buscar órdenes',
            },
            phone: {
              type: 'string',
              description: 'Teléfono del cliente para buscar órdenes',
            },
          },
        },
      });
    }

    // show_product
    if (agentConfig.tools.searchProduct?.enabled) {
      definitions.push({
        name: 'show_product',
        description: 'Muestra detalles de un producto específico',
        parameters: {
          type: 'object',
          properties: {
            productId: {
              type: 'string',
              description: 'ID del producto',
            },
          },
          required: ['productId'],
        },
      });
    }

    // rag_query
    if (agentConfig.knowledge.companyInfo?.source === 'rag' || 
        agentConfig.knowledge.products?.source === 'rag') {
      definitions.push({
        name: 'rag_query',
        description: 'Consulta información usando RAG (Retrieval Augmented Generation)',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Consulta a realizar',
            },
            source: {
              type: 'string',
              description: 'Fuente de conocimiento: companyInfo o products',
              enum: ['companyInfo', 'products'],
            },
          },
          required: ['query'],
        },
      });
    }
    }

    // Custom tools (solo si mode es 'custom' o 'hybrid')
    if ((mode === 'custom' || mode === 'hybrid') && agentConfig.tools.custom) {
      for (const customTool of agentConfig.tools.custom) {
        // Validar que el campo enabled exista y sea true
        const isEnabled = customTool.enabled === true;
        
        // Validar campos requeridos
        if (!customTool.name || !customTool.baseUrl) {
          continue;
        }
        
        // Solo agregar si está habilitado
        if (isEnabled) {
          definitions.push({
            name: customTool.name,
            description: customTool.description || `Custom tool: ${customTool.name}`,
            parameters: customTool.parameters || {
              type: 'object',
              properties: {},
            },
          });
        }
      }
    }

    return definitions;
  }

  /**
   * Ejecuta una herramienta
   */
  public async executeTool(
    toolName: string,
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolResult> {
    // Verificar si es una custom tool
    const customTool = this.findCustomTool(toolName, context.agentConfig);
    
    if (customTool) {
      // Ejecutar custom tool dinámicamente
      const result = await this.executeCustomTool(customTool, args, context);
      if (!result.success) {
        logger.warn('Custom tool execution failed', {
          toolName,
          error: result.error,
        });
      }
      return result;
    }

    // Buscar executor de core tool
    const executor = this.tools.get(toolName);

    if (!executor) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
      };
    }

    try {
      const result = await executor(args, context);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing tool: ${toolName}`, error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Busca una custom tool por nombre (método privado)
   */
  private findCustomTool(toolName: string, agentConfig: AgentConfig): CustomTool | null {
    if (!agentConfig.tools.custom) {
      return null;
    }

    const foundTool = agentConfig.tools.custom.find(
      tool => tool.name === toolName
    );

    if (!foundTool || foundTool.enabled !== true) {
      return null;
    }

    return foundTool;
  }

  /**
   * Busca una custom tool por nombre (método público para uso externo)
   */
  public findCustomToolByName(toolName: string, agentConfig: AgentConfig): CustomTool | null {
    return this.findCustomTool(toolName, agentConfig);
  }

  /**
   * Ejecuta una custom tool dinámicamente
   */
  private async executeCustomTool(
    customTool: CustomTool,
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolResult> {
    // Validar campos requeridos
    if (!customTool.baseUrl) {
      logger.error('Custom tool missing baseUrl', {
        name: customTool.name,
      });
      return {
        success: false,
        error: `Custom tool "${customTool.name}" is missing baseUrl`,
      };
    }

    try {

      // Construir URL
      let url: string;
      if (customTool.path) {
        // Reemplazar variables en el path (ej: {studentId} -> valor real)
        let path = customTool.path;
        for (const [key, value] of Object.entries(args)) {
          path = path.replace(`{${key}}`, String(value));
        }
        url = `${customTool.baseUrl}${path}`;
      } else {
        url = `${customTool.baseUrl}/${customTool.name}`;
      }

      // Determinar método HTTP
      const method = customTool.method || 'POST';

      // Preparar body según el método
      let body: any = undefined;
      let queryParams: Record<string, string> = {};

      if (method === 'GET') {
        // Para GET, los args van como query params
        for (const [key, value] of Object.entries(args)) {
          if (!customTool.path || !customTool.path.includes(`{${key}}`)) {
            queryParams[key] = String(value);
          }
        }
        const queryString = new URLSearchParams(queryParams).toString();
        if (queryString) {
          // Verificar si la URL ya tiene parámetros de query
          const separator = url.includes('?') ? '&' : '?';
          url += `${separator}${queryString}`;
        }
      } else {
        // Para POST, PUT, DELETE, los args van en el body
        body = args;
      }

      // Ejecutar la llamada
      const response = await this.externalApiService.fetch(url, {
        method,
        body,
        apiKeyEncrypted: customTool.apiKeyEncrypted,
      });

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing custom tool: ${customTool.name}`, error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ========== Implementaciones de herramientas core ==========

  private async searchProduct(args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { query = '', limit = 10 } = args;

    // Si query está vacío o es "*", buscar todos los productos disponibles
    const searchQuery = (!query || query.trim() === '' || query === '*') ? '' : query.trim();

    const toolConfig = context.agentConfig.tools.searchProduct;
    if (!toolConfig?.enabled) {
      return { success: false, error: 'search_product tool is not enabled' };
    }

    try {
      let products;

      switch (toolConfig.type) {
        case 'mongodb':
          // Usar domain (tenantId) para buscar productos
          products = await this.productsRepo.search(context.tenantId, searchQuery, limit);
          break;
        case 'api':
          // Llamar a API externa
          const apiConfig = context.agentConfig.knowledge.products;
          if (apiConfig?.apiUrl) {
            products = await this.externalApiService.fetchProducts(
              context.tenantId,
              apiConfig.apiUrl,
              apiConfig.apiKeyEncrypted,
              { query: searchQuery, limit }
            );
          } else {
            return { success: false, error: 'API URL not configured for products' };
          }
          break;
        case 'rag':
          // Usar RAG para búsqueda
          const ragResult = await this.ragService.query(
            context.tenantId,
            searchQuery,
            context.agentConfig.knowledge.products?.vectorIndex
          );
          products = ragResult.data;
          break;
        default:
          // Default: MongoDB
          products = await this.productsRepo.search(context.tenantId, searchQuery, limit);
      }

      return {
        success: true,
        data: {
          products: products || [],
          count: products?.length || 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async addToCart(args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { productId, quantity = 1 } = args;

    if (!productId) {
      return { success: false, error: 'productId parameter is required' };
    }

    try {
      // Obtener producto usando domain como tenantId
      const product = await this.productsRepo.getById(context.tenantId, productId);
      if (!product) {
        return { success: false, error: `Product not found: ${productId}` };
      }

      // Obtener precio (considera precio de venta si existe)
      const productPrice = this.productsRepo.getProductPrice(product);
      const productIdStr = product._id?.toString() || productId;

      // Buscar carrito activo usando userId como identificador (email o phone)
      // Nota: En producción, deberías tener información del cliente en el contexto
      let cart = await this.ordersRepo.getActiveCart(context.tenantId, context.userId);

      if (!cart) {
        // Crear nuevo carrito con estructura del nuevo schema
        const orderNumber = this.ordersRepo.generateOrderNumber();
        const defaultClientInfo = {
          doc: '',
          name: '',
          email: context.userId.includes('@') ? context.userId : `${context.userId}@temp.com`,
          phone: context.userId.includes('@') ? '' : context.userId,
        };

        cart = await this.ordersRepo.create({
          domain: context.tenantId,
          products: [],
          clientInfo: defaultClientInfo,
          billingInfo: defaultClientInfo,
          shippingInfo: defaultClientInfo,
          paymentStatus: {
            typeStatus: 'pending',
            message: '',
            date: new Date(),
            methodPayment: '',
          },
          total: 0,
          currency: 'PEN',
          orderStatus: {
            typeStatus: 'pending',
            message: '',
            date: '',
          },
          orderNumber,
        });
      }

      // Buscar si el producto ya está en el carrito
      const existingProductIndex = cart.products.findIndex(
        (p) => p.productId === productIdStr || p.id === productIdStr
      );

      if (existingProductIndex >= 0) {
        // Incrementar cantidad
        cart.products[existingProductIndex].qty += quantity;
        cart.products[existingProductIndex].valid_price = productPrice;
      } else {
        // Agregar nuevo producto al carrito
        cart.products.push({
          productId: productIdStr,
          id: productIdStr,
          title: product.title || 'Producto sin nombre',
          image: this.productsRepo.getProductImage(product) || '',
          qty: quantity,
          price_regular: product.price?.regular || productPrice,
          price_sale: product.price?.sale || 0,
          valid_price: productPrice,
          slug: product.slug || '',
          isValid: true,
        });
      }

      // Recalcular total
      cart.total = cart.products.reduce(
        (sum, p) => sum + p.valid_price * p.qty,
        0
      );

      // Actualizar carrito en la base de datos
      const updatedCart = await this.ordersRepo.updateProducts(
        context.tenantId,
        cart.orderNumber,
        cart.products
      );

      if (!updatedCart) {
        return {
          success: false,
          error: 'Failed to update cart',
        };
      }

      return {
        success: true,
        data: {
          message: `Producto ${product.title} agregado al carrito`,
          cart: {
            orderNumber: cart.orderNumber,
            products: cart.products,
            total: cart.total,
            currency: cart.currency,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getOrder(args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { orderId, orderNumber, email, phone } = args;

    try {
      let order: any = null;

      // Priorizar orderNumber si está disponible
      if (orderNumber) {
        order = await this.ordersRepo.getById(context.tenantId, orderNumber);
      } else if (orderId) {
        // orderId puede ser _id o orderNumber
        order = await this.ordersRepo.getById(context.tenantId, orderId);
      } else if (email || phone) {
        // Buscar por email o teléfono
        const userIdentifier = email || phone;
        const orders = await this.ordersRepo.getByUser(context.tenantId, userIdentifier, 1);
        if (orders.length > 0) {
          order = orders[0]; // Tomar la más reciente
        }
      } else {
        // No hay información suficiente - necesitamos preguntar al usuario
        return {
          success: false,
          needsUserInput: true,
          question: 'Para buscar tu orden, necesito alguna de estas informaciones: número de orden, tu email o tu teléfono. ¿Cuál puedes proporcionarme?',
          error: 'Missing required information: orderNumber, orderId, email, or phone',
        };
      }

      if (!order) {
        return {
          success: false,
          needsUserInput: true,
          question: 'No encontré ninguna orden con esa información. ¿Podrías verificar el número de orden, email o teléfono?',
          error: 'Order not found',
        };
      }

      return {
        success: true,
        data: {
          orderNumber: order.orderNumber,
          products: order.products,
          total: order.total,
          currency: order.currency,
          paymentStatus: order.paymentStatus,
          orderStatus: order.orderStatus,
          clientInfo: order.clientInfo,
          createdAt: order.createdAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async showProduct(args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { productId } = args;

    if (!productId) {
      return { success: false, error: 'productId parameter is required' };
    }

    try {
      const product = await this.productsRepo.getById(context.tenantId, productId);

      if (!product) {
        return { success: false, error: `Product not found: ${productId}` };
      }

      // Formatear producto para la respuesta
      const formattedProduct = {
        id: product._id?.toString(),
        title: product.title,
        slug: product.slug,
        description: product.description_short || product.description_long,
        price: this.productsRepo.getProductPrice(product),
        regularPrice: product.price.regular,
        salePrice: product.price.sale,
        image: this.productsRepo.getProductImage(product),
        category: product.category?.[0]?.slug,
        isAvailable: product.is_available,
        stock: product.stock,
      };

      return {
        success: true,
        data: formattedProduct,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async ragQuery(args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { query, source = 'companyInfo' } = args;

    if (!query) {
      return { success: false, error: 'query parameter is required' };
    }

    try {
      const knowledgeConfig = context.agentConfig.knowledge[source];
      if (!knowledgeConfig || knowledgeConfig.source !== 'rag') {
        return { success: false, error: `RAG not configured for source: ${source}` };
      }

      const result = await this.ragService.query(
        context.tenantId,
        query,
        knowledgeConfig.vectorIndex
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async externalApi(args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    // Implementación genérica para custom tools
    // Se puede extender según necesidades específicas
    return {
      success: false,
      error: 'External API tool execution not fully implemented',
    };
  }
}

