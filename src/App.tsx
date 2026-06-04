import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import POS from './pages/POS';
import SalesHistory from './pages/SalesHistory';
import Staff from './pages/Staff';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Settings from './pages/Settings';
import SuperAdmin from './pages/SuperAdmin';
import Reports from './pages/Reports';
import MainLayout from './components/layout/MainLayout';
import ErrorBoundary from './components/common/ErrorBoundary';
import { db as dexie } from './services/db';
import { db as firestore, auth } from './services/firebase';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { PrintDiagnostics } from './components/PrintDiagnostics';

function PrivateRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, profile, loading, error, signOut } = useAuth();

  // Prevent immediate redirect back to /login during login transition
  const directUser = auth.currentUser;

  if (loading || (directUser && !user)) {
    return <div className="h-screen w-screen flex items-center justify-center font-mono bg-slate-50 text-slate-900">LOADING NODE...</div>;
  }
  
  if (error) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center font-mono bg-red-50 text-red-900 p-6 text-center gap-4">
        <h1 className="text-xl font-bold uppercase tracking-wider">Authentication Error</h1>
        <p className="text-sm border border-red-200 bg-white px-4 py-2 rounded-xl max-w-md shadow-sm font-semibold">{error}</p>
        <button 
          onClick={async () => {
            try {
              await signOut();
            } catch (err) {
              console.error(err);
            }
            window.location.href = '/login';
          }}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-black uppercase transition-all"
        >
          Return to Login
        </button>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" />;
  
  if (allowedRoles && profile?.role && !allowedRoles.includes(profile.role)) {
    // If cashier try to access anything else, they should be redirected back to Dashboard or POS
    return <Navigate to="/" />;
  }

  console.log("PRIVATE ROUTE GRANTED", user.uid);
  return <>{children}</>;
}

const syncOfflineData = async () => {
  try {
    const queue = await dexie.syncQueue.toArray();
    if (queue.length === 0) return;
    
    console.log(`Syncing ${queue.length} offline operations to Firestore...`);
    
    for (const item of queue) {
      if (item.collection === 'sales' && item.action === 'create') {
        const sale = item.data;
        
        await runTransaction(firestore, async (transaction) => {
          const saleRef = doc(collection(firestore, 'sales'));
          const finalSaleData: any = {
            ...sale,
            id: saleRef.id,
            createdAt: serverTimestamp()
          };
          if (finalSaleData.splitPayments === undefined) {
            delete finalSaleData.splitPayments;
          }
          
          for (const sItem of sale.items) {
            const productRef = doc(firestore, 'products', sItem.productId);
            const stockId = `${sItem.productId}_${sItem.inventoryLocationId}`;
            const stockRef = doc(firestore, 'inventory_location_stock', stockId);
            
            const [productSnap, stockSnap] = await Promise.all([
              transaction.get(productRef),
              transaction.get(stockRef)
            ]);
            
            const totalUnitsToDeduct = sItem.quantity * (sItem.conversionRate || 1);
            
            if (productSnap.exists()) {
              transaction.update(productRef, {
                stock: Math.max(0, (productSnap.data().stock || 0) - totalUnitsToDeduct),
                updatedAt: serverTimestamp()
              });
            }
            
            if (stockSnap.exists()) {
              transaction.update(stockRef, {
                quantity: Math.max(0, (stockSnap.data().quantity || 0) - totalUnitsToDeduct),
                updatedAt: serverTimestamp()
              });
            }
          }
          
          transaction.set(saleRef, finalSaleData);
          await dexie.sales.delete(sale.id);
          await dexie.sales.put({ ...finalSaleData, synced: true } as any);
        });
        
        await dexie.syncQueue.delete(item.id!);
      }
    }
    console.log("Offline synchronization completed successfully.");
  } catch (err) {
    console.error("Failed to run offline synchronization:", err);
  }
};

function AppRoutes() {
  const { profile } = useAuth();

  useEffect(() => {
    const handleOnline = () => {
      console.log("Network online event. Initiating background sync...");
      syncOfflineData();
    };

    window.addEventListener('online', handleOnline);
    if (navigator.onLine) {
      syncOfflineData();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Main Application Routes */}
        <Route path="/" element={
          <PrivateRoute>
            <ErrorBoundary>
              <MainLayout />
            </ErrorBoundary>
          </PrivateRoute>
        }>
          <Route index element={
            <ErrorBoundary>
              <Dashboard />
            </ErrorBoundary>
          } />
          <Route path="inventory" element={
            <PrivateRoute allowedRoles={['store_admin', 'manager', 'staff', 'super_admin']}>
              <Inventory />
            </PrivateRoute>
          } />
          <Route path="sales" element={
            <PrivateRoute allowedRoles={['store_admin', 'manager', 'staff', 'super_admin']}>
              <SalesHistory />
            </PrivateRoute>
          } />
          <Route path="staff" element={
            <PrivateRoute allowedRoles={['store_admin', 'super_admin']}>
              <Staff />
            </PrivateRoute>
          } />
          <Route path="reports" element={
            <PrivateRoute allowedRoles={['store_admin', 'manager', 'super_admin']}>
              <Reports />
            </PrivateRoute>
          } />
          <Route path="customers" element={
            <PrivateRoute allowedRoles={['store_admin', 'manager', 'staff', 'super_admin']}>
              <Customers />
            </PrivateRoute>
          } />
          <Route path="suppliers" element={
            <PrivateRoute allowedRoles={['store_admin', 'manager', 'staff', 'super_admin']}>
              <Suppliers />
            </PrivateRoute>
          } />
          <Route path="settings" element={<Settings />} />
          <Route path="super-admin" element={
            <PrivateRoute allowedRoles={['super_admin']}>
              <ErrorBoundary>
                <SuperAdmin />
              </ErrorBoundary>
            </PrivateRoute>
          } />
        </Route>

        {/* POS is separate full-screen */}
        <Route path="/pos" element={
          <PrivateRoute>
            <POS />
          </PrivateRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
      <PrintDiagnostics />
    </AuthProvider>
  );
}
