import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  addDoc,
  doc,
  serverTimestamp,
  writeBatch,
  increment,
  getDoc
} from 'firebase/firestore';
import { db as firestore } from '../services/firebase';
import { db as dexie } from '../services/db';
import { StockTransfer } from '../types';
import { useEffect } from 'react';

export function useStockTransfers(storeId?: string) {
  const queryClient = useQueryClient();

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['stock-transfers', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const cached = await dexie.stockTransfers.where('storeId').equals(storeId).toArray();
      if (cached.length > 0) {
        return cached.sort((a: any, b: any) => b.createdAt - a.createdAt) as StockTransfer[];
      }

      // Fallback
      try {
        const { getDocs } = await import('firebase/firestore');
        const q = query(
          collection(firestore, 'stock_transfers'), 
          where('storeId', '==', storeId)
        );
        const snapshot = await getDocs(q);
        const liveData = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        } as StockTransfer));

        if (liveData.length > 0) {
          await dexie.stockTransfers.where('storeId').equals(storeId).delete();
          await dexie.stockTransfers.bulkAdd(liveData.map(t => ({ ...t, synced: true })));
          return liveData.sort((a: any, b: any) => b.createdAt - a.createdAt);
        }
      } catch (err) {
        console.warn("useStockTransfers: Offline fallback on stock transfers", err);
      }
      return [];
    },
    enabled: !!storeId,
  });

  useEffect(() => {
    if (!storeId) return;

    const q = query(
      collection(firestore, 'stock_transfers'), 
      where('storeId', '==', storeId)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const liveData = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as StockTransfer));

      try {
        await dexie.stockTransfers.where('storeId').equals(storeId).delete();
        if (liveData.length > 0) {
          await dexie.stockTransfers.bulkAdd(liveData.map(t => ({ ...t, synced: true })));
        }
      } catch (e) {
        console.error("useStockTransfers: Dexie sync failed", e);
      }

      queryClient.setQueryData(['stock-transfers', storeId], liveData);
    }, (error) => {
      console.warn("useStockTransfers: Real-time stock_transfers listener offline or failed", error.message);
    });

    return () => unsubscribe();
  }, [storeId, queryClient]);

  const transferStockMutation = useMutation({
    mutationFn: async (transfer: Omit<StockTransfer, 'id' | 'createdAt'>) => {
      const batch = writeBatch(firestore);
      
      const fromStockId = `${transfer.productId}_${transfer.fromLocationId}`;
      const toStockId = `${transfer.productId}_${transfer.toLocationId}`;
      
      const fromRef = doc(firestore, 'inventory_location_stock', fromStockId);
      const toRef = doc(firestore, 'inventory_location_stock', toStockId);
      
      // Verify source stock
      const fromSnap = await getDoc(fromRef);
      if (!fromSnap.exists() || fromSnap.data().quantity < transfer.quantity) {
        throw new Error('Insufficient stock in source location');
      }

      // Deduct from source
      batch.update(fromRef, {
        quantity: increment(-transfer.quantity),
        updatedAt: serverTimestamp()
      });

      // Add to destination
      batch.set(toRef, {
        productId: transfer.productId,
        inventoryLocationId: transfer.toLocationId,
        quantity: increment(transfer.quantity),
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Record transfer
      const transferRef = doc(collection(firestore, 'stock_transfers'));
      batch.set(transferRef, {
        ...transfer,
        createdAt: serverTimestamp()
      });

      await batch.commit();
      return transferRef.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers', storeId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    }
  });

  return {
    transfers,
    isLoading,
    transferStock: transferStockMutation.mutateAsync,
  };
}
