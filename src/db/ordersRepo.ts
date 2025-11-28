import { Collection, ObjectId } from 'mongodb';
import { DatabaseManager } from './databaseManager.js';

export interface OrderProduct {
  productId: string;
  id: string;
  title: string;
  image: string;
  qty: number;
  price_regular: number;
  price_sale: number;
  valid_price: number;
  slug: string;
  isValid: boolean;
}

export interface ClientInfo {
  doc: string;
  name: string;
  email: string;
  phone: string;
}

export interface PaymentStatus {
  typeStatus: string; // 'completed' | 'pending' | 'failed' | 'refunded'
  message: string;
  date: Date;
  methodPayment: string; // 'credit_card' | 'cash' | 'transfer' | etc.
  _id?: ObjectId;
}

export interface OrderStatus {
  typeStatus: string; // 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
  message: string;
  date: string | Date;
  _id?: ObjectId;
}

export interface Order {
  _id?: ObjectId;
  domain: string; // Equivalente a tenantId
  products: OrderProduct[];
  clientInfo: ClientInfo;
  billingInfo: ClientInfo;
  shippingInfo: ClientInfo;
  paymentStatus: PaymentStatus;
  total: number;
  currency: string; // 'PEN' | 'USD' | etc.
  orderStatus: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  orderNumber: string;
  __v?: number;
}

/**
 * Repositorio para gestionar órdenes
 */
export class OrdersRepo {
  private collection: Collection<Order>;
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    const orderDb = dbManager.getDb().client.db('data-creceidea');
    this.collection = orderDb.collection<Order>('orders');
  }

  /**
   * Obtiene una orden por ID (ObjectId) o orderNumber
   * @param domain - Dominio del tenant (ej: "inversionesvargas.creceidea.pe")
   * @param identifier - Puede ser _id (ObjectId) o orderNumber
   */
  public async getById(domain: string, identifier: string): Promise<Order | null> {
    // Intentar buscar por _id primero
    if (ObjectId.isValid(identifier)) {
      const order = await this.collection.findOne({
        _id: new ObjectId(identifier),
        domain,
      });
      if (order) return order;
    }

    // Si no se encuentra por _id, buscar por orderNumber
    return this.collection.findOne({
      domain,
      orderNumber: identifier,
    });
  }

  /**
   * Obtiene órdenes de un usuario (por email o teléfono en clientInfo)
   * @param domain - Dominio del tenant
   * @param userIdentifier - Email o teléfono del cliente
   * @param limit - Número máximo de resultados
   */
  public async getByUser(
    domain: string,
    userIdentifier: string,
    limit: number = 10
  ): Promise<Order[]> {
    return this.collection
      .find({
        domain,
        $or: [
          { 'clientInfo.email': userIdentifier },
          { 'clientInfo.phone': userIdentifier },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Obtiene órdenes por estado de pago
   */
  public async getByPaymentStatus(
    domain: string,
    paymentStatus: string,
    limit: number = 10
  ): Promise<Order[]> {
    return this.collection
      .find({
        domain,
        'paymentStatus.typeStatus': paymentStatus,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Obtiene órdenes por estado de orden
   */
  public async getByOrderStatus(
    domain: string,
    orderStatus: string,
    limit: number = 10
  ): Promise<Order[]> {
    return this.collection
      .find({
        domain,
        'orderStatus.typeStatus': orderStatus,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Crea una nueva orden
   */
  public async create(order: Omit<Order, '_id' | 'createdAt' | 'updatedAt' | '__v'>): Promise<Order> {
    const newOrder: Order = {
      ...order,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    };

    const result = await this.collection.insertOne(newOrder);
    return { ...newOrder, _id: result.insertedId };
  }

  /**
   * Actualiza el estado de pago de una orden
   */
  public async updatePaymentStatus(
    domain: string,
    orderNumber: string,
    paymentStatus: Partial<PaymentStatus>
  ): Promise<Order | null> {
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (paymentStatus.typeStatus) {
      updateData['paymentStatus.typeStatus'] = paymentStatus.typeStatus;
    }
    if (paymentStatus.message !== undefined) {
      updateData['paymentStatus.message'] = paymentStatus.message;
    }
    if (paymentStatus.methodPayment) {
      updateData['paymentStatus.methodPayment'] = paymentStatus.methodPayment;
    }
    if (paymentStatus.date) {
      updateData['paymentStatus.date'] = paymentStatus.date;
    }

    const result = await this.collection.findOneAndUpdate(
      { domain, orderNumber },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Actualiza el estado de orden
   */
  public async updateOrderStatus(
    domain: string,
    orderNumber: string,
    orderStatus: Partial<OrderStatus>
  ): Promise<Order | null> {
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (orderStatus.typeStatus) {
      updateData['orderStatus.typeStatus'] = orderStatus.typeStatus;
    }
    if (orderStatus.message !== undefined) {
      updateData['orderStatus.message'] = orderStatus.message;
    }
    if (orderStatus.date) {
      updateData['orderStatus.date'] = orderStatus.date;
    }

    const result = await this.collection.findOneAndUpdate(
      { domain, orderNumber },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Obtiene el carrito activo de un usuario (orden con orderStatus.typeStatus = 'pending')
   * Busca por email o teléfono del cliente
   */
  public async getActiveCart(domain: string, userIdentifier: string): Promise<Order | null> {
    return this.collection.findOne({
      domain,
      'orderStatus.typeStatus': 'pending',
      $or: [
        { 'clientInfo.email': userIdentifier },
        { 'clientInfo.phone': userIdentifier },
      ],
    });
  }

  /**
   * Actualiza los productos de una orden
   */
  public async updateProducts(
    domain: string,
    orderNumber: string,
    products: OrderProduct[]
  ): Promise<Order | null> {
    // Recalcular total
    const total = products.reduce((sum, p) => sum + p.valid_price * p.qty, 0);

    const result = await this.collection.findOneAndUpdate(
      { domain, orderNumber },
      {
        $set: {
          products,
          total,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Genera un orderNumber único
   */
  public generateOrderNumber(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${timestamp}${random}`;
  }
}

