import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, doc, runTransaction, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { db as dexie } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { 
  History, 
  Search, 
  Filter, 
  Download, 
  ChevronRight, 
  Receipt,
  Clock,
  User,
  CreditCard,
  Banknote,
  Smartphone,
  Zap,
  ArrowUpRight,
  Printer,
  X
} from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
import { PrintableReceipt } from '../components/common/PrintableReceipt';
import { printElementViaIframe } from '../lib/printHelper';

interface SaleRecord {
  id: string;
  items: any[];
  total: number;
  paymentMethod: 'cash' | 'pos' | 'transfer' | 'split';
  cashierId: string;
  cashierName?: string;
  createdAt: any;
  storeId: string;
}

const SalesHistory: React.FC = () => {
  const { profile, loading: authLoading } = useAuth();
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDateStr, setStartDateStr] = useState('');
  const [endDateStr, setEndDateStr] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [selectedSaleForReceipt, setSelectedSaleForReceipt] = useState<any | null>(null);
  const [printFormat, setPrintFormat] = useState<'80mm' | '58mm' | 'standard'>(() => {
    return (localStorage.getItem('pos_selected_printer_format') as any) || '80mm';
  });

  useEffect(() => {
    if (authLoading) return;
    
    // 1. Initial load from local Dexie database for instant offline support
    const loadCachedSales = async () => {
      try {
        let cached;
        if (profile?.role === 'super_admin') {
          cached = await dexie.sales.toArray();
        } else if (profile?.storeId) {
          cached = await dexie.sales.where('storeId').equals(profile.storeId).toArray();
        } else {
          cached = [];
        }
        
        cached.sort((a, b) => {
          const getSec = (x: any) => {
            if (x?.seconds) return x.seconds * 1000;
            if (x instanceof Date) return x.getTime();
            if (typeof x === 'string') return new Date(x).getTime();
            if (x?.toDate) return x.toDate().getTime();
            return 0;
          };
          return getSec(b.createdAt) - getSec(a.createdAt);
        });
        
        const uniqueCached = Array.from(new Map(cached.map(s => [s.id, s])).values());
        setSales(uniqueCached as SaleRecord[]);
        if (cached.length > 0) {
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load cached sales from local DB:", err);
      }
    };
    
    loadCachedSales();

    // 2. Subscribe to Firestore for real-time online updates and cache synchronization
    let q;
    if (profile?.role === 'super_admin') {
      q = query(collection(db, 'sales'));
    } else if (profile?.storeId) {
      q = query(collection(db, 'sales'), where('storeId', '==', profile.storeId));
    } else {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const liveSales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      try {
        // Empty previously synced ones to avoid duplicates, but preserve offline-only sales
        if (profile?.role === 'super_admin') {
          await dexie.sales.where('synced').equals(1).delete();
        } else if (profile?.storeId) {
          await dexie.sales.where('storeId').equals(profile.storeId).and(s => s.synced === true).delete();
        }
        
        await dexie.sales.bulkPut(liveSales.map(s => ({ ...s, synced: true })));
      } catch (err) {
        console.warn("Failed to update local sales cache, loading from memory directly", err);
      }
      
      // Read final combined list from Dexie (so offline & sync-queued sales are included)
      let finalSales;
      if (profile?.role === 'super_admin') {
        finalSales = await dexie.sales.toArray();
      } else {
        finalSales = await dexie.sales.where('storeId').equals(profile?.storeId || '').toArray();
      }

      finalSales.sort((a, b) => {
        const getSec = (x: any) => {
          if (x?.seconds) return x.seconds * 1000;
          if (x instanceof Date) return x.getTime();
          if (typeof x === 'string') return new Date(x).getTime();
          if (x?.toDate) return x.toDate().getTime();
          return 0;
        };
        return getSec(b.createdAt) - getSec(a.createdAt);
      });

      const uniqueSales = Array.from(new Map(finalSales.map(s => [s.id, s])).values());
      setSales(uniqueSales as SaleRecord[]);
      setLoading(false);
    }, async (err) => {
      console.warn("Firestore real-time snapshot failed (likely offline). Falling back fully to local Dexie.", err);
      // Fallback query if index is still building or missing
      try {
        let fallbackQuery;
        if (profile?.role === 'super_admin') {
          fallbackQuery = query(collection(db, 'sales'));
        } else {
          fallbackQuery = query(collection(db, 'sales'), where('storeId', '==', profile?.storeId));
        }
        const fallbackSnap = await getDocs(fallbackQuery);
        const fbSales = fallbackSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
        
        await dexie.sales.bulkPut(fbSales.map(s => ({ ...s, synced: true })));
        
        let finalSales;
        if (profile?.role === 'super_admin') {
          finalSales = await dexie.sales.toArray();
        } else {
          finalSales = await dexie.sales.where('storeId').equals(profile?.storeId || '').toArray();
        }
        
        finalSales.sort((a, b) => {
          const getSec = (x: any) => {
            if (x?.seconds) return x.seconds * 1000;
            if (x instanceof Date) return x.getTime();
            if (typeof x === 'string') return new Date(x).getTime();
            if (x?.toDate) return x.toDate().getTime();
            return 0;
          };
          return getSec(b.createdAt) - getSec(a.createdAt);
        });
        
        const uniqueSalesFallback = Array.from(new Map(finalSales.map(s => [s.id, s])).values());
        setSales(uniqueSalesFallback as SaleRecord[]);
      } catch (fallbackErr) {
        console.error("Secondary fallback fetch failed:", fallbackErr);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [authLoading, profile?.storeId, profile?.role]);

  const fetchSales = async () => {
    try {
      let cached;
      if (profile?.role === 'super_admin') {
        cached = await dexie.sales.toArray();
      } else if (profile?.storeId) {
        cached = await dexie.sales.where('storeId').equals(profile.storeId).toArray();
      } else {
        cached = [];
      }
      cached.sort((a, b) => {
        const getSec = (x: any) => {
          if (x?.seconds) return x.seconds * 1000;
          if (x instanceof Date) return x.getTime();
          if (typeof x === 'string') return new Date(x).getTime();
          if (x?.toDate) return x.toDate().getTime();
          return 0;
        };
        return getSec(b.createdAt) - getSec(a.createdAt);
      });
      setSales(cached as SaleRecord[]);
    } catch (err) {
      console.error("Manual fetch from local DB failed:", err);
    }
  };

  const handleCancelSale = async (sale: SaleRecord) => {
    if (!window.confirm("Are you sure you want to cancel this sale? This will restore stock to inventory.")) return;
    
    try {
      setLoading(true);
      await runTransaction(db, async (transaction) => {
        const saleRef = doc(db, 'sales', sale.id);
        const saleSnap = await transaction.get(saleRef);
        
        if (!saleSnap.exists()) throw new Error("Sale records not found.");
        if (saleSnap.data().status === 'cancelled') throw new Error("Sale is already cancelled.");
        
        // Restore stock
        for (const item of sale.items as any[]) {
          const productRef = doc(db, 'products', item.productId);
          const stockId = `${item.productId}_${item.inventoryLocationId}`;
          const stockRef = doc(db, 'inventory_location_stock', stockId);
          
          const [productSnap, stockSnap] = await Promise.all([
            transaction.get(productRef),
            transaction.get(stockRef)
          ]);
          
          const totalUnitsToRestore = item.quantity * (item.conversionRate || 1);
          
          if (productSnap.exists()) {
            transaction.update(productRef, {
              stock: (productSnap.data().stock || 0) + totalUnitsToRestore,
              updatedAt: serverTimestamp()
            });
          }
          
          if (stockSnap.exists()) {
            transaction.update(stockRef, {
              quantity: (stockSnap.data().quantity || 0) + totalUnitsToRestore,
              updatedAt: serverTimestamp()
            });
          }
        }
        
        transaction.update(saleRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          cancelledBy: profile?.uid
        });
      });
      
      alert("Sale cancelled and stock restored successfully.");
      fetchSales();
    } catch (err: any) {
      alert(`Failed to cancel sale: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'cash': return Banknote;
      case 'pos': return CreditCard;
      case 'transfer': return Smartphone;
      default: return Receipt;
    }
  };

  const getSaleTime = (s: any) => {
    if (!s?.createdAt) return 0;
    if (s.createdAt.seconds !== undefined) return s.createdAt.seconds * 1000;
    if (s.createdAt instanceof Date) return s.createdAt.getTime();
    if (typeof s.createdAt === 'string') return new Date(s.createdAt).getTime();
    if (typeof s.createdAt?.toDate === 'function') return s.createdAt.toDate().getTime();
    return new Date(s.createdAt).getTime() || 0;
  };

  const formatSaleDateTime = (createdAt: any) => {
    const sTime = getSaleTime({ createdAt });
    if (!sTime) return 'Real-time';
    const date = new Date(sTime);
    const dateStr = date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${dateStr} @ ${timeStr}`;
  };

  const handleExportSalesCSV = () => {
    const headers = ["Transaction ID", "Date & Time", "Items Sold", "Payment Method", "Cashier", "Total Paid", "Status"];
    const rows = filteredSales.map(s => {
      const dateStr = formatSaleDateTime(s.createdAt);
      const itemsCount = s.items.reduce((a, b) => a + b.quantity, 0);
      const status = (s as any).status === 'cancelled' ? 'CANCELLED' : 'COMPLETED';
      return [
        s.id,
        `"${dateStr}"`,
        String(itemsCount),
        s.paymentMethod,
        `"${s.cashierName || 'System'}"`,
        String(s.total),
        status
      ];
    });
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `BizSeq_SalesHistory_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredSales = sales.filter(s => {
    const matchesSearch = s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.paymentMethod.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;

    const sTime = getSaleTime(s);
    if (startDateStr) {
      const startMs = new Date(startDateStr + 'T00:00:00').getTime();
      if (sTime < startMs) return false;
    }
    if (endDateStr) {
      const endMs = new Date(endDateStr + 'T23:59:59').getTime();
      if (sTime > endMs) return false;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-12 pb-24">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
           <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-slate-900 rounded-lg shadow-lg">
                 <History className="h-4 w-4 text-emerald-400" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Sales History</span>
           </div>
           <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-slate-950 leading-none mb-4">Sales Records</h1>
           <p className="text-slate-500 font-bold text-lg italic max-w-lg mb-2">View and manage all past sales transactions.</p>
        </div>
        <button 
          onClick={handleExportSalesCSV}
          className="flex items-center justify-center space-x-3 bg-white border-2 border-slate-50 text-slate-950 px-10 py-5 rounded-3xl text-sm font-black uppercase tracking-widest shadow-sm hover:border-slate-950 transition-all group"
        >
          <Download className="h-5 w-5" /> 
          <span>Export Sales</span>
        </button>
      </header>

      <div className="flex flex-col lg:flex-row items-center gap-6 relative z-10">
        <div className="relative flex-1 group w-full">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-emerald-600 transition-colors" />
          <input 
            type="text" 
            placeholder="Search by Transaction ID or Method..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-16 pr-8 py-5 bg-white border-2 border-slate-100 rounded-[2rem] text-sm focus:outline-none focus:border-slate-950 font-black text-slate-900 placeholder:text-slate-400 shadow-sm transition-all" 
          />
        </div>
        <button 
          onClick={() => setShowDateFilter(!showDateFilter)}
          className={cn(
            "flex items-center space-x-3 px-8 py-5 rounded-[2rem] text-xs font-black uppercase tracking-widest transition-all w-full lg:w-auto justify-center select-none",
            showDateFilter ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          )}
        >
          <Filter className="h-4 w-4" /> <span>{showDateFilter ? "Hide Date Filter" : "Filter by Date"}</span>
        </button>
      </div>

      {showDateFilter && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-slate-200 rounded-[2rem] p-6 flex flex-wrap items-center gap-4 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Start Date:</span>
            <input 
              type="date"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              className="bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-950"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">End Date:</span>
            <input 
              type="date"
              value={endDateStr}
              onChange={(e) => setEndDateStr(e.target.value)}
              className="bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-950"
            />
          </div>
          {(startDateStr || endDateStr) && (
            <button 
              onClick={() => { setStartDateStr(''); setEndDateStr(''); }}
              className="px-4 py-2 text-xs bg-rose-50 text-rose-600 font-bold rounded-xl hover:bg-rose-100 transition-all uppercase"
            >
              Clear Filters
            </button>
          )}
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          Array(4).fill(0).map((_, i) => (
            <div key={i} className="h-24 bg-white/50 rounded-[2rem] animate-pulse" />
          ))
        ) : filteredSales.length === 0 ? (
          <div className="py-40 flex flex-col items-center justify-center text-center">
             <div className="p-12 bg-white rounded-[3rem] shadow-vibrant mb-8">
                <Receipt className="h-20 w-20 text-slate-100" />
             </div>
             <p className="text-slate-400 font-bold italic">No sales records found for this period.</p>
          </div>
        ) : filteredSales.map((sale, i) => (
          <motion.div 
            key={`hist-sale-item-${sale.id || 'unkn'}-${i}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className="vibrant-card p-6 flex flex-col md:flex-row items-center gap-8 group hover:border-mint-950 transition-all"
          >
            <div className="flex-shrink-0 flex items-center gap-6 w-full md:w-auto">
               <div className="h-16 w-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-900 group-hover:bg-slate-900 group-hover:text-white transition-all shadow-inner">
                  {React.createElement(getMethodIcon(sale.paymentMethod), { className: "h-6 w-6" })}
               </div>
               <div>
                  <p className="text-[10px] font-black font-mono text-slate-300 uppercase tracking-widest mb-1 italic">ID: {sale.id.slice(0,8)}...</p>
                  <p className="font-black text-xl text-slate-900 tracking-tighter uppercase leading-none">Sale Completed</p>
               </div>
            </div>

            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-8 w-full">
               <div>
                  <p className="text-[9px] text-slate-950 font-black uppercase tracking-widest mb-2">Items Sold</p>
                  <p className="font-bold text-emerald-600 text-sm italic mb-1">{sale.items.reduce((a, b) => a + b.quantity, 0)} Items</p>
                  <div className="text-[11px] text-slate-500 font-medium space-y-1 max-w-[220px]">
                    {sale.items.slice(0, 3).map((it: any, i: number) => (
                      <div key={i} className="truncate uppercase font-sans text-left leading-tight" title={it.name}>
                        • <span className="font-semibold text-slate-700">{it.quantity}x</span> {it.name}
                      </div>
                    ))}
                    {sale.items.length > 3 && (
                      <div className="text-[10px] text-slate-400 font-bold italic text-left pl-2">
                        + {sale.items.length - 3} more items
                      </div>
                    )}
                  </div>
               </div>
               <div>
                  <p className="text-[9px] text-slate-950 font-black uppercase tracking-widest mb-2">Date & Time</p>
                  <div className="flex items-center gap-2 text-slate-950 text-xs font-black">
                     <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                     <span>{formatSaleDateTime(sale.createdAt)}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono tracking-wider font-bold mt-1.5 uppercase leading-none">
                    MODE: {sale.paymentMethod}
                  </p>
               </div>
               <div className="hidden md:block">
                  <p className="text-[9px] text-slate-950 font-black uppercase tracking-widest mb-2">Staff</p>
                  <div className="flex items-center gap-2 text-slate-950 text-sm font-bold">
                     <User className="h-3 w-3 text-slate-400" />
                     {sale.cashierName || 'System'}
                  </div>
               </div>
            </div>

            <div className="flex-shrink-0 flex items-center gap-8 w-full md:w-auto justify-between border-t md:border-t-0 border-slate-50 pt-6 md:pt-0">
               <div className="text-right">
                  <p className="text-[9px] text-slate-950 font-black uppercase tracking-widest mb-1">Total Amount</p>
                  <p className={cn("text-2xl font-black font-mono italic tracking-tighter", (sale as any).status === 'cancelled' ? 'text-rose-500 line-through' : 'text-slate-950')}>
                    {formatCurrency(sale.total)}
                  </p>
               </div>
               
               <div className="flex gap-2">
                 {(sale as any).status !== 'cancelled' && (
                   <button 
                     onClick={() => handleCancelSale(sale)}
                     className="p-4 bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                     title="Cancel Sale & Restore Stock"
                   >
                      <Zap className="h-5 w-5" />
                   </button>
                 )}
                 <button 
                   onClick={() => setSelectedSaleForReceipt(sale)}
                   className="p-4 bg-slate-50 text-slate-950 rounded-2xl hover:bg-slate-900 hover:text-white transition-all shadow-sm"
                   title="View & Reprint Receipt"
                 >
                    <ArrowUpRight className="h-5 w-5" />
                 </button>
               </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Reprint Dialog Modal */}
      <AnimatePresence>
        {selectedSaleForReceipt && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto font-sans">
             <motion.div 
               initial={{ scale: 0.95, opacity: 0 }} 
               animate={{ scale: 1, opacity: 1 }} 
               exit={{ scale: 0.95, opacity: 0 }}
               className="bg-slate-100 rounded-3xl p-6 md:p-8 w-full max-w-4xl shadow-2xl flex flex-col md:flex-row gap-6 max-h-[90vh] overflow-hidden"
             >
                {/* Formatting controls */}
                <div className="w-full md:w-64 flex flex-col gap-4 justify-between shrink-0 font-sans">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-1 font-sans text-left">Reprint Center</h3>
                    <p className="text-[11px] text-slate-400 font-sans font-bold mb-4 text-left">Choose standard or thermal layouts matching your store printer setup.</p>
                    
                    <div className="flex flex-row md:flex-col gap-2">
                      <button 
                        type="button"
                        onClick={() => {
                          setPrintFormat('58mm');
                          localStorage.setItem('pos_selected_printer_format', '58mm');
                        }}
                        className={cn(
                          "flex-1 text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-3",
                          printFormat === '58mm'
                            ? "bg-slate-950 border-slate-950 text-white shadow-md font-bold"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                        )}
                      >
                        <Printer className="h-4 w-4 shrink-0 text-blue-500 animate-pulse" />
                        <div className="text-left leading-tight">
                          <p className="text-[8px] font-black uppercase tracking-wider opacity-60">Thermal Client</p>
                          <p className="text-xs font-sans font-black">58mm Paper</p>
                        </div>
                      </button>

                      <button 
                        type="button"
                        onClick={() => {
                          setPrintFormat('80mm');
                          localStorage.setItem('pos_selected_printer_format', '80mm');
                        }}
                        className={cn(
                          "flex-1 text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-3",
                          printFormat === '80mm'
                            ? "bg-slate-950 border-slate-950 text-white shadow-md font-bold"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                        )}
                      >
                        <Printer className="h-4 w-4 shrink-0 text-amber-500" />
                        <div className="text-left leading-tight">
                          <p className="text-[8px] font-black uppercase tracking-wider opacity-60">Thermal Pro</p>
                          <p className="text-xs font-sans font-black">80mm Paper</p>
                        </div>
                      </button>

                      <button 
                        type="button"
                        onClick={() => {
                          setPrintFormat('standard');
                          localStorage.setItem('pos_selected_printer_format', 'standard');
                        }}
                        className={cn(
                          "flex-1 text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-3",
                          printFormat === 'standard'
                            ? "bg-slate-950 border-slate-950 text-white shadow-md font-bold"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                        )}
                      >
                        <Printer className="h-4 w-4 shrink-0 text-emerald-500" />
                        <div className="text-left leading-tight">
                          <p className="text-[8px] font-black uppercase tracking-wider opacity-60">Standard Page</p>
                          <p className="text-xs font-sans font-black">A4 Invoice</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Sandbox Notice removed as requested */}
                </div>

                {/* Receipt Preview */}
                <div className="flex-1 bg-slate-200/75 rounded-2xl p-4 md:p-8 overflow-y-auto max-h-[40vh] md:max-h-[70vh] flex justify-center items-start border border-slate-300/50 shadow-inner">
                  <div id="printable-receipt-container" className="bg-white shadow-xl transition-all p-4 rounded-md">
                     <PrintableReceipt sale={selectedSaleForReceipt} format={printFormat} profile={profile} />
                  </div>
                </div>

                {/* Actions */}
                <div className="md:w-48 flex flex-col gap-2 shrink-0 md:justify-end">
                   <button 
                     type="button"
                     onClick={() => setSelectedSaleForReceipt(null)} 
                     className="w-full py-4 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-2xl font-black uppercase text-xs tracking-wider transition-all"
                   >
                     Close Panel
                   </button>
                   <button 
                     type="button"
                     onClick={() => {
                       try {
                         console.log("PRINT CLICKED");
                         const printEl = document.getElementById('printable-receipt-container');
                         console.log("PRINT ELEMENT ID:", printEl?.id);
                         console.log("PRINT ELEMENT EXISTS:", !!printEl);
                         console.log("PRINT ELEMENT OUTER HTML:", printEl?.outerHTML?.slice(0, 500));
                         const selectedPaperFormat = printFormat;
                          console.log("SELECTED PAPER FORMAT:", selectedPaperFormat);
                          printElementViaIframe('printable-receipt-container', printFormat);
                       } catch (e) {
                         console.error("Standard printing triggered:", e);
                         window.print();
                       }
                     }} 
                     className="w-full py-4 bg-[#00529B] text-white hover:bg-blue-800 rounded-2xl font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-xl transition-all active:scale-95"
                   >
                     <Printer className="h-4 w-4"/>
                     Print receipt
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {selectedSaleForReceipt && createPortal(
        <div id="portal-printable-receipt" className="hidden print:block text-black bg-white">
           <style dangerouslySetInnerHTML={{ __html: `
             @media print {
               html, body {
                 background: white !important;
                 color: black !important;
                 margin: 0 !important;
                 padding: 0 !important;
                 font-family: ${printFormat === 'standard' ? 'sans-serif' : 'monospace'} !important;
               }
               #root {
                 display: none !important;
               }
               /* Override portal wrapper styles */
               #portal-printable-receipt {
                 display: block !important;
                 visibility: visible !important;
                 width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
                 max-width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
                 margin: 0 auto !important;
                 padding: 0 !important;
               }
             }
           ` }} />
           <PrintableReceipt sale={selectedSaleForReceipt} format={printFormat} profile={profile} />
        </div>,
        document.body
      )}
    </div>
  );
};

export default SalesHistory;
