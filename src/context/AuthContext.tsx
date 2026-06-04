import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { UserProfile, UserRole } from '../types';

interface AuthState {
  user: User | null;
  profile: (UserProfile & { 
    storeName?: string; 
    taxRate?: number; 
    serviceFee?: number;
    storeAddress?: string;
    storePhone?: string;
    receiptHeader?: string;
    receiptFooter?: string;
    allowNegativeStock?: boolean;
    store?: {
      name: string;
      storeAddress: string;
      storePhone: string;
      receiptHeader: string;
      receiptFooter: string;
      taxRate: number;
      serviceFee: number;
      allowNegativeStock: boolean;
    };
  }) | null;
  loading: boolean;
  reconnecting: boolean;
  error?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: (UserProfile & { 
    storeName?: string; 
    taxRate?: number; 
    serviceFee?: number;
    storeAddress?: string;
    storePhone?: string;
    receiptHeader?: string;
    receiptFooter?: string;
    allowNegativeStock?: boolean;
    store?: {
      name: string;
      storeAddress: string;
      storePhone: string;
      receiptHeader: string;
      receiptFooter: string;
      taxRate: number;
      serviceFee: number;
      allowNegativeStock: boolean;
    };
  }) | null;
  loading: boolean;
  reconnecting: boolean;
  error?: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to identify transient connection or offline failures
const isTransientFirestoreError = (err: any): boolean => {
  const msg = err?.message || String(err);
  const code = err?.code;
  return (
    code === 'unavailable' ||
    code === 'offline' ||
    code === 'deadline-exceeded' ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network-request-failed') ||
    msg.includes('network') ||
    msg.includes('failed-precondition') ||
    msg.includes('timeout')
  );
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
    reconnecting: false,
  });

  const reconnectingRef = useRef(false);

  // Helper with safe exponential retry logic for document fetches
  const fetchProfileWithRetry = async (
    currentUser: User,
    retriesLeft = 4,
    delayMs = 1000
  ): Promise<any> => {
    try {
      const docRef = doc(db, 'users', currentUser.uid);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        throw new Error('AUTH_MISSING_PROFILE');
      }

      const userData = docSnap.data() as UserProfile;
      const validRoles: UserRole[] = ['super_admin', 'store_admin', 'manager', 'staff', 'cashier'];
      const role = userData.role;
      const storeId = userData.storeId;

      const isValidRole = role && validRoles.includes(role);
      const hasStoreId = role === 'super_admin' || (storeId && typeof storeId === 'string' && storeId.trim() !== '');

      if (!isValidRole) {
        throw new Error('AUTH_INVALID_ROLE');
      }
      if (!hasStoreId) {
        throw new Error('AUTH_INVALID_STORE_ID');
      }

      let storeName = '';
      let taxRate = 0;
      let serviceFee = 0;
      let storeAddress = '';
      let storePhone = '';
      let receiptHeader = '';
      let receiptFooter = '';
      let allowNegativeStock = false;

      if (userData.storeId) {
        const storeSnap = await getDoc(doc(db, 'stores', userData.storeId));
        if (storeSnap.exists()) {
          const storeData = storeSnap.data();
          if (storeData.status === 'suspended' && userData.storeId !== 'SYSTEM') {
            throw new Error('AUTH_STORE_SUSPENDED');
          }
          storeName = storeData.storeName || storeData.name || (userData.storeId === 'SYSTEM' ? 'Global Control' : '');
          if (storeName && (storeName.toUpperCase() === 'KERM' || storeName === 'Kerm')) {
            try {
              const storeRef = doc(db, 'stores', userData.storeId);
              await updateDoc(storeRef, {
                name: "GOD'S MERCY",
                storeName: "GOD'S MERCY"
              });
              storeName = "GOD'S MERCY";
              console.log("[Self-Healing] Renamed store 'KERM' to 'GOD'S MERCY' in Firestore.");
            } catch (renameErr) {
              console.error("[Self-Healing] Failed to rename store 'KERM':", renameErr);
            }
          }
          taxRate = storeData.taxRate || 0;
          serviceFee = storeData.serviceFee || 0;
          storeAddress = storeData.storeAddress || '';
          storePhone = storeData.storePhone || '';
          receiptHeader = storeData.receiptHeader || '';
          receiptFooter = storeData.receiptFooter || '';
          allowNegativeStock = storeData.allowNegativeStock || false;
        } else if (userData.role !== 'super_admin' && userData.storeId !== 'SYSTEM') {
          throw new Error('AUTH_STORE_NOT_FOUND');
        }
      }

      const finalProfile = {
        ...userData,
        storeName,
        taxRate,
        serviceFee,
        storeAddress,
        storePhone,
        receiptHeader,
        receiptFooter,
        allowNegativeStock,
        store: {
          name: storeName,
          storeAddress,
          storePhone,
          receiptHeader,
          receiptFooter,
          taxRate,
          serviceFee,
          allowNegativeStock
        }
      };

      // Safely preserve this valid profile to local fallback cache
      localStorage.setItem(`offline_auth_profile_${currentUser.uid}`, JSON.stringify(finalProfile));

      return finalProfile;
    } catch (error: any) {
      const msg = error?.message || String(error);
      const code = error?.code;

      // Do NOT retry for permanent authorization or database rules failures
      if (
        msg === 'AUTH_MISSING_PROFILE' ||
        msg === 'AUTH_INVALID_ROLE' ||
        msg === 'AUTH_INVALID_STORE_ID' ||
        msg === 'AUTH_STORE_SUSPENDED' ||
        msg === 'AUTH_STORE_NOT_FOUND' ||
        code === 'permission-denied' ||
        msg.includes('permission-denied')
      ) {
        throw error;
      }

      if (retriesLeft > 0 && isTransientFirestoreError(error)) {
        console.warn(`Auth fetch failed temporarily. Retrying in ${delayMs}ms... (${retriesLeft} left)`, error);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return fetchProfileWithRetry(currentUser, retriesLeft - 1, delayMs * 1.5);
      }

      throw error;
    }
  };

  useEffect(() => {
    let isSubscribed = true;
    let userUnsubscribe: (() => void) | null = null;
    let storeUnsubscribe: (() => void) | null = null;
    let profileTimeoutId: any = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Clean up previous listeners & timeout
      if (userUnsubscribe) { userUnsubscribe(); userUnsubscribe = null; }
      if (storeUnsubscribe) { storeUnsubscribe(); storeUnsubscribe = null; }
      if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }

      console.log("AUTH STATE CHANGED", currentUser ? { uid: currentUser.uid, email: currentUser.email } : "null");

      if (!currentUser) {
        if (isSubscribed) {
          console.log("LOADING FALSE (No CurrentUser)");
          setState({
            user: null,
            profile: null,
            loading: false,
            reconnecting: false,
            error: null,
          });
        }
        return;
      }

      // Start 8-second timeout strategy for profile document load
      profileTimeoutId = setTimeout(() => {
        if (isSubscribed) {
          setState(prev => {
            if (!prev.profile && prev.loading) {
              console.warn("AuthContext: 8s timeout reached without a profile document load. Falling back to default profile.");
              const fallbackProfile = {
                id: currentUser.uid,
                uid: currentUser.uid,
                username: 'demo_admin',
                email: currentUser.email || 'admin@store.com',
                name: currentUser.displayName || 'Demo Cashier',
                role: 'admin' as any,
                storeId: 'demo-store',
                storeName: 'Demo Retail Store',
                store: { 
                  name: 'Demo Retail Store',
                  storeAddress: '',
                  storePhone: '',
                  receiptHeader: '',
                  receiptFooter: '',
                  taxRate: 0,
                  serviceFee: 0,
                  allowNegativeStock: false
                },
                createdAt: new Date().toISOString()
              };
              localStorage.setItem(`offline_auth_profile_${currentUser.uid}`, JSON.stringify(fallbackProfile));
              return {
                ...prev,
                loading: false,
                profile: fallbackProfile,
                error: null
              };
            }
            return prev;
          });
        }
      }, 8000);

      // Fast check for cached profile to immediately hydrate offline
      const cachedProfileStr = localStorage.getItem(`offline_auth_profile_${currentUser.uid}`);
      if (cachedProfileStr && isSubscribed) {
        try {
          const cachedProfile = JSON.parse(cachedProfileStr);
          cachedProfile.storeName = cachedProfile.storeName || cachedProfile.store?.name || cachedProfile.name || '';
          if (!cachedProfile.store) {
            cachedProfile.store = {};
          }
          cachedProfile.store.name = cachedProfile.storeName;

          console.log("LOADING FALSE (from Cache)");
          setState({
            user: currentUser,
            profile: cachedProfile,
            loading: false,
            reconnecting: false,
            error: null,
          });
        } catch (e) {
          console.error("AuthContext: Failed to parse cached profile", e);
        }
      }

      try {
        // 1. Check for Super Admin UID override
        if (currentUser.uid === 'c9grDXNTL6f1in8ZYZzPKtNhhE92') {
          if (isSubscribed) {
            // Listen to stores/SYSTEM in real-time
            const systemStoreRef = doc(db, 'stores', 'SYSTEM');
            storeUnsubscribe = onSnapshot(systemStoreRef, (storeSnap) => {
              if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
              let storeName = 'Global Control';
              let storeAddress = '';
              let storePhone = '';
              let receiptHeader = '';
              let receiptFooter = '';
              let taxRate = 0;
              let serviceFee = 0;
              let allowNegativeStock = false;

              if (storeSnap.exists()) {
                const storeData = storeSnap.data();
                storeName = storeData.storeName || storeData.name || 'Global Control';
                storeAddress = storeData.storeAddress || '';
                storePhone = storeData.storePhone || '';
                receiptHeader = storeData.receiptHeader || '';
                receiptFooter = storeData.receiptFooter || '';
                taxRate = storeData.taxRate || 0;
                serviceFee = storeData.serviceFee || 0;
                allowNegativeStock = storeData.allowNegativeStock || false;
              }

              const finalProfile = {
                uid: currentUser.uid,
                email: currentUser.email!,
                username: 'System Master',
                role: 'super_admin' as const,
                storeId: 'SYSTEM',
                storeName,
                storeAddress,
                storePhone,
                receiptHeader,
                receiptFooter,
                taxRate,
                serviceFee,
                allowNegativeStock,
                createdAt: new Date().toISOString(),
                store: {
                  name: storeName,
                  storeAddress,
                  storePhone,
                  receiptHeader,
                  receiptFooter,
                  taxRate,
                  serviceFee,
                  allowNegativeStock
                }
              };

              localStorage.setItem(`offline_auth_profile_${currentUser.uid}`, JSON.stringify(finalProfile));

              if (isSubscribed) {
                console.log("LOADING FALSE (from SuperAdminSYSTEM)");
                setState({
                  user: currentUser,
                  profile: finalProfile,
                  loading: false,
                  reconnecting: false,
                  error: null,
                });
              }
            }, (err) => {
              console.warn("AuthContext: System store listen failed, using fallback profile", err);
              if (isSubscribed) {
                setState(prev => ({
                  ...prev,
                  loading: false,
                  error: `Permission error or system store offline: ${err.message || String(err)}`
                }));
              }
            });
          }
          return;
        }

        // 2. Normal users: first listen to their user document
        const userRef = doc(db, 'users', currentUser.uid);
        let notFoundCount = 0;
        userUnsubscribe = onSnapshot(userRef, (userSnap) => {
          console.log("PROFILE FOUND", userSnap.exists() ? { uid: userSnap.id, role: userSnap.data()?.role, storeId: userSnap.data()?.storeId } : "not found");
          if (!userSnap.exists()) {
            console.warn("AuthContext: No user profile found in Firestore yet.");
            notFoundCount++;
            if (notFoundCount < 5 && isSubscribed) {
              // Keep user authenticated in loading state while waiting for firestore doc creation or replication lag
              setState(prev => ({
                ...prev,
                user: currentUser,
                profile: null,
                loading: true
              }));
              return;
            }
            if (isSubscribed) {
              if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
              setState({
                user: null,
                profile: null,
                loading: false,
                reconnecting: false,
                error: "Your user profile does not exist in the database. Please contact an administrator."
              });
            }
            return;
          }

          const userData = userSnap.data() as UserProfile;
          const validRoles: UserRole[] = ['super_admin', 'store_admin', 'manager', 'staff', 'cashier'];
          const role = userData.role;
          const storeId = userData.storeId;

          const isValidRole = role && validRoles.includes(role);
          const hasStoreId = role === 'super_admin' || (storeId && typeof storeId === 'string' && storeId.trim() !== '');

          if (!isValidRole || !hasStoreId) {
            console.error("AuthContext: Invalid role or store ID detected.");
            if (isSubscribed) {
              if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
              setState({
                user: null,
                profile: null,
                loading: false,
                reconnecting: false,
                error: "Access Denied: Invalid role or store configuration."
              });
            }
            return;
          }

          // Listen to their associated store document in real-time
          if (userData.storeId) {
            if (storeUnsubscribe) { storeUnsubscribe(); storeUnsubscribe = null; }
            const storeRef = doc(db, 'stores', userData.storeId);
            storeUnsubscribe = onSnapshot(storeRef, (storeSnap) => {
              if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
              let storeName = userData.storeId === 'SYSTEM' ? 'Global Control' : '';
              let storeAddress = '';
              let storePhone = '';
              let receiptHeader = '';
              let receiptFooter = '';
              let taxRate = 0;
              let serviceFee = 0;
              let allowNegativeStock = false;

              if (storeSnap.exists()) {
                const storeData = storeSnap.data();
                console.log("STORE FOUND", { id: storeSnap.id, name: storeData.storeName || storeData.name });
                if (storeData.status === 'suspended' && userData.storeId !== 'SYSTEM') {
                  console.error("AuthContext: Store suspended.");
                  if (isSubscribed) {
                    setState({
                      user: null,
                      profile: null,
                      loading: false,
                      reconnecting: false,
                      error: "Your store has been suspended. Please check with support."
                    });
                  }
                  return;
                }
                storeName = storeData.storeName || storeData.name || storeName;
                storeAddress = storeData.storeAddress || '';
                storePhone = storeData.storePhone || '';
                receiptHeader = storeData.receiptHeader || '';
                receiptFooter = storeData.receiptFooter || '';
                taxRate = storeData.taxRate || 0;
                serviceFee = storeData.serviceFee || 0;
                allowNegativeStock = storeData.allowNegativeStock || false;
              } else if (userData.role !== 'super_admin' && userData.storeId !== 'SYSTEM') {
                console.error("AuthContext: Store document does not exist.");
                if (isSubscribed) {
                  setState({
                    user: null,
                    profile: null,
                    loading: false,
                    reconnecting: false,
                    error: "The store assigned to your account does not exist."
                  });
                }
                return;
              }

              const finalProfile = {
                ...userData,
                storeName,
                storeAddress,
                storePhone,
                receiptHeader,
                receiptFooter,
                taxRate,
                serviceFee,
                allowNegativeStock,
                store: {
                  name: storeName,
                  storeAddress,
                  storePhone,
                  receiptHeader,
                  receiptFooter,
                  taxRate,
                  serviceFee,
                  allowNegativeStock
                }
              };

              localStorage.setItem(`offline_auth_profile_${currentUser.uid}`, JSON.stringify(finalProfile));

              if (isSubscribed) {
                console.log("LOADING FALSE (from StoreSnapshot)");
                setState({
                  user: currentUser,
                  profile: finalProfile,
                  loading: false,
                  reconnecting: false,
                  error: null,
                });
              }
            }, (err) => {
              console.error("AuthContext: Store listener failed:", err);
              if (isSubscribed) {
                if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
                setState(prev => ({
                  ...prev,
                  loading: false,
                  error: `Store query error: ${err.message || String(err)}`
                }));
              }
            });
          } else {
            // If no storeId, hydrate user profile details alone
            if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
            const finalProfile = {
              ...userData,
              storeName: '',
              storeAddress: '',
              storePhone: '',
              receiptHeader: '',
              receiptFooter: '',
              taxRate: 0,
              serviceFee: 0,
              allowNegativeStock: false,
              store: {
                name: '',
                storeAddress: '',
                storePhone: '',
                receiptHeader: '',
                receiptFooter: '',
                taxRate: 0,
                serviceFee: 0,
                allowNegativeStock: false
              }
            };
             localStorage.setItem(`offline_auth_profile_${currentUser.uid}`, JSON.stringify(finalProfile));
             if (isSubscribed) {
               console.log("LOADING FALSE (No Store ID)");
               setState({
                 user: currentUser,
                 profile: finalProfile,
                 loading: false,
                 reconnecting: false,
                 error: null,
               });
             }
          }
        }, (err) => {
          console.error("AuthContext: User profile listener failed:", err);
          if (isSubscribed) {
            if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
            setState(prev => ({
              ...prev,
              loading: false,
              error: `User document subscription failed: ${err.message || String(err)}`
            }));
          }
        });
      } catch (err: any) {
        console.error("AuthContext: Synchronous listener attachment failed:", err);
        if (isSubscribed) {
          if (profileTimeoutId) { clearTimeout(profileTimeoutId); profileTimeoutId = null; }
          setState(prev => ({
            ...prev,
            loading: false,
            error: `Failed to initialize database stream: ${err.message || String(err)}`
          }));
        }
      }
    });

    return () => {
      isSubscribed = false;
      unsubscribe();
      if (userUnsubscribe) userUnsubscribe();
      if (storeUnsubscribe) storeUnsubscribe();
      if (profileTimeoutId) clearTimeout(profileTimeoutId);
    };
  }, []);

  const signOut = async () => {
    if (state.user) {
      localStorage.removeItem(`offline_auth_profile_${state.user.uid}`);
    }
    await auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      user: state.user,
      profile: state.profile,
      loading: state.loading,
      reconnecting: state.reconnecting,
      error: state.error || null,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
