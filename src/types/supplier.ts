export interface ProductSuppliedEntry {
  productName: string;
  quantity: string; // "5 kg", "50 pieces" etc.
  price: string;    // unit price as a string for typing UX
  date: string;     // ISO String
}

export interface Supplier {
  id: string;
  storeId: string;
  name: string;
  email?: string;
  phone: string; // mapping phone consistently
  whatsappNumber?: string;
  address?: string;
  productsSupplied?: string; // string or JSON array
  paymentTerms?: string;
  creditLimit?: number;
  totalAmount?: number;
  balance: number; // sum(purchases) - sum(payments)
  notes?: string;
  status: 'active' | 'inactive';
  createdAt: any;
  updatedAt?: any;
}

export interface SupplierTransaction {
  id: string;
  supplierId: string;
  storeId: string;
  type: 'purchase' | 'payment'; // purchase increases debt, payment reduces debt
  amount: number;
  date: any; // Date, Timestamp, or ISO string
  reference: string; // TRANS-... or PAY-... links related events
  notes?: string;
  // productSupplied as JSON array string or a list
  productSupplied?: string; 
  createdBy: string;
  createdAt: any;
  updatedAt?: any;
}

export interface SupplierTransactionFormData {
  type: 'purchase' | 'payment';
  amount: number;
  amountPaid: number;
  productSupplied: ProductSuppliedEntry[];
  notes?: string;
}
