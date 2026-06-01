import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  collection, 
  getDocs, 
  doc,
  setDoc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { 
  ShieldAlert, 
  Plus, 
  Store, 
  Activity, 
  Building2, 
  ArrowRight,
  Zap,
  Globe,
  Users,
  Search,
  CheckCircle2,
  Trash,
  Eye,
  EyeOff
} from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface StoreInstance {
  id: string;
  name: string;
  adminId: string;
  adminEmail?: string;
  status: 'active' | 'suspended';
  createdAt: any;
  revenue?: number;
  staffCount?: number;
}

interface UserSummary {
  id: string;
  username: string;
  email: string;
  role: string;
  storeId?: string;
}

const SuperAdmin: React.FC = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const [stores, setStores] = useState<StoreInstance[]>([]);
  const [availableUsers, setAvailableUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newStore, setNewStore] = useState({ 
    storeName: '', 
    adminEmail: '', 
    defaultPassword: 'admin101',
    adminUsername: '',
    storeAddress: '',
    storePhone: ''
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [errorCount, setErrorCount] = useState(0);

  // Edit store configuration state
  const [editingStore, setEditingStore] = useState<StoreInstance | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    adminEmail: '',
    storeAddress: '',
    storePhone: '',
    adminId: ''
  });

  // Diagnostic states
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [repairEmail, setRepairEmail] = useState('');
  const [repairRole, setRepairRole] = useState('store_admin');
  const [repairStoreId, setRepairStoreId] = useState('');
  const [manualStoreId, setManualStoreId] = useState('');
  const [manualStoreName, setManualStoreName] = useState('');
  const [manualStoreAdminEmail, setManualStoreAdminEmail] = useState('');
  const [manualStoreAdminId, setManualStoreAdminId] = useState('');
  const [manualStoreStatus, setManualStoreStatus] = useState('active');
  const [isRepairing, setIsRepairing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const storesSnap = await getDocs(collection(db, 'stores'));
      const storeData = storesSnap.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as StoreInstance));
      setStores(storeData);
 
      const usersSnap = await getDocs(collection(db, 'users'));
      const userData = usersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as UserSummary));
      setAvailableUsers(userData);
      setErrorCount(0);
    } catch (err: any) {
      console.error("SuperAdmin fetchData error:", err);
      setErrorCount(prev => prev + 1);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchData();
    }
  }, [user?.uid, authLoading, fetchData]);

  const handleOnboardStore = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const API_URL = `https://us-central1-bizseq.cloudfunctions.net/createStoreWithAdmin`;

    try {
      setLoading(true);
      setStatusMessage("Provisioning store node via REST...");

      const payload = {
        storeName: newStore.storeName.trim(),
        adminEmail: newStore.adminEmail.trim(),
        adminUsername: newStore.adminUsername || newStore.adminEmail.split('@')[0],
        defaultPassword: newStore.defaultPassword,
        superAdminUid: auth.currentUser?.uid || ""
      };

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();

      if (!response.ok || resData.success === false) {
        throw new Error(resData.error || resData.message || `HTTP ${response.status}`);
      }

      setStatusMessage("Success! Store generated.");

      // Attempt to append store address and store phone to the store document in Firestore
      try {
        setStatusMessage("Configuring address and phone metadata...");
        const querySnap = await getDocs(collection(db, 'stores'));
        const matchedDoc = querySnap.docs.find(doc => {
          const d = doc.data();
          return d.name === newStore.storeName.trim() || (d.adminEmail && d.adminEmail === newStore.adminEmail.trim());
        });
        
        if (matchedDoc) {
          await updateDoc(doc(db, 'stores', matchedDoc.id), {
            storeAddress: newStore.storeAddress.trim(),
            storePhone: newStore.storePhone.trim()
          });
        }
      } catch (err) {
        console.error("Failed to append address/phone to store doc:", err);
      }

      window.alert(`SUCCESS: STORE PROVISIONED!\n\nStore: ${newStore.storeName}\nAdmin: ${newStore.adminEmail}\n\nActivation complete.`);
      setIsModalOpen(false);
      setNewStore({ storeName: '', adminEmail: '', defaultPassword: 'admin101', adminUsername: '', storeAddress: '', storePhone: '' });
      fetchData();
      
      // Keep status message visible on the dashboard for 5 seconds
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (err: any) {
      console.error(`Onboarding error:`, err);
      window.alert(`PROVISIONING FAILED\n\nERROR: ${err.message}`);
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  }, [newStore, fetchData]);

  const handleOpenEditModal = useCallback((store: StoreInstance) => {
    setEditingStore(store);
    setEditForm({
      name: store.name || (store as any).storeName || '',
      adminEmail: store.adminEmail || '',
      storeAddress: (store as any).storeAddress || '',
      storePhone: (store as any).storePhone || '',
      adminId: store.adminId || ''
    });
  }, []);

  const handleSaveStoreUpdates = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStore) return;

    setLoading(true);
    setStatusMessage(`Updating configuration for ${editForm.name}...`);
    try {
      const storeRef = doc(db, 'stores', editingStore.id);
      await updateDoc(storeRef, {
        name: editForm.name.trim(),
        storeName: editForm.name.trim(),
        adminEmail: editForm.adminEmail.trim(),
        storeAddress: editForm.storeAddress.trim(),
        storePhone: editForm.storePhone.trim(),
        adminId: editForm.adminId.trim()
      });
      window.alert("SUCCESS!\n\nStore configuration has been updated successfully.");
      setEditingStore(null);
      fetchData();
    } catch (err: any) {
      console.error("Failed to update store:", err);
      window.alert(`FAILED TO SAVE UPDATES\n\nERROR: ${err.message}`);
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  }, [editingStore, editForm, fetchData]);

  const handleEditStoreName = useCallback(async (storeId: string, currentName: string) => {
    const newName = prompt(`Enter new store display name (leaving blank or matching cancels):`, currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    
    setLoading(true);
    setStatusMessage(`Renaming store node to "${newName.trim()}"...`);
    try {
      const storeRef = doc(db, 'stores', storeId);
      await updateDoc(storeRef, {
        name: newName.trim(),
        storeName: newName.trim()
      });
      window.alert(`Success!\n\nStore name has been changed to "${newName.trim()}".`);
      fetchData();
    } catch (err: any) {
      console.error("Failed to edit store name:", err);
      window.alert(`FAILED TO EDIT STORE NAME\n\nERROR: ${err.message}`);
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  }, [fetchData]);

  const handleManageUser = useCallback(async (uid: string, action: string, data?: any) => {
    try {
      const API_URL = `https://us-central1-bizseq.cloudfunctions.net/manageUser`;
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uid, action, ...data })
      });

      const resData = await response.json();
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || resData.message || `Management error: ${response.status}`);
      }
      fetchData();
      return true;
    } catch (err: any) {
      console.error("Management error:", err);
      alert(`Operation Failed: ${err.message}`);
      return false;
    }
  }, [fetchData]);

  const handleRepairUser = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repairEmail) return;
    setIsRepairing(true);
    try {
      const cleanEmail = repairEmail.trim().toLowerCase();
      let matchedUser = availableUsers.find(u => (u.email || '').toLowerCase() === cleanEmail);
      
      let targetUid = matchedUser?.id;
      let username = matchedUser?.username || cleanEmail.split('@')[0];

      if (!targetUid) {
        const typedUid = prompt(`User "${cleanEmail}" was not detected in the initially fetched Firestore list.\n\nOptionally paste their Auth UUID directly if you know it (otherwise we will generate a placeholder ID for Firestore):`);
        if (typedUid === null) {
          setIsRepairing(false);
          return;
        }
        targetUid = typedUid.trim() || `manual_${Date.now()}`;
      }

      const userDocRef = doc(db, 'users', targetUid);
      await setDoc(userDocRef, {
        uid: targetUid,
        email: cleanEmail,
        username: username,
        role: repairRole,
        storeId: repairStoreId || "SYSTEM",
        createdAt: new Date().toISOString()
      }, { merge: true });

      alert(`SUCCESS!\n\nUser profile repaired successfully for email: ${cleanEmail}\nUID: ${targetUid}\nRole: ${repairRole}\nStore ID: ${repairStoreId || "SYSTEM"}`);
      setRepairEmail('');
      fetchData();
    } catch (err: any) {
      console.error("Diagnostic Repair User failed:", err);
      alert(`REPAIR FAILED: ${err.message}`);
    } finally {
      setIsRepairing(false);
    }
  }, [repairEmail, repairRole, repairStoreId, availableUsers, fetchData]);

  const handleManualCreateStore = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualStoreId || !manualStoreName) {
      alert("Please specify a Store ID code and Store Name.");
      return;
    }
    setIsRepairing(true);
    try {
      const storeIdDoc = manualStoreId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const storeDocRef = doc(db, 'stores', storeIdDoc);
      
      await setDoc(storeDocRef, {
        id: storeIdDoc,
        name: manualStoreName.trim(),
        storeName: manualStoreName.trim(),
        adminEmail: manualStoreAdminEmail.trim() || "unassigned@bizseq.internal",
        adminId: manualStoreAdminId.trim() || "",
        status: manualStoreStatus,
        createdAt: new Date().toISOString()
      });

      alert(`SUCCESS!\n\nStore "${manualStoreName}" created manually with ID: ${storeIdDoc}.\nIt should now appear in the Super Admin list.`);
      setManualStoreId('');
      setManualStoreName('');
      setManualStoreAdminEmail('');
      setManualStoreAdminId('');
      fetchData();
    } catch (err: any) {
      console.error("Diagnostic Create Store failed:", err);
      alert(`STORE CREATION FAILED: ${err.message}`);
    } finally {
      setIsRepairing(false);
    }
  }, [manualStoreId, manualStoreName, manualStoreAdminEmail, manualStoreAdminId, manualStoreStatus, fetchData]);

  const filteredUsers = useMemo(() => {
    return availableUsers.filter(u => 
      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (u.username || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableUsers, searchQuery]);

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-white font-sans">
      <div className="flex flex-col items-center gap-6">
        <Zap className="h-12 w-12 text-blue-500 animate-pulse" />
        <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Verifying Global Access...</p>
      </div>
    </div>
  );

  if (profile?.role !== 'super_admin') return (
    <div className="min-h-screen flex items-center justify-center bg-white p-8 font-sans">
      <div className="max-w-md w-full bg-slate-50 p-12 rounded-[3.5rem] border-4 border-slate-100 text-center">
        <ShieldAlert className="h-16 w-16 text-rose-500 mx-auto mb-8" />
        <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-4 uppercase">System Lockdown</h2>
        <p className="text-slate-600 font-bold italic mb-8">Access restricted to established Super Admin accounts only. (UID: {user?.uid?.substring(0, 8)}...)</p>
        <button 
          onClick={() => auth.signOut()}
          className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-[10px]"
        >
          Reset Session
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-12 pb-24">
      {/* Immersive Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3 mb-6"
          >
             <div className="p-3 bg-slate-900 rounded-xl shadow-lg">
                <ShieldAlert className="h-5 w-5 text-emerald-400" />
             </div>
             <span className="text-[11px] font-black uppercase tracking-[0.4em] text-emerald-600">Global Admin Terminal</span>
          </motion.div>
          <h1 className="text-6xl md:text-7xl font-black tracking-tight text-slate-900 leading-none mb-6 italic">System Console</h1>
          
          <AnimatePresence>
            {statusMessage && (
              <motion.div 
                initial={{ opacity: 0, height: 0, y: -20 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -20 }}
                className="mb-6 p-4 bg-emerald-50 border-2 border-emerald-100 rounded-2xl flex items-center gap-4 text-emerald-700 shadow-xl shadow-emerald-500/5"
              >
                <div className="p-2 bg-emerald-500 rounded-lg text-white">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <span className="text-xs font-black uppercase tracking-widest">{statusMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-4 mb-6 items-center">
            <div className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black text-slate-500 uppercase tracking-widest">
              User: {user?.email}
            </div>
            {errorCount > 0 && (
              <div className="px-3 py-1 bg-rose-100 rounded-full text-[10px] font-black text-rose-500 uppercase tracking-widest">
                ERRORS: {errorCount}
              </div>
            )}
            <button 
              onClick={() => fetchData()}
              className="px-3 py-1 bg-emerald-100 hover:bg-emerald-200 rounded-full text-[10px] font-black text-emerald-700 uppercase tracking-widest transition-colors"
            >
              Retry Terminal Sync
            </button>
          </div>
          <p className="text-slate-600 font-bold text-xl max-w-xl italic leading-relaxed">
            Provision stores and configure administrative credentials for the <span className="text-slate-950 underline decoration-emerald-500 decoration-4 underline-offset-4">BizSeq Ecosystem</span>.
          </p>
        </div>
        
        <div className="flex flex-col md:flex-row md:items-end gap-4 mt-6 md:mt-0">
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center space-x-4 bg-emerald-600 text-white px-12 py-6 rounded-[2.5rem] text-sm font-black uppercase tracking-widest shadow-2xl shadow-emerald-600/20 active:scale-95 hover:bg-emerald-700 transition-all group"
          >
            <Plus className="h-5 w-5 group-hover:rotate-90 transition-transform" />
            <span>Create Store</span>
          </button>
        </div>
      </header>

      {/* Onboarding Summary (Layman Guide) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
         {[
           { step: '01', title: 'Register Store', desc: 'Define store name and admin email.', icon: Building2 },
           { step: '02', title: 'Auto-Create', desc: 'System automatically provisions the user account.', icon: Zap },
           { step: '03', title: 'Login Share', desc: 'Securely share login credentials with the store owner.', icon: Globe },
           { step: '04', title: 'Deployment', desc: 'Full store access activated instantly.', icon: CheckCircle2 }
         ].map((g, i) => (
           <div key={i} className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 relative overflow-hidden group">
              <span className="absolute -right-4 -bottom-4 text-6xl font-black text-white/5 group-hover:text-emerald-500/10 transition-colors">{g.step}</span>
              <div className="p-3 bg-slate-800 rounded-xl w-fit mb-4">
                 <g.icon className="h-5 w-5 text-emerald-400" />
              </div>
              <h4 className="text-white font-black text-[10px] uppercase tracking-[0.2em] mb-2">{g.title}</h4>
              <p className="text-slate-500 text-[10px] font-bold italic leading-relaxed">{g.desc}</p>
           </div>
         ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <h2 className="text-2xl font-black text-slate-950 uppercase tracking-tight flex items-center gap-3">
             <Store className="h-6 w-6 text-emerald-500" />
             Managed Infrastructure
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {loading ? (
              Array(2).fill(0).map((_, i) => (
                <div key={i} className="h-80 bg-white/50 rounded-[3rem] animate-pulse" />
              ))
            ) : stores.length === 0 ? (
              <div className="col-span-full py-20 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
                 <p className="text-slate-400 font-bold italic">No stores provisioned yet.</p>
              </div>
            ) : stores.map((store, i) => (
              <motion.div 
                key={store.id}
                className="vibrant-card p-8 group relative border-2 border-slate-100 hover:border-emerald-500/20 transition-all shadow-xl hover:shadow-2xl"
              >
                  <div className="flex items-start justify-between mb-8">
                    <div className="flex items-center gap-5">
                       <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-xl">
                          <Building2 className="h-6 w-6 text-emerald-400" />
                       </div>
                       <div>
                          <h3 className="font-black text-xl text-slate-950 tracking-tight uppercase">{store.name || (store as any).storeName || 'N/A'}</h3>
                          <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">{store.status}</p>
                       </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-6 py-6 border-y border-slate-100">
                    <div>
                       <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Admin Email</p>
                       <p className="text-sm font-black text-slate-700 truncate">{store.adminEmail || 'N/A'}</p>
                    </div>
                    <div>
                       <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Store ID</p>
                       <p className="text-sm font-black text-slate-700 font-mono tracking-tight truncate">{store.id}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 py-4 border-b border-slate-100 text-[10px]">
                    <div>
                       <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Phone</p>
                       <p className="text-xs font-black text-slate-600 truncate">{(store as any).storePhone || 'N/A'}</p>
                    </div>
                    <div>
                       <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Address</p>
                       <p className="text-xs font-black text-slate-600 truncate">{(store as any).storeAddress || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="pt-6 flex justify-between items-center text-[10px]">
                    <div className="flex flex-col">
                       <span className="text-slate-400 font-black uppercase tracking-widest">Operator ID</span>
                       <span className="font-bold text-slate-900">{store.adminId || 'Unassigned'}</span>
                    </div>
                    <div className="flex flex-col items-end">
                       <span className="text-slate-400 font-black uppercase tracking-widest">Created</span>
                       <span className="font-bold text-slate-900">
                          {store.createdAt?.toDate?.()?.toLocaleDateString() || 
                           (typeof store.createdAt === 'string' ? new Date(store.createdAt).toLocaleDateString() : 'N/A')}
                       </span>
                    </div>
                  </div>

                  <div className="mt-8 flex gap-4">
                     <button 
                       onClick={() => handleOpenEditModal(store)}
                       className="flex-1 py-4 bg-slate-950 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:bg-black active:scale-95 transition-all outline-none"
                     >
                       Manage Hub
                     </button>
                     <button 
                       onClick={async () => {
                         const confirmAction = confirm(`Toggle status for ${store.name}? (Active <-> Suspended)`);
                         if (confirmAction) {
                           setLoading(true);
                           try {
                             const storeRef = doc(db, 'stores', store.id);
                             await updateDoc(storeRef, {
                               status: store.status === 'active' ? 'suspended' : 'active'
                             });
                             fetchData();
                           } catch (err: any) {
                             alert(`Update status failed: ${err.message}`);
                           } finally {
                             setLoading(false);
                           }
                         }
                       }}
                       className={`p-4 rounded-2xl border transition-all ${store.status === 'active' ? 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100' : 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100'}`}
                       title={store.status === 'active' ? "Suspend store" : "Activate store"}
                     >
                        <ShieldAlert className="h-5 w-5" />
                     </button>
                  </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="space-y-8">
           <h2 className="text-2xl font-black text-slate-950 uppercase tracking-tight flex items-center gap-3">
             <Users className="h-6 w-6 text-slate-400" />
             Active Users
          </h2>
          <div className="bg-white p-8 rounded-[3rem] border-2 border-slate-100 shadow-xl space-y-6">
             <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Search identities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl pl-12 pr-4 py-4 outline-none focus:border-emerald-500 text-sm font-black transition-all placeholder:text-slate-500"
                />
             </div>

             <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {filteredUsers.map((user) => {
                  const linkedStore = stores.find(s => s.id === user.storeId);
                  const assignedStoreName = linkedStore 
                    ? (linkedStore.name || (linkedStore as any).storeName || "Unnamed Hub") 
                    : (user.role === 'super_admin' ? 'Ecosystem Admin' : 'Unassigned Hub');
                  return (
                  <div key={user.id} className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 group hover:bg-white hover:shadow-lg transition-all">
                     <div className="flex items-center justify-between mb-4">
                        <div className="min-w-0">
                           <p className="font-black text-slate-900 text-sm truncate uppercase tracking-tight">{user.username}</p>
                           <p className="text-[10px] text-slate-500 font-bold truncate italic">{user.email || (user.username ? `${user.username}@bizseq.internal` : 'N/A')}</p>
                        </div>
                        <span className="text-[8px] font-black uppercase tracking-[0.2em] px-2 py-1 bg-slate-900 text-white rounded-lg shrink-0">
                           {user.role}
                        </span>
                     </div>

                     <div className="mb-4 pt-3 border-t border-slate-100/60 grid grid-cols-2 gap-4 text-[9px] font-bold text-slate-500">
                        <div>
                           <span className="text-[8.5px] text-slate-400 font-black uppercase tracking-widest block mb-0.5">Store Hub</span>
                           <span className="text-slate-800 font-black uppercase truncate block">{assignedStoreName}</span>
                        </div>
                        <div>
                           <span className="text-[8.5px] text-slate-400 font-black uppercase tracking-widest block mb-0.5">Ref / User ID</span>
                           <span className="font-mono text-slate-800 text-[8px] truncate block" title={user.id}>{user.id}</span>
                        </div>
                     </div>
                     <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                           onClick={async () => {
                             const newPass = prompt(`Reset password for ${user.username}:`);
                             if (newPass && newPass.length >= 6) {
                               try {
                                 await handleManageUser(user.id, 'reset_password', { password: newPass });
                                 alert('Password reset successful.');
                               } catch (err: any) {
                                 alert(`Reset Failed: ${err.message}`);
                               }
                             }
                           }}
                           className="flex-1 py-2 bg-white border border-slate-200 rounded-xl text-[8px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-950 hover:text-white transition-all shadow-sm"
                        >
                           Reset
                        </button>
                        <button 
                           onClick={async () => {
                             if(confirm(`Delete user ${user.username} permanently?`)) {
                               try {
                                 await handleManageUser(user.id, 'delete');
                                 fetchData();
                               } catch (err: any) {
                                 alert(`Delete Failed: ${err.message}`);
                               }
                             }
                           }}
                           className="py-2 px-3 bg-white border border-rose-100 rounded-xl text-rose-300 hover:bg-rose-600 hover:text-white transition-all shadow-sm"
                        >
                           <Trash className="h-3 w-3" />
                        </button>
                     </div>
                  </div>
                );
              })}
             </div>
          </div>
        </div>
      </div>

      {/* Modern Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsModalOpen(false)}
               className="absolute inset-0 bg-slate-950/40 backdrop-blur-md"
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="bg-white rounded-[3.5rem] w-full max-w-2xl p-8 md:p-12 shadow-2xl relative z-10 border-4 border-slate-50 max-h-[90vh] flex flex-col"
             >
                <div className="mb-8 text-center shrink-0">
                   <div className="inline-flex p-4 bg-emerald-600 rounded-3xl text-white shadow-2xl shadow-emerald-500/40 mb-4">
                      <Store className="h-6 w-6 md:h-8 md:w-8" />
                   </div>
                   <h2 className="text-3xl md:text-4xl font-black text-slate-950 tracking-tight uppercase italic">Store Onboarding</h2>
                   <p className="text-slate-600 font-bold italic mt-1 text-sm">Provision a new franchise entry.</p>
                </div>
                
                <form onSubmit={handleOnboardStore} className="space-y-6 overflow-y-auto pr-4 custom-scrollbar">
                   <div className="group">
                      <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Store Name</label>
                      <input 
                        type="text" 
                        value={newStore.storeName}
                        onChange={(e) => setNewStore({ ...newStore, storeName: e.target.value })}
                        placeholder="e.g. Acme Superstore Lagos" 
                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="group flex flex-col font-sans">
                        <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2">Store Address</label>
                        <input 
                          type="text" 
                          value={newStore.storeAddress}
                          onChange={(e) => setNewStore({ ...newStore, storeAddress: e.target.value })}
                          placeholder="e.g. 123 Broad Street, Lagos" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                      <div className="group flex flex-col font-sans">
                        <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2">Store Phone Number</label>
                        <input 
                          type="text" 
                          value={newStore.storePhone}
                          onChange={(e) => setNewStore({ ...newStore, storePhone: e.target.value })}
                          placeholder="e.g. +234 801 234 5678" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="group flex flex-col">
                        <label className="block text-[11px] font-black text-slate-800 uppercase tracking-widest mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Admin Email</label>
                        <input 
                          type="email" 
                          value={newStore.adminEmail}
                          onChange={(e) => setNewStore({ ...newStore, adminEmail: e.target.value })}
                          placeholder="kenny@example.com" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                      <div className="group flex flex-col">
                        <label className="block text-[11px] font-black text-slate-800 uppercase tracking-widest mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Admin Username</label>
                        <input 
                          type="text" 
                          value={newStore.adminUsername}
                          onChange={(e) => setNewStore({ ...newStore, adminUsername: e.target.value })}
                          placeholder="kenny" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                    </div>

                    <div className="group flex flex-col relative">
                      <label className="block text-[11px] font-black text-slate-800 uppercase tracking-widest mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Default Password</label>
                      <div className="relative">
                        <input 
                           type={showPassword ? "text" : "password"} 
                           value={newStore.defaultPassword}
                           onChange={(e) => setNewStore({ ...newStore, defaultPassword: e.target.value })}
                           placeholder="e.g. admin101" 
                           className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 pr-14 outline-none focus:border-slate-900 text-slate-950 font-mono font-bold shadow-inner placeholder:text-slate-500" 
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-950 transition-colors"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-3 text-[9px] text-slate-600 font-bold italic px-2">The admin will use this to login for the first time.</p>
                    </div>
                   
                    <div className="flex flex-col gap-4 pt-6">
                       {statusMessage && (
                         <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center justify-center gap-2">
                               <Activity className="h-3 w-3 animate-pulse" />
                               {statusMessage}
                            </span>
                         </div>
                       )}
                       <div className="flex gap-4">
                          <button 
                            type="button"
                            onClick={() => setIsModalOpen(false)} 
                            className="flex-1 py-5 rounded-2xl font-black text-slate-400 hover:bg-slate-50 transition-all uppercase tracking-widest text-[9px]"
                          >
                            Abort
                          </button>
                          <button 
                             type="submit"
                             disabled={loading}
                             className="flex-[1.5] py-5 bg-slate-950 text-white rounded-2xl font-black shadow-2xl shadow-slate-950/40 uppercase tracking-[0.2em] text-[10px] flex items-center justify-center group disabled:opacity-50"
                          >
                             {loading ? 'Processing...' : 'Deploy Store'}
                             <ArrowRight className="ml-3 h-4 w-4 group-hover:translate-x-1 transition-transform text-emerald-400" />
                          </button>
                       </div>
                    </div>
                 </form>
              </motion.div>
          </div>
        )}

        {editingStore && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setEditingStore(null)}
               className="absolute inset-0 bg-slate-950/40 backdrop-blur-md"
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="bg-white rounded-[3.5rem] w-full max-w-2xl p-8 md:p-12 shadow-2xl relative z-10 border-4 border-slate-50 max-h-[90vh] flex flex-col font-sans"
             >
                <div className="mb-8 text-center shrink-0">
                   <div className="inline-flex p-4 bg-slate-900 rounded-3xl text-white shadow-2xl mb-4">
                      <Store className="h-6 w-6 md:h-8 md:w-8 text-emerald-400" />
                   </div>
                   <h2 className="text-3xl md:text-4xl font-black text-slate-950 tracking-tight uppercase italic animate-fade-in">Manage Configuration</h2>
                   <p className="text-slate-600 font-bold italic mt-1 text-sm">Update metadata for franchise node: {editingStore.id}</p>
                </div>
                
                <form onSubmit={handleSaveStoreUpdates} className="space-y-6 overflow-y-auto pr-4 custom-scrollbar">
                    <div className="group">
                       <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Store Name</label>
                       <input 
                         type="text" 
                         required
                         value={editForm.name}
                         onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                         placeholder="e.g. Acme Superstore" 
                         className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                       />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="group flex flex-col font-sans">
                        <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2">Store Address</label>
                        <input 
                          type="text" 
                          value={editForm.storeAddress}
                          onChange={(e) => setEditForm({ ...editForm, storeAddress: e.target.value })}
                          placeholder="e.g. 123 Broad Street, Lagos" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                      <div className="group flex flex-col font-sans">
                        <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2">Store Phone Number</label>
                        <input 
                          type="text" 
                          value={editForm.storePhone}
                          onChange={(e) => setEditForm({ ...editForm, storePhone: e.target.value })}
                          placeholder="e.g. +234 801 234 5678" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="group flex flex-col">
                        <label className="block text-[11px] font-black text-slate-800 uppercase tracking-widest mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Admin Email</label>
                        <input 
                          type="email" 
                          required
                          value={editForm.adminEmail}
                          onChange={(e) => setEditForm({ ...editForm, adminEmail: e.target.value })}
                          placeholder="kenny@example.com" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                      <div className="group flex flex-col">
                        <label className="block text-[11px] font-black text-slate-800 uppercase tracking-widest mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Admin User UUID (Operator ID)</label>
                        <input 
                          type="text" 
                          value={editForm.adminId}
                          onChange={(e) => setEditForm({ ...editForm, adminId: e.target.value })}
                          placeholder="Paste UID or leave blank" 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner" 
                        />
                      </div>
                    </div>
                   
                    <div className="flex flex-col gap-4 pt-6">
                       {statusMessage && (
                          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                             <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center justify-center gap-2">
                                <Activity className="h-3 w-3 animate-pulse" />
                                {statusMessage}
                             </span>
                          </div>
                       )}
                       <div className="flex gap-4">
                          <button 
                            type="button"
                            onClick={() => setEditingStore(null)} 
                            className="flex-1 py-5 rounded-2xl font-black text-slate-400 hover:bg-slate-50 transition-all uppercase tracking-widest text-[9px]"
                          >
                            Cancel
                          </button>
                          <button 
                             type="submit"
                             disabled={loading}
                             className="flex-[1.5] py-5 bg-slate-950 text-white rounded-2xl font-black shadow-2xl shadow-slate-950/40 uppercase tracking-[0.2em] text-[10px] flex items-center justify-center group disabled:opacity-50"
                          >
                             {loading ? 'Saving...' : 'Save Hub Settings'}
                             <ArrowRight className="ml-3 h-4 w-4 group-hover:translate-x-1 transition-transform text-emerald-400" />
                          </button>
                       </div>
                    </div>
                 </form>
              </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Collapsible Infrastructure Diagnostics & Direct Repair Console */}
      <div className="mt-20 border-t-4 border-dashed border-slate-200 pt-16">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <h3 className="text-3xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-3">
              <Zap className="h-6 w-6 text-amber-500 animate-pulse" />
              Infrastructure Diagnostics & Override Panel
            </h3>
            <p className="text-slate-500 font-bold text-sm italic mt-1">
              Directly look up database records and bypass Cloud Function lag to correct user accounts or synchronize stores.
            </p>
          </div>
          <button
            onClick={() => setIsDiagnosticOpen(!isDiagnosticOpen)}
            className="px-8 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg flex items-center gap-3"
          >
            <span>{isDiagnosticOpen ? "Hide Diagnostic Hub" : "Launch Diagnostics Console"}</span>
            <Activity className="h-4 w-4 text-emerald-400" />
          </button>
        </div>

        <AnimatePresence>
          {isDiagnosticOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-10 overflow-hidden"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 1. Direct User Account Repair Tool */}
                <div className="bg-slate-900 text-white p-10 rounded-[2.5rem] border-2 border-slate-800 shadow-2xl relative">
                  <div className="absolute top-6 right-6 p-2 bg-emerald-500/10 rounded-lg text-emerald-400 font-mono text-[9px] font-black uppercase tracking-widest">
                    Manual Sync
                  </div>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-slate-800 rounded-xl text-emerald-400">
                      <Users className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-black text-xl tracking-tight uppercase">Emergency Operator Repair</h4>
                      <p className="text-slate-400 font-bold text-xs italic">Force-map any login (e.g. kerm@yahoo.com) to a custom role & store</p>
                    </div>
                  </div>

                  <form onSubmit={handleRepairUser} className="space-y-6">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">User Email</label>
                      <input
                        type="email"
                        required
                        value={repairEmail}
                        onChange={(e) => setRepairEmail(e.target.value)}
                        placeholder="kenny@example.com"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-5 py-3 outline-none focus:border-emerald-500 text-white font-bold text-sm placeholder:text-slate-500"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Desired Custom Role</label>
                        <select
                          value={repairRole}
                          onChange={(e) => setRepairRole(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-emerald-500 text-white font-bold text-sm"
                        >
                          <option value="store_admin">Store Administrator</option>
                          <option value="manager">Manager</option>
                          <option value="staff">Staff Member</option>
                          <option value="cashier">Cashier (POS Terminal)</option>
                          <option value="super_admin">Super Administrator</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Link Store Node</label>
                        <select
                          value={repairStoreId}
                          onChange={(e) => setRepairStoreId(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-emerald-500 text-white font-bold text-sm"
                        >
                          <option value="">-- SYSTEM-WIDE ACCESS --</option>
                          {stores.map(st => (
                            <option key={st.id} value={st.id}>{st.name} ({st.id.substring(0, 8)})</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={isRepairing}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-xl text-[10px] uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50"
                      >
                        {isRepairing ? "Repairing Firestore Node..." : "Force-Map User Credentials"}
                      </button>
                    </div>
                  </form>
                </div>

                {/* 2. Direct Manual Store Creation Tool */}
                <div className="bg-slate-900 text-white p-10 rounded-[2.5rem] border-2 border-slate-800 shadow-2xl relative">
                  <div className="absolute top-6 right-6 p-2 bg-blue-500/10 rounded-lg text-blue-400 font-mono text-[9px] font-black uppercase tracking-widest">
                    Direct Provision
                  </div>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-slate-800 rounded-xl text-blue-400">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-black text-xl tracking-tight uppercase">Direct Store Creator</h4>
                      <p className="text-slate-400 font-bold text-xs italic">Instantiate a store into the Stores collection directly</p>
                    </div>
                  </div>

                  <form onSubmit={handleManualCreateStore} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Store ID (Letters/No Spaces)</label>
                        <input
                          type="text"
                          required
                          value={manualStoreId}
                          onChange={(e) => setManualStoreId(e.target.value)}
                          placeholder="e.g. store_kenny"
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-xs outline-none focus:border-blue-500 text-white font-bold placeholder:text-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Store Name</label>
                        <input
                          type="text"
                          required
                          value={manualStoreName}
                          onChange={(e) => { setNewStore(prev => ({ ...prev, storeName: e.target.value })); setManualStoreName(e.target.value); }}
                          placeholder="e.g. Kerm Global Mall"
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-xs outline-none focus:border-blue-500 text-white font-bold placeholder:text-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Admin Email</label>
                        <input
                          type="email"
                          value={manualStoreAdminEmail}
                          onChange={(e) => { setNewStore(prev => ({ ...prev, adminEmail: e.target.value })); setManualStoreAdminEmail(e.target.value); }}
                          placeholder="kenny@example.com"
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-xs outline-none focus:border-blue-500 text-white font-bold placeholder:text-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Admin User Account UID</label>
                        <input
                          type="text"
                          value={manualStoreAdminId}
                          onChange={(e) => setManualStoreAdminId(e.target.value)}
                          placeholder="Firebase Auth UID (Optional)"
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-xs outline-none focus:border-blue-500 text-white font-bold placeholder:text-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 items-end">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Store Status</label>
                        <select
                          value={manualStoreStatus}
                          onChange={(e) => setManualStoreStatus(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500 text-white font-bold"
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </div>
                      <div>
                        <button
                          type="submit"
                          disabled={isRepairing}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3.5 rounded-xl text-[9px] uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50"
                        >
                          {isRepairing ? "Creating Store..." : "Direct Create Store"}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>

              {/* Collapsible raw data visual audit table */}
              <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-200">
                <h4 className="font-black text-slate-900 uppercase text-xs tracking-wider mb-6 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-500" />
                  Live Firestore Schema Audit
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Stores checklist */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                     <p className="font-extrabold text-[10px] text-slate-400 uppercase tracking-widest mb-4">Stores Registries ({stores.length})</p>
                     <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar text-[10px]">
                       {stores.map(st => (
                         <div key={st.id} className="flex justify-between items-center p-2.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                           <div className="min-w-0 pr-2">
                             <p className="font-black text-slate-900 truncate uppercase">{st.name}</p>
                             <p className="text-slate-400 font-medium truncate uppercase tracking-wider font-sans">Active Store Registry</p>
                           </div>
                           <div className="flex flex-col items-end shrink-0 text-right">
                             <p className="font-bold text-slate-600 uppercase">Admin: {st.adminEmail || "None"}</p>
                             <span className="text-[8px] font-black uppercase tracking-widest text-emerald-600 mt-1">{st.status}</span>
                           </div>
                         </div>
                       ))}
                     </div>
                  </div>

                  {/* Users checklist */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                     <p className="font-extrabold text-[10px] text-slate-400 uppercase tracking-widest mb-4">User Profiles Registries ({availableUsers.length})</p>
                     <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar text-[10px]">
                       {availableUsers.map(usr => (
                         <div key={usr.id} className="flex justify-between items-center p-2.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                           <div className="min-w-0 pr-2">
                             <p className="font-black text-slate-900 truncate uppercase">{usr.username}</p>
                             <p className="text-slate-400 font-semibold truncate italic">{usr.email}</p>
                           </div>
                           <div className="flex flex-col items-end shrink-0 text-right">
                             <span className="px-2 py-0.5 bg-slate-900 text-white rounded font-mono text-[8px] font-black uppercase tracking-widest">{usr.role}</span>
                             {(() => {
                               const matchingStore = stores.find(s => s.id === usr.storeId);
                               return (
                                 <span className="text-[8px] text-slate-500 font-bold mt-1 font-sans uppercase">
                                   Store: {matchingStore ? matchingStore.name : (usr.storeId === 'SYSTEM' ? 'SYSTEM' : 'Unassigned')}
                                 </span>
                                );
                             })()}
                           </div>
                         </div>
                       ))}
                     </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default SuperAdmin;
