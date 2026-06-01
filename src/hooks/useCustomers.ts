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
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../services/firebase';

export interface Customer {
  id: string;
  storeId: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  debt: number;
  totalSpent: number;
  lastVisit?: any;
  createdAt: any;
}

export function useCustomers(storeId?: string) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!storeId) return;

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', storeId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rawList = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }) as Customer);
      const live = Array.from(new Map(rawList.map(c => [c.id, c])).values());
      setCustomers(live);
      localStorage.setItem(`cached_customers_${storeId}`, JSON.stringify(live));
      setIsLoading(false);
    }, (error) => {
      console.warn("useCustomers: Real-time listener offline or failed", error.message);
      const cached = localStorage.getItem(`cached_customers_${storeId}`);
      if (cached) {
        try {
          setCustomers(JSON.parse(cached));
        } catch (e) {
          console.error("useCustomers: Cached parse failed", e);
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [storeId]);

  const addCustomer = async (data: Omit<Customer, 'id' | 'createdAt' | 'debt' | 'totalSpent'>) => {
    return addDoc(collection(db, 'customers'), {
      ...data,
      debt: 0,
      totalSpent: 0,
      createdAt: serverTimestamp()
    });
  };

  const updateCustomer = async (id: string, data: Partial<Customer>) => {
    const ref = doc(db, 'customers', id);
    return updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });
  };

  const deleteCustomer = async (id: string) => {
    return deleteDoc(doc(db, 'customers', id));
  };

  return { customers, isLoading, addCustomer, updateCustomer, deleteCustomer };
}
