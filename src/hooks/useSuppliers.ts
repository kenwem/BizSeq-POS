import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db as firestore } from '../services/firebase';
import { db as dexie } from '../services/db';
import { Supplier, SupplierTransaction } from '../types/supplier';

export * from '../types/supplier';

// Custom utility to format date safe for indexing / storing
const formatFirebaseDate = (date: any): any => {
  if (!date) return new Date().toISOString();
  if (typeof date === 'object') {
    if (typeof date.toDate === 'function') {
      return date.toDate().toISOString();
    }
    if (typeof date.seconds === 'number') {
      return new Date(date.seconds * 1000).toISOString();
    }
  }
  if (date instanceof Date) return date.toISOString();
  if (typeof date === 'string') return date;
  
  // If it's a Firestore FieldValue or anything else, return a safe ISO string
  return new Date().toISOString();
};

export function useSuppliers(storeId?: string) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(firestore, 'suppliers'),
      where('storeId', '==', storeId)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const rawList = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }) as Supplier);
      
      const live = Array.from(new Map(rawList.map(s => [s.id, s])).values());
      setSuppliers(live);
      
      // Sync to local Dexie Cache
      try {
        await dexie.suppliers.where('storeId').equals(storeId).delete();
        for (const item of live) {
          await dexie.suppliers.put({ ...item, synced: true });
        }
      } catch (err) {
        console.error("useSuppliers storage cache sync error:", err);
      }
      
      localStorage.setItem(`cached_suppliers_${storeId}`, JSON.stringify(live));
      setIsLoading(false);
    }, async (error) => {
      console.warn("useSuppliers: Real-time listener offline or failed", error.message);
      
      // Load from Dexie cache first
      try {
        const cachedDex = await dexie.suppliers.where('storeId').equals(storeId).toArray();
        if (cachedDex && cachedDex.length > 0) {
          setSuppliers(cachedDex);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error("useSuppliers read cache error:", err);
      }

      // Fallback to localStorage
      const cached = localStorage.getItem(`cached_suppliers_${storeId}`);
      if (cached) {
        try {
          setSuppliers(JSON.parse(cached));
        } catch (e) {
          console.error("useSuppliers: Cached parse failed", e);
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [storeId]);

  const addSupplier = async (
    data: Omit<Supplier, 'id' | 'createdAt' | 'balance'>,
    totalAmount: number = 0,
    partPayment: number = 0,
    products: any[] = []
  ) => {
    const initialBalance = totalAmount - partPayment;
    
    // 1. Create Supplier Document
    const supRef = await addDoc(collection(firestore, 'suppliers'), {
      ...data,
      productsSupplied: products.length > 0 ? JSON.stringify(products) : '',
      balance: initialBalance,
      totalAmount: totalAmount,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const supplierId = supRef.id;

    // Save to local cache immediately to prevent flickers
    const localItem: Supplier = {
      id: supplierId,
      storeId: data.storeId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      whatsappNumber: data.whatsappNumber,
      address: data.address,
      productsSupplied: products.length > 0 ? JSON.stringify(products) : '',
      paymentTerms: data.paymentTerms,
      creditLimit: data.creditLimit,
      totalAmount: totalAmount,
      balance: initialBalance,
      notes: data.notes,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    await dexie.suppliers.put({ ...localItem, synced: true });

    // 2. Add Transactions if totalAmount > 0 (Trigger in parallel to boost speed)
    if (totalAmount > 0) {
      const reference = `TRANS-${Date.now()}`;
      
      // Purchase record
      const purchaseTx = {
        supplierId,
        storeId: data.storeId,
        type: 'purchase' as const,
        amount: totalAmount,
        date: new Date().toISOString(),
        reference,
        notes: data.notes || 'Initial product supply purchase',
        productSupplied: products.length > 0 ? JSON.stringify(products) : '',
        createdBy: data.email || 'system',
        createdAt: serverTimestamp()
      };
      
      const purchasePromise = addDoc(collection(firestore, 'suppliers', supplierId, 'transactions'), purchaseTx)
        .then(async (pTxRef) => {
          await dexie.supplierTransactions.put({
            id: pTxRef.id,
            ...purchaseTx,
            date: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            synced: true
          });
        });

      let paymentPromise = Promise.resolve();
      if (partPayment > 0) {
        const paymentTx = {
          supplierId,
          storeId: data.storeId,
          type: 'payment' as const,
          amount: partPayment,
          date: new Date().toISOString(),
          reference,
          notes: 'Initial supply part payment',
          createdBy: data.email || 'system',
          createdAt: serverTimestamp()
        };
        paymentPromise = addDoc(collection(firestore, 'suppliers', supplierId, 'transactions'), paymentTx)
          .then(async (payTxRef) => {
            await dexie.supplierTransactions.put({
              id: payTxRef.id,
              ...paymentTx,
              date: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              synced: true
            });
          });
      }

      // Execute Firestore writes concurrently
      await Promise.all([purchasePromise, paymentPromise]);
    }

    return supRef;
  };

  const updateSupplier = async (id: string, data: Partial<Supplier>) => {
    // Only update profile fields, stripping totalAmount, partPayment, balance fields
    const cleanData: any = { ...data };
    delete cleanData.totalAmount;
    delete cleanData.partPayment;
    delete cleanData.balance;
    delete cleanData.createdAt;
    delete cleanData.id;

    // Write to Firestore
    const ref = doc(firestore, 'suppliers', id);
    await updateDoc(ref, {
      ...cleanData,
      updatedAt: serverTimestamp()
    });

    // Write to cache
    const existing = await dexie.suppliers.get(id);
    if (existing) {
      await dexie.suppliers.put({
        ...existing,
        ...cleanData,
        updatedAt: new Date().toISOString()
      });
    }
  };

  const deleteSupplier = async (id: string) => {
    await deleteDoc(doc(firestore, 'suppliers', id));
    await dexie.suppliers.delete(id);
    await dexie.supplierTransactions.where('supplierId').equals(id).delete();
  };

  return { suppliers, isLoading, addSupplier, updateSupplier, deleteSupplier };
}

export function useSupplierTransactions(supplierId?: string, storeId?: string) {
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!supplierId) {
      setTransactions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Set loading state to true for the new fetch
    setIsLoading(true);
    setError(null);

    const q = query(
      collection(firestore, 'suppliers', supplierId, 'transactions')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const rawList = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          ...d,
          date: formatFirebaseDate(d.date || d.createdAt)
        } as SupplierTransaction;
      });

      // Sort chronological descending (newest first) client-side to avoid index requirements or null-timestamp evaluation issues on initial local optimistic write
      const sortedList = rawList.sort((a, b) => {
        const timeA = a.createdAt?.seconds 
          ? a.createdAt.seconds * 1000 
          : (a.createdAt && typeof a.createdAt === 'string') 
            ? new Date(a.createdAt).getTime()
            : new Date(a.date || 0).getTime();
        const timeB = b.createdAt?.seconds 
          ? b.createdAt.seconds * 1000 
          : (b.createdAt && typeof b.createdAt === 'string') 
            ? new Date(b.createdAt).getTime()
            : new Date(b.date || 0).getTime();
        return timeB - timeA;
      });

      setTransactions(sortedList);
      setError(null);

      // Sync local Dexie cache
      try {
        await dexie.supplierTransactions.where('supplierId').equals(supplierId).delete();
        for (const item of sortedList) {
          await dexie.supplierTransactions.put({ ...item, synced: true });
        }
      } catch (err) {
        console.error("useSupplierTransactions cache write error:", err);
      }

      localStorage.setItem(`cached_sup_txs_${supplierId}`, JSON.stringify(sortedList));
      setIsLoading(false);
    }, async (error) => {
      console.error("useSupplierTransactions real-time subscription error:", error);
      console.warn("useSupplierTransactions offline fallback activated:", error.message);
      setError(error);

      // Retrieve from Dexie
      try {
        const cachedDex = await dexie.supplierTransactions.where('supplierId').equals(supplierId).toArray();
        if (cachedDex && cachedDex.length > 0) {
          setTransactions(cachedDex);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error("useSupplierTransactions cache read error:", err);
      }

      // Fallback to localStorage
      const cached = localStorage.getItem(`cached_sup_txs_${supplierId}`);
      if (cached) {
        try {
          setTransactions(JSON.parse(cached));
        } catch (e) {
          console.error("useSupplierTransactions parse fallback error:", e);
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [supplierId]);

  const addTransaction = async (
    createdBy: string,
    txData: {
      type: 'purchase' | 'payment';
      amount: number;
      amountPaid: number;
      productSupplied: any[];
      notes?: string;
    }
  ) => {
    if (!supplierId || !storeId) throw new Error("Missing supplier/store identity");

    const runTimestamp = Date.now();
    const reference = txData.type === 'purchase' ? `TRANS-${runTimestamp}` : `PAY-${runTimestamp}`;

    // Read current supplier state from Dexie first (virtually instantaneous: <1ms)
    const supplierSnap = await dexie.suppliers.get(supplierId);
    if (!supplierSnap) {
      throw new Error("Unable to locate active supplier record in local database cache");
    }

    if (txData.type === 'payment') {
      // Balance Payment mode
      const paymentTx = {
        supplierId,
        storeId,
        type: 'payment' as const,
        amount: txData.amountPaid, // amount paid towards balance
        date: new Date().toISOString(),
        reference,
        notes: txData.notes || 'Balance Payment',
        createdBy,
        createdAt: serverTimestamp()
      };

      const newBalance = Math.max(0, supplierSnap.balance - txData.amountPaid);
      const supplierDocRef = doc(firestore, 'suppliers', supplierId);

      // Execute both Firestore writes and updates concurrently to minimize delay
      await Promise.all([
        addDoc(collection(firestore, 'suppliers', supplierId, 'transactions'), paymentTx)
          .then(async (payRef) => {
            await dexie.supplierTransactions.put({
              id: payRef.id,
              ...paymentTx,
              date: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              synced: true
            });
          }),
        updateDoc(supplierDocRef, {
          balance: newBalance,
          updatedAt: serverTimestamp()
        }).then(async () => {
          await dexie.suppliers.update(supplierId, { balance: newBalance });
        })
      ]);
    } else {
      // New Purchase Transaction (+ optional part payment)
      const purchaseTx = {
        supplierId,
        storeId,
        type: 'purchase' as const,
        amount: txData.amount, // purchase amount
        date: new Date().toISOString(),
        reference,
        notes: txData.notes || 'Product purchase transaction',
        productSupplied: txData.productSupplied.length > 0 ? JSON.stringify(txData.productSupplied) : '',
        createdBy,
        createdAt: serverTimestamp()
      };

      const netDebtIncrease = txData.amount - txData.amountPaid;
      const newBalance = supplierSnap.balance + netDebtIncrease;
      const supplierDocRef = doc(firestore, 'suppliers', supplierId);

      // Create purchase transaction doc
      const purchasePromise = addDoc(collection(firestore, 'suppliers', supplierId, 'transactions'), purchaseTx)
        .then(async (prchRef) => {
          await dexie.supplierTransactions.put({
            id: prchRef.id,
            ...purchaseTx,
            date: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            synced: true
          });
        });

      // Create payment transaction doc (if amountPaid > 0)
      let paymentPromise = Promise.resolve();
      if (txData.amountPaid > 0) {
        const paymentTx = {
          supplierId,
          storeId,
          type: 'payment' as const,
          amount: txData.amountPaid,
          date: new Date().toISOString(),
          reference,
          notes: `Paid towards purchase: ${reference}`,
          createdBy,
          createdAt: serverTimestamp()
        };
        paymentPromise = addDoc(collection(firestore, 'suppliers', supplierId, 'transactions'), paymentTx)
          .then(async (payRef) => {
            await dexie.supplierTransactions.put({
              id: payRef.id,
              ...paymentTx,
              date: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              synced: true
            });
          });
      }

      // Update supplier balance
      const updateSupplierPromise = updateDoc(supplierDocRef, {
        balance: newBalance,
        updatedAt: serverTimestamp()
      }).then(async () => {
        await dexie.suppliers.update(supplierId, { balance: newBalance });
      });

      // Execute all three remote Firestore operations concurrently to minimize delay
      await Promise.all([purchasePromise, paymentPromise, updateSupplierPromise]);
    }
  };

  return { transactions, isLoading, error, addTransaction };
}
