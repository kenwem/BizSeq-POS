import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  useSuppliers, 
  useSupplierTransactions, 
  Supplier, 
  SupplierTransaction, 
  ProductSuppliedEntry 
} from '../hooks/useSuppliers';
import { 
  Plus, 
  Search, 
  Truck, 
  Phone, 
  User, 
  Trash, 
  Edit, 
  MoreHorizontal,
  ChevronRight,
  TrendingUp,
  Mail,
  MapPin,
  Calendar,
  Clock,
  DollarSign,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  MessageSquare,
  ShieldAlert,
  Wallet,
  Play,
  Layers,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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

// Helper for numeric input comma formatting
const formatCommaNumber = (val: string | number) => {
  if (val === undefined || val === null || val === '') return '';
  const clean = String(val).replace(/,/g, '');
  if (isNaN(Number(clean))) return '';
  const parts = clean.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

const parseCommaNumber = (str: string) => {
  if (!str) return 0;
  return parseFloat(str.replace(/,/g, '')) || 0;
};

// Extract first numeric match from string quantity (e.g. "5 kg" -> 5)
const parseNumericFromQuantity = (q: string): number => {
  const match = q.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 1;
};

// Safe JSON parser for products supplied to ensure it never crashes
const safeParseProductsSupplied = (input: any): any[] => {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'object') {
    if (Array.isArray(input.products)) return input.products;
    return [input];
  }
  try {
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
        return [parsed];
      }
      return [{ productName: trimmed, quantity: '1', price: '0', date: new Date().toISOString() }];
    }
  } catch (e) {
    console.warn("Failed to parse products supplied:", e);
  }
  return [{ productName: String(input), quantity: '1', price: '0', date: new Date().toISOString() }];
};

