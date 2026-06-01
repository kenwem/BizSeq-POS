import Dexie, { Table } from 'dexie';
import { Product, Sale, InventoryLocation, InventoryLocationStock, StockTransfer } from '../types';
import { Customer } from '../hooks/useCustomers';
import { Supplier, SupplierTransaction } from '../types/supplier';

export class BizSeqDB extends Dexie {
  products!: Table<Product & { synced: boolean }>;
  sales!: Table<Sale & { synced: boolean }>;
  customers!: Table<Customer & { synced: boolean }>;
  suppliers!: Table<Supplier & { synced: boolean }>;
  supplierTransactions!: Table<SupplierTransaction & { synced: boolean }>;
  inventoryLocations!: Table<InventoryLocation & { synced: boolean }>;
  inventoryLocationStock!: Table<InventoryLocationStock & { synced: boolean }>;
  stockTransfers!: Table<StockTransfer & { synced: boolean }>;
  syncQueue!: Table<{
    id?: number;
    action: 'create' | 'update' | 'delete';
    collection: string;
    data: any;
    timestamp: number;
  }>;

  constructor() {
    super('BizSeqDB');
    this.version(4).stores({
      products: '++id, name, barcode, sku, category, storeId, synced',
      sales: '++id, storeId, cashierId, paymentMethod, createdAt, synced',
      customers: '++id, name, phone, storeId, synced',
      suppliers: '++id, name, phone, storeId, synced',
      supplierTransactions: '++id, supplierId, storeId, reference, synced',
      inventoryLocations: '++id, name, storeId, synced',
      inventoryLocationStock: '++id, productId, inventoryLocationId, synced',
      stockTransfers: '++id, productId, fromLocationId, toLocationId, storeId, synced',
      syncQueue: '++id, collection, action, timestamp'
    });
  }
}

export const db = new BizSeqDB();
