import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  getDocs
} from 'firebase/firestore';
import { db as firestore, handleFirestoreError, OperationType } from '../services/firebase';
import { db as dexie } from '../services/db';
import { InventoryLocation } from '../types';
import { useEffect } from 'react';

export function useInventoryLocations(storeId?: string) {
  const queryClient = useQueryClient();

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['inventory-locations', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const cached = await dexie.inventoryLocations.where('storeId').equals(storeId).toArray();
      if (cached.length > 0) {
        return cached as InventoryLocation[];
      }
      
      // Fallback
      try {
        const path = 'inventory_locations';
        const q = query(
          collection(firestore, path), 
          where('storeId', '==', storeId)
        );
        const snapshot = await getDocs(q);
        const liveData = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        } as InventoryLocation));

        if (liveData.length > 0) {
          await dexie.inventoryLocations.where('storeId').equals(storeId).delete();
          await dexie.inventoryLocations.bulkAdd(liveData.map(l => ({ ...l, synced: true })));
          return liveData;
        }
      } catch (err) {
        console.warn("useInventoryLocations: Offline fallback during initial locations loading.", err);
      }
      return [];
    },
    enabled: !!storeId,
  });

  useEffect(() => {
    if (!storeId) return;

    const path = 'inventory_locations';
    const q = query(
      collection(firestore, path), 
      where('storeId', '==', storeId)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const rawList = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as InventoryLocation));
      const liveData = Array.from(new Map(rawList.map(l => [l.id, l])).values());

      try {
        await dexie.inventoryLocations.where('storeId').equals(storeId).delete();
        if (liveData.length > 0) {
          await dexie.inventoryLocations.bulkPut(liveData.map(l => ({ ...l, synced: true })));
        }
      } catch (e) {
        console.error("useInventoryLocations: Dexie locations sync failed", e);
      }

      queryClient.setQueryData(['inventory-locations', storeId], liveData);
    }, (error) => {
      console.warn("useInventoryLocations: Real-time locations listener offline or failed", error.message);
    });

    return () => unsubscribe();
  }, [storeId, queryClient]);

  const addLocationMutation = useMutation({
    mutationFn: async (newLocation: Omit<InventoryLocation, 'id' | 'createdAt' | 'updatedAt'>) => {
      const docRef = await addDoc(collection(firestore, 'inventory_locations'), {
        ...newLocation,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return docRef.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-locations', storeId] });
    }
  });

  const updateLocationMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<InventoryLocation> & { id: string }) => {
      const docRef = doc(firestore, 'inventory_locations', id);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-locations', storeId] });
    }
  });

  return {
    locations,
    isLoading,
    addLocation: addLocationMutation.mutateAsync,
    updateLocation: updateLocationMutation.mutateAsync,
  };
}
