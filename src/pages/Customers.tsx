import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCustomers, Customer } from '../hooks/useCustomers';
import { 
  Plus, 
  Search, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Trash, 
  Edit, 
  MoreHorizontal,
  TrendingDown,
  Smartphone,
  ChevronRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

const Customers: React.FC = () => {
  const { profile } = useAuth();
  const { customers, isLoading, addCustomer, updateCustomer, deleteCustomer } = useCustomers(profile?.storeId);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: ''
  });

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      c.name.toLowerCase().includes(search.toLowerCase()) || 
      c.phone.includes(search)
    );
  }, [customers, search]);

  const stats = useMemo(() => {
    const totalDebt = customers.reduce((acc, c) => acc + (c.debt || 0), 0);
    const regularCustomers = customers.filter(c => c.totalSpent > 1000).length;
    return { totalDebt, regularCustomers };
  }, [customers]);

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    
    setIsSaving(true);
    console.log("Saving customer:", formData);
    
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, formData);
      } else {
        if (!profile?.storeId) throw new Error("No store ID found in profile. Please refresh.");
        await addCustomer({ ...formData, storeId: profile.storeId });
      }
      setIsModalOpen(false);
      setEditingCustomer(null);
      setFormData({ name: '', phone: '', email: '', address: '' });
      alert("Customer saved successfully.");
    } catch (err: any) {
      console.error("Save customer error:", err);
      alert(`FAILED TO SAVE: ${err.message || "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-12 pb-24 px-4 sm:px-6">
      <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
        <div className="space-y-4">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2"
          >
             <div className="p-2 bg-indigo-500 rounded-lg shadow-lg">
                <User className="h-4 w-4 text-white" />
             </div>
             <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Customer Relations</span>
          </motion.div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-slate-950 leading-none">Customers</h1>
          
          <div className="flex flex-wrap gap-6 pt-4">
             <div className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Outstanding Debt</span>
                <span className="text-xl font-black font-mono text-rose-600 italic">{formatCurrency(stats.totalDebt)}</span>
             </div>
             <div className="w-px h-10 bg-slate-100" />
             <div className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Base</span>
                <span className="text-xl font-black font-mono text-slate-900">{customers.length} <span className="text-[10px] text-slate-300">accounts</span></span>
             </div>
          </div>
        </div>
        
        <button 
          onClick={() => { setEditingCustomer(null); setIsModalOpen(true); }}
          className="flex items-center justify-center space-x-3 bg-slate-900 text-white px-10 py-5 rounded-3xl text-sm font-black uppercase tracking-widest shadow-2xl active:scale-95 transition-all group lg:mt-8"
        >
          <Plus className="h-5 w-5" />
          <span>New Customer</span>
        </button>
      </header>

      <div className="vibrant-card p-6 flex items-center gap-6">
        <div className="relative flex-1 group">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-indigo-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Search by name or phone number..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-16 pr-8 py-5 bg-slate-50/50 border-2 border-slate-50 rounded-[2rem] text-sm focus:outline-none focus:border-slate-200 focus:bg-white transition-all font-black text-slate-900 placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {isLoading ? (
           Array(6).fill(0).map((_, i) => <div key={i} className="h-48 bg-white/50 rounded-[3rem] animate-pulse" />)
        ) : filteredCustomers.map((customer, i) => (
          <motion.div 
            key={customer.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="vibrant-card p-8 group overflow-hidden relative"
          >
            <div className="flex justify-between items-start mb-6">
               <div className="flex items-center gap-4">
                  <div className="h-12 w-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                     <User className="h-6 w-6" />
                  </div>
                  <div>
                     <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase">{customer.name}</h3>
                     <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{customer.phone}</p>
                  </div>
               </div>
               <DropdownMenu>
                  <DropdownMenuTrigger>
                    <span className="p-2 rounded-lg hover:bg-slate-50 text-slate-300 transition-colors cursor-pointer flex items-center justify-center"><MoreHorizontal className="h-4 w-4" /></span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="rounded-xl">
                    <DropdownMenuItem 
                      onClick={() => { 
                        setEditingCustomer(customer); 
                        setFormData({
                          name: customer.name,
                          phone: customer.phone,
                          email: customer.email || '',
                          address: customer.address || ''
                        }); 
                        setIsModalOpen(true); 
                      }} 
                      className="rounded-lg font-bold"
                    >
                      <Edit className="mr-2 h-3 w-3" /> Edit Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => deleteCustomer(customer.id)} className="rounded-lg font-bold text-rose-500"><Trash className="mr-2 h-3 w-3" /> Delete Account</DropdownMenuItem>
                  </DropdownMenuContent>
               </DropdownMenu>
            </div>

            <div className="space-y-4 mb-6">
               {customer.email && (
                 <div className="flex items-center gap-3 text-xs text-slate-500 font-bold">
                    <Mail className="h-3 w-3" /> {customer.email}
                 </div>
               )}
               {customer.address && (
                 <div className="flex items-center gap-3 text-xs text-slate-500 font-bold">
                    <MapPin className="h-3 w-3" /> {customer.address}
                 </div>
               )}
            </div>

            <div className="flex justify-between items-end border-t border-slate-50 pt-6">
               <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Spent</span>
                  <span className="text-xl font-black font-mono italic text-slate-900">{formatCurrency(customer.totalSpent || 0)}</span>
               </div>
               <div className="text-right">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Balance Due</span>
                  <div className={cn("font-mono font-black", customer.debt > 0 ? "text-rose-500" : "text-emerald-500")}>
                    {formatCurrency(customer.debt || 0)}
                  </div>
               </div>
            </div>

            <button className="mt-8 w-full py-4 bg-slate-50 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center gap-2 group/btn">
               View Activity <ChevronRight className="h-3 w-3 group-hover/btn:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        ))}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-xl rounded-[3rem] p-10">
          <DialogHeader className="mb-8">
            <DialogTitle className="text-5xl font-black uppercase tracking-tighter italic text-slate-900 leading-none mb-2">
              {editingCustomer ? 'Edit Item' : 'New Account'}
            </DialogTitle>
            <DialogDescription className="text-slate-400 font-bold text-[10px] uppercase tracking-widest italic leading-none">
              Enter customer details for {profile?.storeName || 'Active Store'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-6">
             <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-900 ml-2">Full Name</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-6 py-4 font-bold outline-none focus:border-slate-900 transition-all" />
             </div>
             <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Phone</label>
                   <input required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-6 py-4 font-bold outline-none focus:border-slate-900 transition-all" />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Email (Opt)</label>
                   <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-6 py-4 font-bold outline-none focus:border-slate-900 transition-all" />
                </div>
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Address</label>
                <textarea value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-6 py-4 font-bold outline-none focus:border-slate-900 transition-all h-24" />
             </div>
             
             <div className="flex gap-4 pt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-5 rounded-2xl font-black text-slate-400 uppercase tracking-widest text-[10px]">Cancel</button>
                <button type="submit" disabled={isSaving} className="flex-[2] py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-[0.3em] text-[10px] shadow-xl hover:bg-slate-950 transition-all disabled:opacity-50">
                  {isSaving ? 'Processing...' : 'Save Account'}
                </button>
             </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Customers;
