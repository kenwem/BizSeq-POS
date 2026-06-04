export type UserRole = 'super_admin' | 'store_admin' | 'manager' | 'staff' | 'cashier';

export interface Store {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: any;
  adminEmail?: string;
  taxRate?: number;
  serviceFee?: number;
}

export interface UserProfile {
  uid: string;
  username: string;
  email: string;
  role: UserRole;
  storeId: string;
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  createdAt: any;
}

export interface ProductUnit {
  name: string; // e.g., 'Piece', 'Carton'
  conversionRate: number; // e.g., 1 for piece, 12 for carton
  price: number;
  cost: number;
}

export interface InventoryLocation {
  id: string;
  storeId: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive';
  isDefaultSalesSource?: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface InventoryLocationStock {
  id: string; // generated id
  productId: string;
  inventoryLocationId: string;
  quantity: number;
  lowStockThreshold: number;
  updatedAt: any;
}

export interface StockTransfer {
  id: string;
  storeId: string;
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  transferredBy: string;
  notes?: string;
  createdAt: any;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  barcode: string;
  sku: string;
  price: number;
  cost: number;
  stock: number; // Total stock (sum of all locations)
  lowStockThreshold: number;
  category: string;
  imageUrl?: string;
  expiryDate?: string;
  productsPerCarton?: number; // New field for carton capacity
  packageType?: string; // e.g. 'Carton', 'Crate', 'Pack'
  packageCapacity?: number; // capacity value of the package
  units?: ProductUnit[]; // Optional variations
  baseUnit?: string; // Base Unit, e.g., 'Piece'
  defaultLocationId?: string; // New field
  createdAt: any;
  updatedAt: any;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  cost: number; // Snapshot cost at time of sale for profit calculation
  unitName?: string; // e.g., 'Carton'
  conversionRate?: number; // Package conversion rate factor
  total: number;
  inventoryLocationId: string; // New field
}

export type PaymentMethod = 'cash' | 'transfer' | 'pos' | 'credit';

export interface SplitPayment {
  method: PaymentMethod;
  amount: number;
}

export interface Sale {
  id: string;
  storeId: string;
  cashierId: string;
  cashierName: string;
  items: SaleItem[];
  subtotal: number;
  total: number;
  totalCost: number; // Sum of items (cost * quantity)
  totalProfit: number; // total - totalCost
  discount: number;
  paymentMethod: PaymentMethod | 'split';
  splitPayments?: SplitPayment[];
  tenderedAmount?: number;
  changeDue?: number;
  cashbackAmount?: number;
  customerId?: string;
  customerName?: string;
  status: 'completed' | 'voided';
  createdAt: any;
}

export interface InventoryLog {
  id: string;
  productId: string;
  storeId: string;
  userId: string;
  type: 'sale' | 'restock' | 'adjustment' | 'refund';
  quantity: number;
  timestamp: any;
}

export interface Expense {
  id: string;
  storeId: string;
  description: string;
  category: 'salaries' | 'bills' | 'other';
  amount: number;
  date: string;
  createdAt: any;
}

