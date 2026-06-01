import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  setDoc,
  doc,
  serverTimestamp,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { db as firestore, handleFirestoreError, OperationType } from '../services/firebase';
import { db as dexie } from '../services/db';
import { InventoryLocationStock } from '../types';
import { useEffect } from 'react';

export function useInventoryStock(storeId?: string, productId?: string) {
  const queryClient = useQueryClient();

  const { data: stock = [], isLoading } = useQuery({
    queryKey: ['inventory-stock', storeId, productId],
    queryFn: async () => {
      if (!storeId) return [];
      let coll;
      if (productId) {
        coll = dexie.inventoryLocationStock.where('productId').equals(productId);
      } else {
        coll = dexie.inventoryLocationStock;
      }
      const cached = (await coll.toArray()) as InventoryLocationStock[];
      if (cached.length > 0) {
        return cached;
      }

      // Fallback network fetch if cache is empty
      try {
        const path = 'inventory_location_stock';
        const q = productId 
          ? query(collection(firestore, path), where('productId', '==', productId))
          : query(collection(firestore, path));
        const snapshot = await getDocs(q);
        const liveData = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        } as InventoryLocationStock));

        if (liveData.length > 0) {
          if (productId) {
            await dexie.inventoryLocationStock.where('productId').equals(productId).delete();
          }
          await dexie.inventoryLocationStock.bulkPut(liveData.map(s => ({ ...s, synced: true })));
          return liveData;
        }
      } catch (err) {
        console.warn("useInventoryStock: Offline / unable to fetch stock data remotely on first render", err);
      }
      return [];
    },
    enabled: !!storeId,
  });

  useEffect(() => {
    if (!storeId) return;

    const path = 'inventory_location_stock';
    const q = productId 
      ? query(collection(firestore, path), where('productId', '==', productId))
      : query(collection(firestore, path));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const rawList = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as InventoryLocationStock));
      const liveData = Array.from(new Map(rawList.map(s => [s.id, s])).values());

      try {
        if (productId) {
          await dexie.inventoryLocationStock.where('productId').equals(productId).delete();
        }
        if (liveData.length > 0) {
          await dexie.inventoryLocationStock.bulkPut(liveData.map(s => ({ ...s, synced: true })));
        }
      } catch (e) {
        console.error("useInventoryStock: Dexie cache write failed", e);
      }

      queryClient.setQueryData(['inventory-stock', storeId, productId], liveData);
    }, (error) => {
      console.warn("useInventoryStock: Real-time listener offline or failed", error.message);
    });

    return () => unsubscribe();
  }, [storeId, productId, queryClient]);

  const updateStockMutation = useMutation({
    mutationFn: async ({ productId, locationId, quantity, lowStockThreshold }: { 
      productId: string, 
      locationId: string, 
      quantity: number,
      lowStockThreshold?: number
    }) => {
      const stockId = `${productId}_${locationId}`;
      const docRef = doc(firestore, 'inventory_location_stock', stockId);
      
      await setDoc(docRef, {
        productId,
        inventoryLocationId: locationId,
        quantity,
        lowStockThreshold: lowStockThreshold ?? 10,
        updatedAt: serverTimestamp()
      }, { merge: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    }
  });

  return {
    stock,
    isLoading,
    updateStock: updateStockMutation.mutateAsync,
  };
}
