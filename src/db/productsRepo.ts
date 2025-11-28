import { Collection, ObjectId } from 'mongodb';
import { DatabaseManager } from './databaseManager.js';

export interface Product {
  _id?: ObjectId;
  domain: string; // Identificador del tenant (ej: "inversionesvargas.creceidea.pe")
  title: string;
  slug: string;
  description_short?: string;
  description_long?: string;
  price: {
    regular: number;
    sale: number;
    tag?: string;
  };
  type_product: string;
  image_default?: string[];
  stock?: number | null;
  category?: Array<{
    idcat: string;
    slug: string;
  }>;
  is_available: boolean;
  default_variations?: string[];
  is_trash?: {
    status: boolean;
    date: string;
  };
  order?: number;
  __v?: number;
}

/**
 * Repositorio para gestionar productos
 * Usa la base de datos "catalog-db" con el esquema real de productos
 */
export class ProductsRepo {
  private collection: Collection<Product>;
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    // Obtener la colección de productos de la base de datos catalog-db
    // Si no existe, usar la DB por defecto
    const catalogDb = dbManager.getDb().client.db('catalog-db');
    this.collection = catalogDb.collection<Product>('products');
  }

  /**
   * Busca productos por query (texto)
   * @param domain - Dominio del tenant (ej: "inversionesvargas.creceidea.pe")
   */
  public async search(
    domain: string,
    query: string,
    limit: number = 10
  ): Promise<Product[]> {
    // Si query está vacío, devolver todos los productos disponibles
    const filter: any = {
      domain,
      'is_trash.status': false, // Excluir productos eliminados
      is_available: true, // Solo productos disponibles
    };

    // Si hay query, agregar filtro de búsqueda
    if (query && query.trim() !== '') {
      filter.$or = [
        { title: { $regex: query, $options: 'i' } },
        { description_short: { $regex: query, $options: 'i' } },
        { description_long: { $regex: query, $options: 'i' } },
        { slug: { $regex: query, $options: 'i' } },
      ];
    }

    return this.collection
      .find(filter)
      .sort({ order: 1 }) // Ordenar por campo order
      .limit(limit)
      .toArray();
  }

  /**
   * Obtiene un producto por ID (ObjectId) o slug
   * @param domain - Dominio del tenant
   * @param identifier - Puede ser _id (ObjectId) o slug
   */
  public async getById(domain: string, identifier: string): Promise<Product | null> {
    // Intentar buscar por _id primero
    if (ObjectId.isValid(identifier)) {
      const product = await this.collection.findOne({
        _id: new ObjectId(identifier),
        domain,
        'is_trash.status': false,
      });
      if (product) return product;
    }

    // Si no se encuentra por _id, buscar por slug
    return this.collection.findOne({
      domain,
      slug: identifier,
      'is_trash.status': false,
    });
  }

  /**
   * Obtiene productos por categoría
   */
  public async getByCategory(
    domain: string,
    categorySlug: string,
    limit: number = 10
  ): Promise<Product[]> {
    return this.collection
      .find({
        domain,
        'category.slug': categorySlug,
        'is_trash.status': false,
        is_available: true,
      })
      .sort({ order: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Obtiene el precio de un producto (considera precio de venta si existe)
   */
  public getProductPrice(product: Product): number {
    return product.price.sale > 0 ? product.price.sale : product.price.regular;
  }

  /**
   * Obtiene la imagen principal de un producto
   */
  public getProductImage(product: Product): string | null {
    if (product.image_default && product.image_default.length > 0) {
      return product.image_default[0];
    }
    return null;
  }
}

