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
  getDocs,
  setDoc
} from 'firebase/firestore';
import { db as firestore } from '../services/firebase';
import { db as dexie } from '../services/db';
import { Product } from '../types';
import { useEffect } from 'react';

export function useProducts(storeId?: string) {
  const queryClient = useQueryClient();

  // Query for products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', storeId],
    queryFn: async () => {
      if (!storeId) return [];
      
      // 1. Try to load from Dexie first (offline-first)
      const cached = await dexie.products.where('storeId').equals(storeId).toArray();
      
      if (cached.length > 0) {
        return cached as Product[];
      }

      // 2. Dual fallback: If cache is empty, dynamically pull from remote Firestore initially
      try {
        const q = query(
          collection(firestore, 'products'), 
          where('storeId', '==', storeId)
        );
        const snapshot = await getDocs(q);
        const liveData = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        } as Product));

        if (liveData.length > 0) {
          await dexie.products.where('storeId').equals(storeId).delete();
          await dexie.products.bulkAdd(liveData.map(p => ({ ...p, synced: true })));
          return liveData;
        }
      } catch (err) {
        console.warn("useProducts: Offline or unable to fetch remote products on first screen load.", err);
      }
      
      return [];
    },
    enabled: !!storeId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!storeId) return;

    const q = query(
      collection(firestore, 'products'), 
      where('storeId', '==', storeId)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const liveData = snapshot.docs.map(doc => {
        const data = doc.data();
        return { 
          id: doc.id, 
          ...data 
        } as Product;
      });

      // Self-healing validation constraint:
      // If any loaded product has an empty 'units' list but still contains variation/packaging metadata,
      // dynamically and silently update Firestore to heal and synchronize the record.
      const inconsistentProducts = liveData.filter(p => {
        const hasNoUnits = !p.units || p.units.length === 0;
        const hasStaleFormatting = !!(p.packageType || p.packageCapacity || p.productsPerCarton);
        return hasNoUnits && hasStaleFormatting;
      });

      if (inconsistentProducts.length > 0) {
        console.log(`[Self-Healing] Detected ${inconsistentProducts.length} inconsistent/orphaned variation records. Cleaning up...`);
        inconsistentProducts.forEach(async (p) => {
          try {
            const docRef = doc(firestore, 'products', p.id);
            await updateDoc(docRef, {
              packageType: null,
              packageCapacity: null,
              productsPerCarton: null,
              updatedAt: serverTimestamp()
            });
            console.log(`[Self-Healing] Successfully healed metadata for product: "${p.name}" (${p.id})`);
          } catch (err) {
            console.error(`[Self-Healing] Failed to heal metadata for product ${p.id}:`, err);
          }
        });
      }

      // Sync to Dexie
      try {
        await dexie.products.where('storeId').equals(storeId).delete();
        if (liveData.length > 0) {
          await dexie.products.bulkAdd(liveData.map(p => ({ ...p, synced: true })));
        }
      } catch (e) {
        console.error("useProducts: Dexie product sync failed", e);
      }

      // Update Query Cache
      queryClient.setQueryData(['products', storeId], liveData);
    }, (error) => {
      console.warn("useProducts: Real-time products listener offline or failed", error.message);
    });

    return () => unsubscribe();
  }, [storeId, queryClient]);

  // Mutations
  const addProductMutation = useMutation({
    mutationFn: async (newProduct: Omit<Product, 'id' | 'createdAt'>) => {
      // Complete variation replacement constraint:
      // If units is empty, completely clear packaging metadata so POS can never generate orphaned variations.
      const hasNoUnits = !newProduct.units || newProduct.units.length === 0;
      const sanitizedProduct = {
        ...newProduct,
        units: newProduct.units || [],
        ...(hasNoUnits ? {
          packageType: null,
          packageCapacity: null,
          productsPerCarton: null
        } : {})
      };

      // Create firestore document reference (fully synchronous, generates local ID)
      const docRef = doc(collection(firestore, 'products'));
      const id = docRef.id;

      // 1. Instantly write to Dexie local DB for immediate UI update
      try {
        await dexie.products.put({
          id,
          ...sanitizedProduct,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          synced: true
        } as any);
      } catch (e) {
        console.warn("useProducts: Dexie local add failed", e);
      }

      // 2. Race Firestore write against an 800ms timeout
      const firestorePromise = setDoc(docRef, {
        ...sanitizedProduct,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      try {
        await Promise.race([
          firestorePromise,
          new Promise((resolve) => setTimeout(resolve, 800))
        ]);
      } catch (err) {
        console.warn("useProducts: Firestore background creation was slow or offline", err);
      }

      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', storeId] });
    }
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Product> & { id: string }) => {
      // Complete variation replacement constraint:
      // If units is empty (or is being updated to be empty), clear packaging metadata to prevent orphans.
      const hasNoUnits = 'units' in updates && (!updates.units || updates.units.length === 0);
      const sanitizedUpdates = {
        ...updates,
        ...(hasNoUnits ? {
          packageType: null,
          packageCapacity: null,
          productsPerCarton: null
        } : {})
      };

      // 1. Instantly write update to Dexie local DB so UI changes immediately
      try {
        const existing = await dexie.products.get(id);
        if (existing) {
          await dexie.products.put({
            ...existing,
            ...sanitizedUpdates,
            updatedAt: new Date().toISOString(),
            synced: true
          });
        }
      } catch (e) {
        console.warn("useProducts: Dexie local update failed", e);
      }

      // 2. Race Firestore update against an 800ms timeout
      const docRef = doc(firestore, 'products', id);
      const firestorePromise = updateDoc(docRef, {
        ...sanitizedUpdates,
        updatedAt: serverTimestamp()
      });

      try {
        await Promise.race([
          firestorePromise,
          new Promise((resolve) => setTimeout(resolve, 800))
        ]);
      } catch (err) {
        console.warn("useProducts: Firestore background update was slow or offline", err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', storeId] });
    }
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      // 1. Instantly delete from Dexie
      try {
        await dexie.products.delete(id);
      } catch (e) {
        console.warn("useProducts: Dexie local delete failed", e);
      }

      // 2. Race Firestore deletion against an 800ms timeout
      const firestorePromise = deleteDoc(doc(firestore, 'products', id));
      try {
        await Promise.race([
          firestorePromise,
          new Promise((resolve) => setTimeout(resolve, 800))
        ]);
      } catch (err) {
        console.warn("useProducts: Firestore background delete was slow or offline", err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', storeId] });
    }
  });

  return {
    products,
    isLoading,
    addProduct: addProductMutation.mutateAsync,
    updateProduct: updateProductMutation.mutateAsync,
    deleteProduct: deleteProductMutation.mutateAsync,
    isSaving: addProductMutation.isPending || updateProductMutation.isPending,
  };
}