const Suppliers: React.FC = () => {
  const { profile } = useAuth();
  const { suppliers, isLoading, addSupplier, updateSupplier, deleteSupplier } = useSuppliers(profile?.storeId);
  
  // Dashboard & Views navigation state
  const [activeSupplier, setActiveSupplier] = useState<Supplier | null>(null);
  
  // Search & List filters
  const [search, setSearch] = useState('');
  
  // Modals visibility state
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  
  // Dynamic supplier addition modal states (Add/Edit)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    phone: '',
    whatsappNumber: '',
    email: '',
    address: '',
    totalAmount: '', // Formatted comma input
    partPayment: '', // Formatted comma input
    notes: ''
  });
  
  // Products Supplied sub-list on Supplier Creation Form
  const [tempProducts, setTempProducts] = useState<ProductSuppliedEntry[]>([]);
  const [showProductsCollapsible, setShowProductsCollapsible] = useState(false);
  
  // Create / add single product form inside modal
  const [newProductForm, setNewProductForm] = useState({
    productName: '',
    quantity: '',
    price: ''
  });

  // Transaction form states (for Details mode)
  const [txFormType, setTxFormType] = useState<'purchase' | 'payment'>('purchase');
  const [txAmount, setTxAmount] = useState(''); // Purchase total amount
  const [txAmountPaid, setTxAmountPaid] = useState(''); // Paid amount
  const [txNotes, setTxNotes] = useState('');
  const [txProducts, setTxProducts] = useState<ProductSuppliedEntry[]>([]);
  const [showTxProductsCollapsible, setShowTxProductsCollapsible] = useState(false);

  // Active supplier transactions listener (only active when Details is open)
  const { 
    transactions, 
    isLoading: isTxLoading, 
    error: txError,
    addTransaction: submitNewTransaction 
  } = useSupplierTransactions(activeSupplier?.id, profile?.storeId);

  // Auto scroll top when viewing details
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeSupplier?.id]);

  // Sync details activeSupplier with updated collection in real-time
  const refreshedActiveSupplier = useMemo(() => {
    if (!activeSupplier) return null;
    return suppliers.find(s => s.id === activeSupplier.id) || activeSupplier;
  }, [suppliers, activeSupplier]);

  // Computed balance summary for the list page
  const totalOutstandingBalance = useMemo(() => {
    return suppliers.reduce((acc, s) => acc + (s.balance || 0), 0);
  }, [suppliers]);

  // Normalise WhatsApp URL opening
  const getWhatsAppUrl = (phoneStr: string) => {
    let clean = phoneStr.replace(/\D/g, '');
    if (clean.startsWith('0') && clean.length === 11) {
      clean = '234' + clean.substring(1);
    }
    return `https://wa.me/${clean}`;
  };

  // Grouped transaction cards with running balances
  const groupedTransactions = useMemo(() => {
    
    if (!refreshedActiveSupplier) return [];

    let txList = [...(transactions || [])];

    // Check if we need to synthesize virtual initial transactions for legacy/stranded documents
    const hasPurchase = txList.some(t => t.type === 'purchase');
    const initialAmt = refreshedActiveSupplier.totalAmount || refreshedActiveSupplier.balance || 0;

    if (!hasPurchase && initialAmt > 0) {
      
      const reference = `INIT-${refreshedActiveSupplier.id.substring(0, 8).toUpperCase()}`;
      const mockDate = refreshedActiveSupplier.createdAt || refreshedActiveSupplier.updatedAt || new Date().toISOString();
      
      // Virtual initial purchase
      const virtualPurchase: SupplierTransaction = {
        id: `virtual-purchase-${refreshedActiveSupplier.id}`,
        supplierId: refreshedActiveSupplier.id,
        storeId: refreshedActiveSupplier.storeId || '',
        type: 'purchase',
        amount: initialAmt,
        date: mockDate,
        reference,
        notes: refreshedActiveSupplier.notes || 'Initial supply',
        productSupplied: refreshedActiveSupplier.productsSupplied || '',
        createdBy: refreshedActiveSupplier.email || 'system',
        createdAt: mockDate
      };
      
      txList.push(virtualPurchase);

      // Virtual initial part payment if any
      const initialPartPayment = initialAmt - (refreshedActiveSupplier.balance || 0);
      if (initialPartPayment > 0) {
        const virtualPayment: SupplierTransaction = {
          id: `virtual-payment-${refreshedActiveSupplier.id}`,
          supplierId: refreshedActiveSupplier.id,
          storeId: refreshedActiveSupplier.storeId || '',
          type: 'payment',
          amount: initialPartPayment,
          date: mockDate,
          reference,
          notes: 'Initial part payment',
          createdBy: refreshedActiveSupplier.email || 'system',
          createdAt: mockDate
        };
        txList.push(virtualPayment);
      }
    }

    if (txList.length === 0) {
      return [];
    }

    const groups: Record<string, { reference: string; date: string; purchase?: SupplierTransaction; payment?: SupplierTransaction }> = {};
    
    // Sort chronological first to process correct running balances
    const sorted = txList.sort((a, b) => {
      const getTimestamp = (tx: any) => {
        if (tx.createdAt?.seconds) return tx.createdAt.seconds * 1000;
        if (tx.createdAt?.toDate) return tx.createdAt.toDate().getTime();
        if (tx.date) return new Date(tx.date).getTime();
        if (tx.createdAt) return new Date(tx.createdAt).getTime();
        return 0;
      };
      return getTimestamp(a) - getTimestamp(b);
    });

    let runningBalance = 0;
    const results: Array<{
      reference: string;
      date: string;
      purchase?: SupplierTransaction;
      payment?: SupplierTransaction;
      runningBalanceBefore: number;
      runningBalanceAfter: number;
    }> = [];

    sorted.forEach(tx => {
      if (!groups[tx.reference]) {
        groups[tx.reference] = {
          reference: tx.reference,
          date: tx.date || tx.createdAt
        };
      }
      if (tx.type === 'purchase') {
        groups[tx.reference].purchase = tx;
      } else {
        groups[tx.reference].payment = tx;
      }
    });

    const groupRefs = Array.from(new Set(sorted.map(tx => tx.reference)));
    
    groupRefs.forEach(ref => {
      const grp = groups[ref];
      const before = runningBalance;
      
      if (grp.purchase) {
        runningBalance += grp.purchase.amount;
      }
      if (grp.payment) {
        runningBalance -= grp.payment.amount;
      }
      
      results.push({
        ...grp,
        runningBalanceBefore: before,
        runningBalanceAfter: runningBalance
      });
    });

    // Return in descending order (newest first) for visual display
    return results.reverse();
  }, [transactions, refreshedActiveSupplier]);

  // Local filter for search
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(search.toLowerCase()) || 
      s.phone.toLowerCase().includes(search.toLowerCase()) ||
      (s.email && s.email.toLowerCase().includes(search.toLowerCase()))
    );
  }, [suppliers, search]);

  // Product summation logic inside ADD form
  useEffect(() => {
    if (!editingSupplier && tempProducts.length > 0) {
      const sum = tempProducts.reduce((acc, p) => {
        const qty = parseNumericFromQuantity(p.quantity);
        const uPrice = parseCommaNumber(p.price);
        return acc + (qty * uPrice);
      }, 0);

      setSupplierForm(prev => ({
        ...prev,
        totalAmount: formatCommaNumber(sum)
      }));
    }
  }, [tempProducts, editingSupplier]);

  // Transaction form sum calculator
  useEffect(() => {
    if (txFormType === 'purchase' && txProducts.length > 0) {
      const sum = txProducts.reduce((acc, p) => {
        const qty = parseNumericFromQuantity(p.quantity);
        const uPrice = parseCommaNumber(p.price);
        return acc + (qty * uPrice);
      }, 0);
      setTxAmount(formatCommaNumber(sum));
    }
  }, [txProducts, txFormType]);

  // Add Product to Create-Supplier Form List
  const handleAddTempProduct = () => {
    if (!newProductForm.productName.trim()) {
      alert("Please enter a product name.");
      return;
    }
    const cleanPrice = String(parseCommaNumber(newProductForm.price));
    const newEntry: ProductSuppliedEntry = {
      productName: newProductForm.productName.trim(),
      quantity: newProductForm.quantity.trim() || '1',
      price: cleanPrice,
      date: new Date().toISOString()
    };
    
    if (isTxModalOpen) {
      setTxProducts([...txProducts, newEntry]);
    } else {
      setTempProducts([...tempProducts, newEntry]);
    }

    setNewProductForm({ productName: '', quantity: '', price: '' });
    setIsAddProductModalOpen(false);
  };

  const [saving, setSaving] = useState(false);

  // Handle Save / Update Supplier Form
  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.storeId) {
      alert("No active store identity found. Refresh page.");
      return;
    }

    const emailRegex = /^\S+@\S+\.\S+$/;
    if (supplierForm.email && !emailRegex.test(supplierForm.email)) {
      alert("Please enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      if (editingSupplier) {
        // Edit Profile contact fields only
        await updateSupplier(editingSupplier.id, {
          name: supplierForm.name,
          phone: supplierForm.phone,
          whatsappNumber: supplierForm.whatsappNumber || '',
          email: supplierForm.email || '',
          address: supplierForm.address || '',
          notes: supplierForm.notes || '',
        });
        alert("Supplier profile updated successfully!");
      } else {
        // Create new supplier + First transaction
        const total = parseCommaNumber(supplierForm.totalAmount);
        const part = parseCommaNumber(supplierForm.partPayment);

        if (part > total) {
          alert("Part payment cannot exceed the total supply amount.");
          setSaving(false);
          return;
        }

        await addSupplier({
          storeId: profile.storeId,
          name: supplierForm.name,
          phone: supplierForm.phone,
          whatsappNumber: supplierForm.whatsappNumber || '',
          email: supplierForm.email || '',
          address: supplierForm.address || '',
          notes: supplierForm.notes || '',
          status: 'active'
        }, total, part, tempProducts);

        alert("Supplier and initial transactions saved!");
      }

      setIsSupplierModalOpen(false);
      setEditingSupplier(null);
      resetSupplierForm();
    } catch (err: any) {
      console.error(err);
      alert(`Save Failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const resetSupplierForm = () => {
    setSupplierForm({
      name: '',
      phone: '',
      whatsappNumber: '',
      email: '',
      address: '',
      totalAmount: '',
      partPayment: '',
      notes: ''
    });
    setTempProducts([]);
    setShowProductsCollapsible(false);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this supplier? This action clears all transaction logs.")) {
      try {
        await deleteSupplier(id);
        setActiveSupplier(null);
        alert("Supplier deleted.");
      } catch (err: any) {
        alert(`Delete failed: ${err.message}`);
      }
    }
  };

  // Add transaction from Supplier details Modal
  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refreshedActiveSupplier) return;

    const tAmt = parseCommaNumber(txAmount);
    const tPaid = parseCommaNumber(txAmountPaid);

    if (txFormType === 'payment') {
      if (tPaid <= 0) {
        alert("Please enter a payment amount.");
        return;
      }
      if (tPaid > refreshedActiveSupplier.balance) {
        alert("Payment cannot be greater than the outstanding balance.");
        return;
      }
    } else {
      if (tAmt <= 0) {
        alert("Please enter a transaction amount.");
        return;
      }
      if (tPaid > (refreshedActiveSupplier.balance + tAmt)) {
        alert(`Payment cannot exceed current balance plus new transaction (Max: ${formatCurrency(refreshedActiveSupplier.balance + tAmt)})`);
        return;
      }
    }

    setSaving(true);
    try {
      await submitNewTransaction(profile?.email || 'operator', {
        type: txFormType,
        amount: txFormType === 'purchase' ? tAmt : 0,
        amountPaid: tPaid,
        productSupplied: txFormType === 'purchase' ? txProducts : [],
        notes: txNotes
      });
      setIsTxModalOpen(false);
      setTxAmount('');
      setTxAmountPaid('');
      setTxNotes('');
      setTxProducts([]);
      setShowTxProductsCollapsible(false);
      alert("Transaction processed successfully.");
    } catch (err: any) {
      alert(`Failed to add transaction: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Format reactive preview balances in add transaction context
  const previewTxBalance = useMemo(() => {
    if (!refreshedActiveSupplier) return 0;
    const current = refreshedActiveSupplier.balance;
    const tAmt = parseCommaNumber(txAmount);
    const tPaid = parseCommaNumber(txAmountPaid);

    if (txFormType === 'payment') {
      return Math.max(0, current - tPaid);
    } else {
      return current + (tAmt - tPaid);
    }
  }, [refreshedActiveSupplier, txAmount, txAmountPaid, txFormType]);

  return (
    <div className="max-w-7xl mx-auto space-y-12 pb-24 px-4 sm:px-6">
      
      {/* -------------------------------------------------------------
          VIEW A: SUPPLIER DETAILS VIEW
          ------------------------------------------------------------- */}
      {refreshedActiveSupplier ? (
        <div className="space-y-8 animate-fadeIn">
          {/* Header navigation bar */}
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-100 pb-8">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setActiveSupplier(null)}
                className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 transition-all shadow-sm active:scale-95"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Supplier Ledger</span>
                <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight leading-none uppercase mt-1">
                  {refreshedActiveSupplier.name}
                </h1>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-4">
              <div className="px-6 py-4 bg-slate-900 text-white rounded-3xl flex flex-col justify-center min-w-[200px] shadow-xl">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Total Owed (Balance)</span>
                <span className={cn(
                  "text-2xl font-black font-mono italic",
                  refreshedActiveSupplier.balance > 0 ? "text-rose-400" : "text-emerald-400"
                )}>
                  {formatCurrency(refreshedActiveSupplier.balance)}
                </span>
              </div>
              
              <button 
                onClick={() => {
                  setEditingSupplier(refreshedActiveSupplier);
                  setSupplierForm({
                    name: refreshedActiveSupplier.name,
                    phone: refreshedActiveSupplier.phone,
                    whatsappNumber: refreshedActiveSupplier.whatsappNumber || '',
                    email: refreshedActiveSupplier.email || '',
                    address: refreshedActiveSupplier.address || '',
                    totalAmount: '',
                    partPayment: '',
                    notes: refreshedActiveSupplier.notes || ''
                  });
                  setIsSupplierModalOpen(true);
                }}
                className="p-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-2xl transition-all active:scale-95"
                title="Edit Profile"
              >
                <Edit className="h-5 w-5" />
              </button>
              
              <button 
                onClick={() => handleDelete(refreshedActiveSupplier.id)}
                className="p-4 bg-rose-50 text-rose-500 hover:bg-rose-100 border border-rose-100 rounded-2xl transition-all active:scale-95"
                title="Delete Supplier"
              >
                <Trash className="h-5 w-5" />
              </button>
            </div>
          </header>

          {/* Contact Details card */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <div className="vibrant-card p-8 space-y-6 bg-white border border-slate-100 shadow-sm">
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter border-b border-slate-50 pb-3">
                  Vendor Information
                </h3>
                
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-2xl hover:bg-slate-100/70 transition-colors">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Phone</span>
                      <a href={`tel:${refreshedActiveSupplier.phone}`} className="text-sm font-black text-slate-900 hover:underline">
                        {refreshedActiveSupplier.phone}
                      </a>
                    </div>
                  </div>

                  {refreshedActiveSupplier.whatsappNumber && (
                    <div className="flex items-center gap-4 p-3 bg-emerald-50/50 rounded-2xl hover:bg-emerald-50 transition-colors">
                      <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                        <MessageSquare className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">WhatsApp</span>
                        <a 
                          href={getWhatsAppUrl(refreshedActiveSupplier.whatsappNumber)}
                          target="_blank" 
                          referrerPolicy="no-referrer"
                          className="text-sm font-black text-emerald-700 hover:underline"
                        >
                          {refreshedActiveSupplier.whatsappNumber}
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-2xl hover:bg-slate-100/70 transition-colors">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Email</span>
                      <span className="text-sm font-black text-slate-900 truncate block">
                        {refreshedActiveSupplier.email || 'No email registered'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-2xl hover:bg-slate-100/70 transition-colors">
                    <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Address</span>
                      <p className="text-xs font-bold text-slate-600 leading-relaxed">
                        {refreshedActiveSupplier.address || 'No address registered'}
                      </p>
                    </div>
                  </div>
                </div>

                {refreshedActiveSupplier.notes && (
                  <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-2xl">
                    <span className="text-[9px] font-black uppercase text-orange-700 tracking-wider block mb-1">Internal Notes</span>
                    <p className="text-xs font-bold text-slate-600 italic">"{refreshedActiveSupplier.notes}"</p>
                  </div>
                )}
              </div>

              {/* Instant action block */}
              <div className="vibrant-card p-6 bg-slate-900 text-white space-y-3 shadow-xl rounded-3xl">
                <h4 className="text-sm font-black uppercase tracking-tight">Ledger Panel</h4>
                <p className="text-xs text-slate-400 font-bold leading-normal">
                  Record purchases or payments to update the balance.
                </p>
                <button
                  onClick={() => {
                    setTxFormType('purchase');
                    setTxProducts([]);
                    setIsTxModalOpen(true);
                  }}
                  className="w-full py-3.5 bg-slate-800 hover:bg-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 border border-slate-700 active:scale-95"
                >
                  <Plus className="h-4 w-4 text-emerald-400" />
                  <span>Add Transaction</span>
                </button>
              </div>
            </div>

            {/* Transaction log cards container */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Transaction History</span>
                <span className="text-xs font-mono font-black text-slate-900">{groupedTransactions.length} events logged</span>
              </div>

              {isTxLoading ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-slate-100">
                  <div className="h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-800 animate-spin mb-4" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading ledger...</span>
                </div>
              ) : groupedTransactions.length === 0 ? (
                <div className="py-20 text-center bg-white rounded-[3rem] border border-slate-100 flex flex-col items-center justify-center p-8 space-y-4">
                  <div className="p-4 bg-slate-50 text-slate-300 rounded-full">
                    <Layers className="h-8 w-8" />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-slate-800 uppercase">No registered transactions</h4>
                    <p className="text-xs font-bold text-slate-400 mt-1">Transactions will be listed here chronologically once recorded.</p>
                    {txError && (
                      <p className="text-xs font-mono text-rose-500 bg-rose-50 border border-rose-100 rounded-2xl p-4 mt-4 max-w-md mx-auto">
                        Diagnostics Error: {txError.message}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedTransactions.map((group, idx) => (
                    <motion.div
                      key={group.reference}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="bg-white border-2 border-slate-100 rounded-[2.5rem] p-6 lg:p-8 shadow-sm hover:border-slate-300 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-50 pb-4 mb-4">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-slate-900 animate-pulse" />
                          <span className="text-[10px] font-mono font-black text-slate-500 tracking-wider">REF: {group.reference}</span>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                            <span className="text-slate-600">{new Date(group.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                          </div>
                          <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
                            <Clock className="h-3.5 w-3.5 text-amber-500" />
                            <span className="text-slate-600">{new Date(group.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-5">
                        {/* Transaction Event: New Purchase Details */}
                        {group.purchase && (
                          <div className="space-y-3">
                            <div className="flex justify-between items-start">
                              <div className="flex items-start gap-3">
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                                  <Truck className="h-4 w-4" />
                                </div>
                                <div>
                                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest block">Supply Purchase</span>
                                  <span className="text-sm font-black text-slate-800">
                                    Total: <span className="font-mono text-indigo-600 font-extrabold">{formatCurrency(group.purchase.amount)}</span>
                                  </span>
                                  <div className="flex flex-wrap gap-2 mt-1.5 items-center">
                                    {group.purchase.notes && (
                                      <span className="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">
                                        "{group.purchase.notes}"
                                      </span>
                                    )}
                                    {group.purchase.createdBy && (
                                      <span className="text-[9px] font-mono font-black text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded-md">
                                        By: {group.purchase.createdBy.split('@')[0]}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Products supplied embedded inside this purchase */}
                            {(() => {
                              const products = safeParseProductsSupplied(group.purchase.productSupplied);
                              if (products.length === 0) return null;
                              return (
                                <div className="pl-10 space-y-2">
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                                    Products:
                                  </span>
                                  <div className="bg-slate-50/70 border border-slate-100 p-4 rounded-2xl grid gap-2.5 shadow-inner">
                                    {products.map((p: any, pIdx: number) => (
                                      <div 
                                        key={pIdx} 
                                        className="flex justify-between items-center text-xs font-bold text-slate-600 border-b border-slate-100/70 last:border-0 pb-2 last:pb-0"
                                      >
                                        <div className="flex flex-col">
                                          <span className="uppercase text-slate-800 font-black tracking-tight">{p.productName}</span>
                                          {p.date && (
                                            <span className="text-[8px] text-slate-400 font-mono">
                                              Date: {new Date(p.date || group.date).toLocaleDateString(undefined, { dateStyle: 'short' })}
                                            </span>
                                          )}
                                        </div>
                                        <span className="font-mono bg-indigo-50/50 text-indigo-700 px-2.5 py-1 rounded-lg text-xs font-black">
                                          {p.quantity} × <span className="text-indigo-950">{formatCurrency(p.price)}</span>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* Transaction Event: Payment Details */}
                        {group.payment && (
                          <div className="flex justify-between items-start pt-3 border-t border-dashed border-slate-100">
                            <div className="flex items-start gap-3">
                              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                                <Wallet className="h-4 w-4" />
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest block">Payment</span>
                                <span className="text-sm font-black text-emerald-600">
                                  Paid: <span className="font-mono font-extrabold">{formatCurrency(group.payment.amount)}</span>
                                </span>
                                <div className="flex flex-wrap gap-2 mt-1.5 items-center">
                                  {group.payment.notes && (
                                    <span className="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">
                                      "{group.payment.notes}"
                                    </span>
                                  )}
                                  {group.payment.createdBy && (
                                    <span className="text-[9px] font-mono font-black text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded-md">
                                      By: {group.payment.createdBy.split('@')[0]}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Balance display outcomes */}
                        <div className="bg-slate-50 p-4 rounded-2xl flex flex-wrap justify-between items-center text-xs gap-4 mt-2">
                          <div className="flex items-center gap-4">
                            <div>
                              <span className="text-[8px] font-black uppercase text-slate-400 block tracking-widest">Opening Bal</span>
                              <span className="font-mono font-bold text-slate-600">{formatCurrency(group.runningBalanceBefore)}</span>
                            </div>
                            <span className="text-slate-200">→</span>
                            <div>
                              <span className="text-[8px] font-black uppercase text-slate-400 block tracking-widest">Closing Bal</span>
                              <span className="font-mono font-extrabold text-slate-950">{formatCurrency(group.runningBalanceAfter)}</span>
                            </div>
                          </div>
                          
                          <span className={cn(
                            "px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest",
                            group.runningBalanceAfter > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                          )}>
                            {group.runningBalanceAfter > 0 ? 'Outstanding Owed' : 'Cleared Ledger'}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (

        /* -------------------------------------------------------------
            VIEW B: SUPPLIERS DIRECTORY LISTING
            ------------------------------------------------------------- */
        <div className="space-y-12">
          {/* Header element with metrics */}
          <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
            <div className="space-y-4">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2"
              >
                <div className="p-2 bg-slate-900 rounded-lg shadow-lg">
                  <Truck className="h-4 w-4 text-white" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Supply Chain Dashboard</span>
              </motion.div>
              <h1 className="text-5xl md:text-6xl font-black tracking-tight text-slate-950 leading-none">Suppliers</h1>
              
              <div className="flex flex-wrap gap-6 pt-4">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Vendors</span>
                  <span className="text-xl font-black font-mono text-slate-900 italic">{suppliers.length}</span>
                </div>
                <div className="w-px h-10 bg-slate-100" />
                <div className="flex flex-col font-sans">
                  <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 font-sans">Payable Outstandings</span>
                  <span className={cn(
                    "text-xl font-black font-mono italic",
                    totalOutstandingBalance > 0 ? "text-rose-600" : "text-emerald-600"
                  )}>
                    {formatCurrency(totalOutstandingBalance)}
                  </span>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => { 
                setEditingSupplier(null); 
                resetSupplierForm();
                setIsSupplierModalOpen(true); 
              }}
              className="flex items-center justify-center space-x-3 bg-slate-900 text-white px-10 py-5 rounded-3xl text-sm font-black uppercase tracking-widest shadow-2xl active:scale-95 transition-all group lg:mt-8"
            >
              <Plus className="h-5 w-5 text-emerald-400" />
              <span>Register Vendor</span>
            </button>
          </header>

          {/* Search tool block */}
          <div className="vibrant-card p-6 flex items-center gap-6">
            <div className="relative flex-1 group">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-slate-800 transition-colors" />
              <input 
                type="text" 
                placeholder="Search suppliers by business name, phone, or email..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-16 pr-8 py-5 bg-slate-50/50 border-2 border-slate-50 rounded-[2rem] text-sm focus:outline-none focus:border-slate-200 focus:bg-white transition-all font-black text-slate-900 placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Grid display cards of suppliers */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {isLoading ? (
              Array(3).fill(0).map((_, i) => <div key={i} className="h-48 bg-white/50 rounded-[3rem] animate-pulse border border-slate-100" />)
            ) : filteredSuppliers.length === 0 ? (
              <div className="col-span-full py-20 text-center bg-white border border-slate-100 rounded-[3rem] flex flex-col items-center justify-center p-8 space-y-4">
                <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No suppliers found matching query</p>
              </div>
            ) : filteredSuppliers.map((supplier, i) => (
              <motion.div 
                key={supplier.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="vibrant-card p-8 group bg-white border border-slate-100 hover:shadow-xl transition-all relative flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-700 group-hover:bg-slate-950 group-hover:text-white transition-all">
                        <Truck className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase line-clamp-1">{supplier.name}</h3>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">{supplier.phone}</span>
                      </div>
                    </div>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <span className="p-2 rounded-lg hover:bg-slate-100 text-slate-300 transition-colors cursor-pointer flex items-center justify-center">
                          <MoreHorizontal className="h-4 w-4 text-slate-500" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl p-2 min-w-[150px]">
                        <DropdownMenuItem 
                          onClick={() => { 
                            setEditingSupplier(supplier); 
                            setSupplierForm({
                              name: supplier.name,
                              phone: supplier.phone,
                              whatsappNumber: supplier.whatsappNumber || '',
                              email: supplier.email || '',
                              address: supplier.address || '',
                              totalAmount: '',
                              partPayment: '',
                              notes: supplier.notes || ''
                            }); 
                            setIsSupplierModalOpen(true); 
                          }} 
                          className="rounded-lg font-bold text-xs flex items-center gap-2 cursor-pointer"
                        >
                          <Edit className="h-3.5 w-3.5" /> Edit Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDelete(supplier.id)} 
                          className="rounded-lg font-bold text-xs text-rose-500 flex items-center gap-2 cursor-pointer focus:bg-rose-50"
                        >
                          <Trash className="h-3.5 w-3.5" /> Delete Vendor
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Body contact rows */}
                  <div className="space-y-3 mb-8 border-b border-slate-50 pb-6 text-xs text-slate-500 font-bold">
                    {supplier.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{supplier.email}</span>
                      </div>
                    )}
                    {supplier.address && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{supplier.address}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Balance summary */}
                <div className="flex justify-between items-end">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Outstanding balance</span>
                    <div className={cn(
                      "text-2xl font-black font-mono italic leading-none mt-1", 
                      (supplier.balance || 0) > 0 ? "text-rose-600" : "text-emerald-600"
                    )}>
                      {formatCurrency(supplier.balance || 0)}
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => setActiveSupplier(supplier)}
                    className="p-4 bg-slate-50 rounded-2xl text-slate-700 hover:bg-slate-900 hover:text-white transition-all active:scale-90 shadow-sm"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          MODAL: ADD / EDIT SUPPLIER DIALOG
          ------------------------------------------------------------- */}
      <Dialog open={isSupplierModalOpen} onOpenChange={setIsSupplierModalOpen}>
        <DialogContent className="max-w-xl rounded-[3rem] p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <DialogHeader className="mb-6 relative border-b border-slate-50 pb-4">
            <DialogTitle className="text-4xl font-black uppercase tracking-tighter italic text-slate-900 leading-none">
              {editingSupplier ? 'Edit Profile' : 'Register Supplier'}
            </DialogTitle>
            <DialogDescription className="text-slate-400 font-bold text-[10px] uppercase tracking-widest italic mt-1">
              Configure vendor relationships & account credentials
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveSupplier} className="space-y-6">
            
            {/* Field 1: Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Business Name *</label>
              <input 
                required 
                type="text"
                placeholder="kenny"
                value={supplierForm.name} 
                onChange={e => setSupplierForm({...supplierForm, name: e.target.value})} 
                className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800" 
              />
            </div>

            {/* Field 2 & 3: Phone & WhatsApp */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Phone Number *</label>
                <input 
                  required 
                  type="tel"
                  placeholder="Enter phone number"
                  value={supplierForm.phone} 
                  onChange={e => setSupplierForm({...supplierForm, phone: e.target.value})} 
                  className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">WhatsApp Number</label>
                <input 
                  type="tel"
                  placeholder="e.g. 08012345678"
                  value={supplierForm.whatsappNumber} 
                  onChange={e => setSupplierForm({...supplierForm, whatsappNumber: e.target.value})} 
                  className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800" 
                />
              </div>
            </div>

            {/* Field 4: Email */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-5050 ml-2">Email address</label>
              <input 
                type="email"
                placeholder="kenny@example.com"
                value={supplierForm.email} 
                onChange={e => setSupplierForm({...supplierForm, email: e.target.value})} 
                className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800" 
              />
            </div>

            {/* Field 5: Address */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Physical Address</label>
              <textarea 
                rows={3}
                placeholder="Enter supplier address"
                value={supplierForm.address} 
                onChange={e => setSupplierForm({...supplierForm, address: e.target.value})} 
                className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800 resize-none min-h-[100px]" 
              />
            </div>

            {/* Field: Notes */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Internal Notes</label>
              <input 
                type="text"
                placeholder="Extra details about vendor"
                value={supplierForm.notes} 
                onChange={e => setSupplierForm({...supplierForm, notes: e.target.value})} 
                className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800" 
              />
            </div>

            {/* Transaction details (Only displays when creating new vendor, block on edit profile) */}
            {!editingSupplier && (
              <div className="border-t border-dashed border-slate-100 pt-6 space-y-6">
                <span className="text-[11px] font-black uppercase tracking-widest text-indigo-500 block mb-4">Initial Supply Log</span>
                
                {/* Collapsible products supplied widget */}
                <div className="bg-slate-50 p-4 rounded-3xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-black uppercase text-slate-800">Products Supplied</h4>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{tempProducts.length} added items</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setNewProductForm({ productName: '', quantity: '', price: '' });
                          setIsAddProductModalOpen(true);
                        }}
                        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-[9px] font-black uppercase tracking-wider transition-colors"
                      >
                        Add Product
                      </button>
                      
                      {tempProducts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowProductsCollapsible(!showProductsCollapsible)}
                          className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
                        >
                          {showProductsCollapsible ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Render inline product lines */}
                  {showProductsCollapsible && tempProducts.length > 0 && (
                    <div className="bg-white rounded-2xl p-2 border border-slate-100 space-y-2 max-h-[150px] overflow-y-auto">
                      {tempProducts.map((p, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs p-2 hover:bg-slate-50 rounded-xl border-b border-slate-50 last:border-0 last:pb-0">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-800 uppercase">{p.productName}</span>
                            <span className="text-[9px] font-bold text-slate-400">Qty: {p.quantity}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-slate-900 font-extrabold">{formatCurrency(p.price)}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const flt = tempProducts.filter((_, i) => i !== idx);
                                setTempProducts(flt);
                              }}
                              className="p-1 hover:bg-rose-50 text-rose-500 rounded-lg transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Supply amounts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Total Supply Amount *</label>
                    <input 
                      required 
                      type="text"
                      placeholder="0.00"
                      value={supplierForm.totalAmount}
                      onChange={e => {
                        const numeric = parseCommaNumber(e.target.value);
                        setSupplierForm({ ...supplierForm, totalAmount: formatCommaNumber(numeric) });
                      }}
                      className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-indigo-600 font-mono" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Part Payment *</label>
                    <input 
                      required 
                      type="text"
                      placeholder="0.00"
                      value={supplierForm.partPayment === '0' ? '' : supplierForm.partPayment}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === '') {
                          setSupplierForm({ ...supplierForm, partPayment: '0' });
                        } else {
                          const numeric = parseCommaNumber(val);
                          setSupplierForm({ ...supplierForm, partPayment: formatCommaNumber(numeric) });
                        }
                      }}
                      className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-emerald-600 font-mono" 
                    />
                  </div>
                </div>

                {/* Read-only balance preview */}
                <div className="p-4 bg-slate-950 text-white rounded-3xl flex justify-between items-center">
                  <div>
                    <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Estimated Outstanding Payable Balance</span>
                    <span className="block text-xs font-bold text-slate-300 italic">Auto-calculated from total and part payments</span>
                  </div>
                  <span className="text-xl font-black font-mono italic text-rose-400 pr-2">
                    {formatCurrency(parseCommaNumber(supplierForm.totalAmount) - parseCommaNumber(supplierForm.partPayment))}
                  </span>
                </div>
              </div>
            )}

            {/* Cancel & Trigger actions */}
            <div className="flex gap-4 pt-6 border-t border-slate-50">
              <button 
                type="button" 
                onClick={() => setIsSupplierModalOpen(false)} 
                className="flex-1 py-5 rounded-2xl font-black text-slate-400 uppercase tracking-widest text-[10px]"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={saving}
                className="flex-[2] py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-[0.3em] text-[10px] shadow-xl hover:bg-slate-950 transition-all disabled:opacity-50"
              >
                {saving ? 'Saving...' : (editingSupplier ? 'Update' : 'Register Vendor')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------------------
          MODAL: ADD TEMPORARY PRODUCT ROW DIALOG
          ------------------------------------------------------------- */}
      <Dialog open={isAddProductModalOpen} onOpenChange={setIsAddProductModalOpen}>
        <DialogContent className="max-w-md rounded-[3rem] p-8">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-slate-900">
              Add Delivered Product
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Product Name *</label>
              <input 
                required 
                type="text"
                placeholder="Enter product name"
                value={newProductForm.productName}
                onChange={e => setNewProductForm({...newProductForm, productName: e.target.value})}
                className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800" 
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Quantity *</label>
                <input 
                  required 
                  type="text"
                  placeholder="e.g. 5 bags, 10 cans"
                  value={newProductForm.quantity}
                  onChange={e => setNewProductForm({...newProductForm, quantity: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">@ Price *</label>
                <input 
                  required 
                  type="text"
                  placeholder="0.00"
                  value={newProductForm.price}
                  onChange={e => {
                    const num = parseCommaNumber(e.target.value);
                    setNewProductForm({...newProductForm, price: formatCommaNumber(num)});
                  }}
                  className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-900 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-indigo-600 font-mono" 
                />
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button 
                type="button" 
                onClick={() => setIsAddProductModalOpen(false)} 
                className="flex-1 py-4 text-xs font-black uppercase text-slate-400"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleAddTempProduct}
                className="flex-2 py-4 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest text-center"
              >
                Record Product
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------------------
          MODAL: ADD NEW TRANSACTION DIALOG (Mode selection inside)
          ------------------------------------------------------------- */}
      <Dialog open={isTxModalOpen} onOpenChange={setIsTxModalOpen}>
        <DialogContent className="max-w-xl rounded-[3rem] p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <DialogHeader className="mb-6 border-b border-slate-50 pb-4">
            <DialogTitle className="text-3xl font-black uppercase tracking-tight text-slate-900 leading-none">
              Record Transaction
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-1 uppercase font-bold">
              Adjust outstanding balance or Restock supply deliverables
            </DialogDescription>
          </DialogHeader>

          {refreshedActiveSupplier && (
            <form onSubmit={handleAddTransaction} className="space-y-6">
              
              {/* Dynamic current balance preview */}
              <div className="p-4 bg-slate-50 rounded-2xl flex justify-between items-center">
                <span className="text-xs font-black uppercase text-slate-500">Current Balance:</span>
                <span className={cn(
                  "text-lg font-black font-mono italic",
                  refreshedActiveSupplier.balance > 0 ? "text-rose-600" : "text-emerald-600"
                )}>
                  {formatCurrency(refreshedActiveSupplier.balance)}
                </span>
              </div>

              {/* Selector Field 1: Transaction Type */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Transaction Type *</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setTxFormType('purchase');
                      setTxAmount('');
                      setTxAmountPaid('');
                    }}
                    className={cn(
                      "py-4 rounded-2xl text-xs font-black uppercase tracking-wider border-2 transition-all active:scale-95",
                      txFormType === 'purchase'
                        ? "bg-indigo-50/50 border-indigo-500 text-indigo-700"
                        : "bg-white border-slate-100 text-slate-400 hover:bg-slate-50"
                    )}
                  >
                    New Transaction
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTxFormType('payment');
                      setTxAmount('');
                      setTxAmountPaid('');
                    }}
                    className={cn(
                      "py-4 rounded-2xl text-xs font-black uppercase tracking-wider border-2 transition-all active:scale-95",
                      txFormType === 'payment'
                        ? "bg-emerald-50/50 border-emerald-500 text-emerald-700"
                        : "bg-white border-slate-100 text-slate-400 hover:bg-slate-50"
                    )}
                  >
                    Balance Payment
                  </button>
                </div>
              </div>

              {/* MODE A: New transaction details */}
              {txFormType === 'purchase' ? (
                <div className="space-y-6 border-t border-dashed border-slate-100 pt-6">
                  {/* products nested section */}
                  <div className="bg-slate-50 p-4 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-black uppercase text-slate-800">Delivered Supplies</h4>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{txProducts.length} items listed</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setNewProductForm({ productName: '', quantity: '', price: '' });
                            setIsAddProductModalOpen(true);
                          }}
                          className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-[9px] font-black uppercase tracking-widest"
                        >
                          Add Product
                        </button>
                        {txProducts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowTxProductsCollapsible(!showTxProductsCollapsible)}
                            className="p-1 hover:bg-slate-100 rounded-lg text-slate-500"
                          >
                            {showTxProductsCollapsible ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {showTxProductsCollapsible && txProducts.length > 0 && (
                      <div className="bg-white rounded-2xl p-2 border border-slate-100 space-y-2 max-h-[120px] overflow-y-auto">
                        {txProducts.map((p, pIdx) => (
                          <div key={pIdx} className="flex justify-between items-center text-xs p-2 hover:bg-slate-50 rounded-xl border-b border-slate-50 last:border-0 last:pb-0">
                            <div className="flex flex-col">
                              <span className="font-extrabold text-slate-800 uppercase">{p.productName}</span>
                              <span className="text-[9px] font-bold text-slate-400">Qty: {p.quantity}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-slate-900 font-extrabold">{formatCurrency(p.price)}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setTxProducts(txProducts.filter((_, i) => i !== pIdx));
                                }}
                                className="p-1 hover:bg-rose-50 text-rose-500 rounded-lg"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Transaction Amount *</label>
                      <input
                        required
                        type="text"
                        placeholder="0.00"
                        value={txAmount}
                        onChange={e => {
                          const num = parseCommaNumber(e.target.value);
                          setTxAmount(formatCommaNumber(num));
                        }}
                        className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-800 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-indigo-600 font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Amount Paid *</label>
                      <input
                        required
                        type="text"
                        placeholder="0.00"
                        value={txAmountPaid}
                        onChange={e => {
                          const num = parseCommaNumber(e.target.value);
                          setTxAmountPaid(formatCommaNumber(num));
                        }}
                        className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-800 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-emerald-600 font-mono"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* MODE B: Payment of outstanding balance */
                <div className="space-y-4 border-t border-dashed border-slate-100 pt-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-950 ml-2">Payment Amount *</label>
                    <input
                      required
                      type="text"
                      placeholder="Enter payment amount"
                      value={txAmountPaid}
                      onChange={e => {
                        const num = parseCommaNumber(e.target.value);
                        setTxAmountPaid(formatCommaNumber(num));
                      }}
                      className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-800 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-emerald-600 font-mono"
                    />
                    <div className="flex justify-between items-center pt-1.5 px-2">
                      <span className="text-[10px] text-slate-400 font-bold block">Upper Limit: {formatCurrency(refreshedActiveSupplier.balance)}</span>
                      <button
                        type="button"
                        onClick={() => setTxAmountPaid(formatCommaNumber(refreshedActiveSupplier.balance))}
                        className="text-[9px] font-black text-rose-500 uppercase tracking-widest hover:underline"
                      >
                        Pay in Full
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* General Reference description / notes */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Notes / Memo</label>
                <input
                  type="text"
                  placeholder="e.g. invoice id, delivery reference"
                  value={txNotes}
                  onChange={e => setTxNotes(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-50 focus:border-slate-800 rounded-2xl px-6 py-4 font-bold outline-none transition-all text-sm text-slate-800"
                />
              </div>

              {/* Dynamic balance outcome preview */}
              <div className="p-4 bg-slate-950 text-white rounded-3xl flex justify-between items-center transition-all">
                <div>
                  <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Estimated Closing Balance</span>
                  <span className="block text-xs font-bold text-slate-400 italic">Expected payable outcome after execution</span>
                </div>
                <span className={cn(
                  "text-xl font-black font-mono italic pr-2",
                  previewTxBalance > 0 ? "text-rose-400" : "text-emerald-400"
                )}>
                  {formatCurrency(previewTxBalance)}
                </span>
              </div>

              {/* Action operations buttons */}
              <div className="flex gap-4 pt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTxModalOpen(false)}
                  className="flex-1 py-5 rounded-2xl font-black text-slate-400 uppercase tracking-widest text-[10px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-[2] py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-[0.3em] text-[10px] shadow-xl hover:bg-slate-950 transition-all disabled:opacity-50"
                >
                  {saving ? 'Processing...' : (txFormType === 'purchase' ? 'Add Transaction' : 'Make Payment')}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default Suppliers;
