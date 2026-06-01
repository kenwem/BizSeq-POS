import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { 
  Users, 
  UserPlus, 
  Shield, 
  Mail, 
  Fingerprint, 
  MoreHorizontal,
  Zap,
  ShieldCheck,
  UserCheck,
  Plus,
  X,
  ArrowRight,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface StaffMember {
  uid: string;
  email: string;
  username?: string;
  role: string;
  isActive?: boolean;
}

const Staff: React.FC = () => {
  const { profile, loading: authLoading } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [adding, setAdding] = useState(false);
  
  // New Staff Form
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'staff'
  });

  const fetchStaff = useCallback(async () => {
    try {
      const q = query(collection(db, 'users'), where('storeId', '==', profile?.storeId));
      const snap = await getDocs(q);
      // Filter out self
      const staffList = snap.docs
        .map(doc => ({ uid: doc.id, ...doc.data() } as StaffMember))
        .filter(m => m.uid !== profile?.uid);
      setStaff(staffList);
    } catch (err) {
      console.error("Failed to fetch staff:", err);
    } finally {
      setLoading(false);
    }
  }, [profile?.storeId, profile?.uid]);

  useEffect(() => {
    if (authLoading) return;
    if (profile?.storeId) {
      fetchStaff();
    } else {
      setLoading(false);
    }
  }, [authLoading, profile?.storeId, fetchStaff]);

  const handleCreateStaff = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username || !formData.password || !profile?.storeId) return;

    setAdding(true);
    try {
      // Create virtual email for staff: username@bizseq.internal
      const virtualEmail = `${formData.username.toLowerCase()}@bizseq.internal`;
      
      console.log("Staff: Attempting to create staff member via REST API...");
      
      const payload = {
        email: virtualEmail,
        username: formData.username,
        password: formData.password,
        role: formData.role,
        storeId: profile.storeId
      };

      // Standard Firebase Functions REST URL for us-central1
      const API_URL = `https://us-central1-bizseq.cloudfunctions.net/createStaff`;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const resultData = await response.json();
      
      if (!response.ok || !resultData.success) {
        throw new Error(resultData?.error || resultData?.message || `Internal Server Error: ${response.status}`);
      }

      window.alert("SUCCESS: New operator activated and integrated into the store node.");
      setIsModalOpen(false);
      setFormData({ username: '', password: '', role: 'staff' });
      fetchStaff();
    } catch (err: any) {
      console.error("Failed to add staff:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setAdding(false);
    }
  }, [formData, profile?.storeId, fetchStaff]);

  const handleManageUser = useCallback(async (uid: string, action: string, data?: any) => {
    if (action === 'delete' && !confirm('Are you absolutely sure? This will permanently remove the operator.')) return;
    
    try {
      const payload = { uid, action, ...data };
      const API_URL = `https://us-central1-bizseq.cloudfunctions.net/manageUser`;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const resultData = await response.json();

      if (!response.ok || !resultData.success) {
        throw new Error(resultData?.error || resultData?.message || `Management error: ${response.status}`);
      }

      fetchStaff();
    } catch (err: any) {
      alert(`Management error: ${err.message}`);
    }
  }, [fetchStaff]);

  const handleResetPassword = (uid: string) => {
    const newPass = prompt('Enter new password (min 6 chars):');
    if (newPass && newPass.length >= 6) {
      handleManageUser(uid, 'reset_password', { password: newPass });
      alert('Password updated successfully.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-10 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
           <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-slate-900 rounded-lg shadow-lg">
                 <Users className="h-4 w-4 text-emerald-400" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-600">Operations Control</span>
           </div>
           <h1 className="text-5xl font-black tracking-tighter text-slate-900 leading-none mb-4 italic">Personnel</h1>
           <p className="text-slate-600 font-bold text-lg italic max-w-lg">Provision and manage operator access for your terminal.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center space-x-4 bg-emerald-600 text-white px-10 py-5 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-2xl shadow-emerald-600/20 active:scale-95 transition-all group"
        >
          <UserPlus className="h-5 w-5" /> 
          <span>Add New Operator</span>
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {loading ? (
          Array(3).fill(0).map((_, i) => (
            <div key={i} className="h-64 bg-slate-50 rounded-[2.5rem] animate-pulse" />
          ))
        ) : staff.length === 0 ? (
          <div className="col-span-full py-24 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
             <p className="text-slate-400 font-bold italic">No operators provisioned yet.</p>
          </div>
        ) : staff.map((member, i) => (
          <motion.div 
            key={member.uid}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="vibrant-card p-10 group border-2 border-slate-100 hover:border-emerald-500/10"
          >
             <div className="flex items-start justify-between mb-8">
                <div className="h-20 w-20 rounded-[2rem] bg-slate-900 flex items-center justify-center text-white font-black text-2xl shadow-2xl relative overflow-hidden">
                  {member.username?.charAt(0).toUpperCase() || 'U'}
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-emerald-500" />
                </div>
                <div className="flex flex-col items-end gap-2">
                   <span className={cn(
                     "px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest",
                     member.isActive === false ? "bg-red-100 text-red-600 border border-red-200" : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                   )}>
                     {member.isActive === false ? 'Suspended' : 'Active'}
                   </span>
                   <span className="text-[8px] font-black uppercase tracking-widest text-slate-300">
                     {member.role === 'store_admin' ? 'Admin' : 'Operator'}
                   </span>
                </div>
             </div>

             <div className="mb-8">
                <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase truncate leading-none">{member.username}</h3>
                <p className="text-[10px] text-slate-400 font-bold font-mono mt-2 uppercase tracking-widest">ID: {member.uid.substring(0, 8)}</p>
             </div>

             <div className="grid grid-cols-3 gap-2">
                <button 
                  onClick={() => handleResetPassword(member.uid)}
                  className="py-3 bg-slate-50 text-slate-600 rounded-xl text-[8px] font-black uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all shadow-sm"
                >
                  Reset
                </button>
                <button 
                  onClick={() => handleManageUser(member.uid, 'set_active', { isActive: member.isActive === false })}
                  className={cn(
                    "py-3 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all shadow-sm",
                    member.isActive === false ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white" : "bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white"
                  )}
                >
                  {member.isActive === false ? 'Enable' : 'Suspend'}
                </button>
                <button 
                  onClick={() => handleManageUser(member.uid, 'delete')}
                  className="py-3 bg-rose-50 text-rose-600 rounded-xl text-[8px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-sm"
                >
                  Delete
                </button>
             </div>
          </motion.div>
        ))}
      </div>

      {/* Add Staff Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsModalOpen(false)}
               className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               className="bg-white rounded-[3rem] w-full max-w-lg p-8 md:p-12 shadow-2xl relative z-10 border-4 border-slate-50 max-h-[90vh] flex flex-col"
             >
                <div className="mb-8 text-center shrink-0">
                   <div className="inline-flex p-4 bg-emerald-600 rounded-3xl text-white shadow-xl mb-4">
                      <UserPlus className="h-6 w-6 md:h-8 md:w-8" />
                   </div>
                   <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase italic">Provision Operator</h2>
                   <p className="text-slate-600 font-bold italic mt-1 text-sm">Grant administrative or terminal access.</p>
                </div>

                <div className="overflow-y-auto px-2 space-y-8 custom-scrollbar">
                  <form onSubmit={handleCreateStaff} className="space-y-6">
                     <div className="group">
                        <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2">Operator Username</label>
                        <input 
                          type="text"
                          required
                          value={formData.username}
                          onChange={(e) => setFormData({...formData, username: e.target.value})}
                          placeholder="kenny"
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner"
                        />
                     </div>

                     <div className="group relative">
                        <label className="block text-[11px] font-black text-slate-900 uppercase tracking-widest mb-3 ml-2">Set Password</label>
                        <div className="relative">
                          <input 
                            type={showPassword ? "text" : "password"}
                            required
                            minLength={6}
                            value={formData.password}
                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                            placeholder="••••••••"
                            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 pr-12 outline-none focus:border-slate-950 text-slate-950 font-bold placeholder:text-slate-500 shadow-inner"
                          />
                          <button 
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-950 transition-colors"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-600 font-bold italic mt-2 ml-2">Minimum 6 characters required.</p>
                     </div>

                     <div className="group">
                        <label className="block text-[10px] font-black text-slate-950 uppercase tracking-[0.2em] mb-3 ml-2">Assigned Role</label>
                        <select 
                          value={formData.role}
                          onChange={(e) => setFormData({...formData, role: e.target.value})}
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-slate-950 text-slate-950 font-bold transition-all shadow-inner"
                        >
                           <option value="cashier">Cashier (POS Only)</option>
                           <option value="staff">Staff (POS + View Inventory)</option>
                           <option value="manager">Manager (POS + Manage Inventory)</option>
                           {profile?.role === 'super_admin' && <option value="store_admin">Store Administrator</option>}
                        </select>
                        <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                           <p className="text-[10px] font-bold text-slate-500 leading-relaxed italic">
                             {formData.role === 'cashier' && "CASHIER: Authorized for transaction processing and terminal operations only."}
                             {formData.role === 'staff' && "STAFF: Authorized for terminal operations and inventory visibility."}
                             {formData.role === 'manager' && "MANAGER: Full terminal access + inventory supply management rights."}
                           </p>
                        </div>
                     </div>

                     <div className="flex gap-4 pt-6">
                        <button 
                          type="button"
                          onClick={() => setIsModalOpen(false)} 
                          className="flex-1 py-5 rounded-2xl font-black text-slate-400 hover:bg-slate-50 transition-all uppercase tracking-widest text-[9px]"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          disabled={adding}
                          className="flex-[1.5] bg-slate-950 text-white font-black py-5 rounded-2xl shadow-2xl shadow-slate-950/40 hover:bg-black transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-[9px] disabled:opacity-50"
                        >
                           {adding ? <Zap className="h-4 w-4 animate-spin text-emerald-400" /> : <span>Activate User</span>}
                           {!adding && <ArrowRight className="h-4 w-4 text-emerald-400" />}
                        </button>
                     </div>
                  </form>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Staff;
