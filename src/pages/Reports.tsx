import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db as dexie } from '../services/db';
import { db as firestore } from '../services/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc,
  serverTimestamp
} from 'firebase/firestore';
import { 
  TrendingUp, 
  DollarSign, 
  Calendar, 
  RefreshCw, 
  BarChart3, 
  Package, 
  Clock, 
  Plus, 
  Trash2, 
  AlertTriangle, 
  Award, 
  X,
  CreditCard,
  Building2,
  Bookmark,
  Receipt,
  Download,
  Printer
} from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell,
  Legend,
  BarChart,
  Bar
} from 'recharts';
import { motion } from 'motion/react';
import { Expense, Product, Sale } from '../types';

const Reports: React.FC = () => {
  const { profile } = useAuth();
  const storeId = profile?.storeId;

  // State
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Expenses Modal Form State
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [expDescription, setExpDescription] = useState('');
  const [expCategory, setExpCategory] = useState<'salaries' | 'bills' | 'other'>('bills');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSavingExpense, setIsSavingExpense] = useState(false);

  // Active Report Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'sales' | 'products' | 'expenses' | 'analytics'>('overview');

  // Date Range Filters State
  const [startDateStr, setStartDateStr] = useState<string>('');
  const [endDateStr, setEndDateStr] = useState<string>('');

  // Selected Report Type for print/export focus
  const [selectedReportType, setSelectedReportType] = useState<'income_earning' | 'stock_taking' | 'expenses_ledger'>('income_earning');

  // Load Sales, Products, and Expenses
  useEffect(() => {
    if (!storeId) return;

    setIsLoading(true);

    // 1. Live Firestore Sales Listener (sync with local Dexie backup)
    const salesQuery = query(collection(firestore, 'sales'), where('storeId', '==', storeId));
    const unsubscribeSales = onSnapshot(salesQuery, async (snapshot) => {
      const liveSales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Sale));
      
      setSales(liveSales);
      setIsLoading(false);

      // Cache local backup
      try {
        await dexie.sales.where('storeId').equals(storeId).delete();
        await dexie.sales.bulkPut(liveSales.map(s => ({ ...s, synced: true }) as any));
      } catch (err) {
        console.warn("Reports: Background sales local backup failed", err);
      }
    }, async (err) => {
      console.warn("Reports: Firestore sales stream offline, loading cached sales", err);
      try {
        const cachedSales = await dexie.sales.where('storeId').equals(storeId).toArray();
        setSales(cachedSales as Sale[]);
      } catch (dexieErr) {
        console.error("Reports: Offline sales loading failed", dexieErr);
      }
      setIsLoading(false);
    });

    // 2. Live Firestore Products Listener (sync with local Dexie backup)
    const productsQuery = query(collection(firestore, 'products'), where('storeId', '==', storeId));
    const unsubscribeProducts = onSnapshot(productsQuery, async (snapshot) => {
      const liveProducts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Product));
      
      setProducts(liveProducts);

      // Cache local backup
      try {
        await dexie.products.where('storeId').equals(storeId).delete();
        await dexie.products.bulkPut(liveProducts.map(p => ({ ...p, synced: true }) as any));
      } catch (err) {
        console.warn("Reports: Background products local backup failed", err);
      }
    }, async (err) => {
      console.warn("Reports: Firestore products stream offline, loading cached products", err);
      try {
        const cachedProducts = await dexie.products.where('storeId').equals(storeId).toArray();
        setProducts(cachedProducts as Product[]);
      } catch (dexieErr) {
        console.error("Reports: Offline products loading failed", dexieErr);
      }
    });

    // 3. Realtime Listener for Firestore Expenses
    const expQuery = query(
      collection(firestore, 'expenses'),
      where('storeId', '==', storeId)
    );

    const unsubscribeExpenses = onSnapshot(expQuery, (snapshot) => {
      const liveExpenses = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Expense));
      setExpenses(liveExpenses);
      setIsLoading(false);
    }, (err) => {
      console.warn("Expenses subscription failed:", err);
      setIsLoading(false);
    });

    return () => {
      unsubscribeSales();
      unsubscribeProducts();
      unsubscribeExpenses();
    };
  }, [storeId]);

  // Submissions for Expenses
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expDescription.trim()) return alert("Please enter description");
    if (!expAmount || Number(expAmount) <= 0) return alert("Please enter positive amount");

    setIsSavingExpense(true);
    try {
      await addDoc(collection(firestore, 'expenses'), {
        storeId,
        description: expDescription.trim(),
        category: expCategory,
        amount: Number(expAmount),
        date: expDate,
        createdAt: new Date().toISOString()
      });

      setExpDescription('');
      setExpAmount('');
      setExpCategory('bills');
      setIsExpenseModalOpen(false);
    } catch (err: any) {
      alert("Error logging expense: " + err.message);
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!window.confirm("Delete this expense record permanently?")) return;
    try {
      await deleteDoc(doc(firestore, 'expenses', expenseId));
    } catch (err: any) {
      alert("Error deleting: " + err.message);
    }
  };

  // ----------------------------------------------------
  // CALCULATED METRICS WITH ROBUST TIMESTAMP PARSING
  // ----------------------------------------------------
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();
  const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

  const getSaleTime = (s: any) => {
    if (!s?.createdAt) return 0;
    if (s.createdAt.seconds !== undefined) return s.createdAt.seconds * 1000;
    if (s.createdAt instanceof Date) return s.createdAt.getTime();
    if (typeof s.createdAt === 'string') return new Date(s.createdAt).getTime();
    if (typeof s.createdAt?.toDate === 'function') return s.createdAt.toDate().getTime();
    return new Date(s.createdAt).getTime() || 0;
  };

  // Filter Sales - Reactive to Date Picker
  const processedSales = useMemo(() => {
    let list = sales.filter(s => (s as any).status !== 'voided' && (s as any).status !== 'cancelled');
    if (startDateStr) {
      const startMs = new Date(startDateStr + 'T00:00:00').getTime();
      list = list.filter(s => getSaleTime(s) >= startMs);
    }
    if (endDateStr) {
      const endMs = new Date(endDateStr + 'T23:59:59').getTime();
      list = list.filter(s => getSaleTime(s) <= endMs);
    }
    return list;
  }, [sales, startDateStr, endDateStr]);

  // Filter Expenses - Reactive to Date Picker
  const processedExpenses = useMemo(() => {
    let list = expenses;
    if (startDateStr) {
      const startMs = new Date(startDateStr + 'T00:00:00').getTime();
      list = list.filter(e => {
        const eTime = e.date ? new Date(e.date + 'T00:00:00').getTime() : 0;
        return eTime >= startMs;
      });
    }
    if (endDateStr) {
      const endMs = new Date(endDateStr + 'T23:59:59').getTime();
      list = list.filter(e => {
        const eTime = e.date ? new Date(e.date + 'T23:59:59').getTime() : 0;
        return eTime <= endMs;
      });
    }
    return list;
  }, [expenses, startDateStr, endDateStr]);

  const metrics = useMemo(() => {
    let todaySales = 0;
    let todayProfit = 0;
    let todayCount = 0;

    let weekSales = 0;
    let weekProfit = 0;
    let weekCount = 0;

    let monthSales = 0;
    let monthProfit = 0;
    let monthCount = 0;

    let yearSales = 0;
    let yearProfit = 0;
    let yearCount = 0;

    const activeSales = sales.filter(s => (s as any).status !== 'voided' && (s as any).status !== 'cancelled');

    activeSales.forEach(s => {
      const sTime = getSaleTime(s);
      
      const saleVal = s.total || 0;
      const profitVal = s.totalProfit || (s.total - (s.totalCost || 0));

      if (sTime >= startOfToday) {
        todaySales += saleVal;
        todayProfit += profitVal;
        todayCount++;
      }
      if (sTime >= startOfWeek) {
        weekSales += saleVal;
        weekProfit += profitVal;
        weekCount++;
      }
      if (sTime >= startOfMonth) {
        monthSales += saleVal;
        monthProfit += profitVal;
        monthCount++;
      }
      if (sTime >= startOfYear) {
        yearSales += saleVal;
        yearProfit += profitVal;
        yearCount++;
      }
    });

    return {
      sales: { today: todaySales, week: weekSales, month: monthSales, year: yearSales },
      profits: { today: todayProfit, week: weekProfit, month: monthProfit, year: yearProfit },
      counts: { today: todayCount, week: weekCount, month: monthCount, year: yearCount }
    };
  }, [sales, startOfToday, startOfWeek, startOfMonth, startOfYear]);

  // Expenses Breakdown
  const expenseMetrics = useMemo(() => {
    let salaries = 0;
    let bills = 0;
    let other = 0;

    processedExpenses.forEach(e => {
      const amt = e.amount || 0;
      if (e.category === 'salaries') salaries += amt;
      else if (e.category === 'bills') bills += amt;
      else other += amt;
    });

    const totalExpenses = salaries + bills + other;
    const netProfitMonth = metrics.profits.month - totalExpenses;

    return { salaries, bills, other, totalExpenses, netProfitMonth };
  }, [processedExpenses, metrics.profits]);

  // Products Metrics
  const productMetrics = useMemo(() => {
    let totalStock = 0;
    let totalValuationCost = 0;
    let totalValuationRetail = 0;
    const lowStock: Product[] = [];
    const soonExpired: Product[] = [];
    const expired: Product[] = [];

    products.forEach(p => {
      const stock = p.stock || 0;
      totalStock += stock;
      totalValuationCost += stock * (p.cost || 0);
      totalValuationRetail += stock * (p.price || 0);

      if (stock <= (p.lowStockThreshold ?? 5)) {
        lowStock.push(p);
      }

      if (p.expiryDate) {
        const expTime = new Date(p.expiryDate).getTime();
        const diffDays = (expTime - now.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 0) {
          expired.push(p);
        } else if (diffDays <= 30) {
          soonExpired.push(p);
        }
      }
    });

    // Best Sellers & Profit of all time mapping
    const productSoldQty: Record<string, { qty: number; name: string; sku: string }> = {};
    const productSoldProfit: Record<string, { profit: number; name: string; sku: string }> = {};

    processedSales.forEach(s => {
      (s.items || []).forEach(item => {
        const pid = item.productId;
        const q = item.quantity || 0;
        const price = item.price || 0;
        const cost = item.cost || 0;
        const profit = q * (price - cost);

        if (!productSoldQty[pid]) {
          productSoldQty[pid] = { qty: 0, name: item.name, sku: '' };
        }
        productSoldQty[pid].qty += q;

        if (!productSoldProfit[pid]) {
          productSoldProfit[pid] = { profit: 0, name: item.name, sku: '' };
        }
        productSoldProfit[pid].profit += profit;
      });
    });

    const bestSellers = Object.keys(productSoldQty)
      .map(id => ({ id, ...productSoldQty[id] }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    const bestProfitable = Object.keys(productSoldProfit)
      .map(id => ({ id, ...productSoldProfit[id] }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    // Track restock batches from products cost history
    const restockBatches: any[] = [];
    products.forEach(p => {
      const history = (p as any).costPriceHistory || [];
      history.forEach((h: any) => {
        restockBatches.push({
          productName: p.name,
          sku: p.sku || p.id.substring(0, 6),
          quantity: Number(h.quantity || 0),
          costPrice: Number(h.costPrice || p.cost || 0),
          date: new Date(h.date || p.createdAt || now).toLocaleDateString()
        });
      });
    });

    // Sort batches by latest date or fallback
    const sortedBatches = restockBatches.reverse().slice(0, 15);

    return {
      totalStock,
      totalValuationCost,
      totalValuationRetail,
      lowStock,
      soonExpired,
      expired,
      bestSellers,
      bestProfitable,
      restockBatches: sortedBatches
    };
  }, [products, processedSales]);

  // Chart Data preparation
  const dailySalesAndProfitChart = useMemo(() => {
    const daysMap: Record<string, { name: string; sales: number; profit: number }> = {};
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(now.getDate() - i);
      return d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
    }).reverse();

    last7Days.forEach(day => {
      daysMap[day] = { name: day, sales: 0, profit: 0 };
    });

    processedSales.forEach(s => {
      const sTime = getSaleTime(s);
      const sDateObj = sTime ? new Date(sTime) : null;
      if (!sDateObj) return;

      const dayStr = sDateObj.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
      if (daysMap[dayStr]) {
        daysMap[dayStr].sales += s.total || 0;
        daysMap[dayStr].profit += s.totalProfit || (s.total - (s.totalCost || 0));
      }
    });

    return Object.values(daysMap);
  }, [processedSales]);

  const expensesPieData = [
    { name: 'Salaries', value: expenseMetrics.salaries, color: '#3B82F6' },
    { name: 'Bills / Utilities', value: expenseMetrics.bills, color: '#10B981' },
    { name: 'Other Expenses', value: expenseMetrics.other, color: '#F59E0B' }
  ].filter(item => item.value > 0);

  const handleDownloadReportCSV = () => {
    let csvContent = "";
    let fileName = `BizSeq_Report_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`;

    if (activeTab === 'expenses') {
      const headers = ["ID", "Description", "Category", "Date", "Amount"];
      const rows = processedExpenses.map(e => [
        e.id || "",
        `"${String(e.description).replace(/"/g, '""')}"`,
        e.category || "",
        e.date || "",
        String(e.amount || 0)
      ]);
      csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    } else if (activeTab === 'products') {
      const headers = ["Rank", "Product Name", "Quantity Sold"];
      const rows = productMetrics.bestSellers.map((item, index) => [
        String(index + 1),
        `"${String(item.name).replace(/"/g, '""')}"`,
        String(item.qty || 0)
      ]);
      csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    } else {
      const headers = ["Sale ID", "Date", "Cashier", "Payment Method", "Items Count", "Subtotal", "Discount", "Total Paid"];
      const rows = processedSales.map(s => {
        const sTime = getSaleTime(s);
        const dateObj = sTime ? new Date(sTime) : new Date();
        const formattedDate = dateObj.toLocaleDateString() + " " + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const itemsCount = (s.items || []).reduce((sum: number, item: any) => sum + item.quantity, 0);
        return [
          s.id || "",
          `"${formattedDate}"`,
          `"${String(s.cashierName || 'System').replace(/"/g, '""')}"`,
          s.paymentMethod || "",
          String(itemsCount),
          String(s.subtotal || s.total || 0),
          String(s.discount || 0),
          String(s.total || 0)
        ];
      });
      csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintReport = () => {
    window.print();
  };

  return (
    <div className="p-4 md:p-8 space-y-8 bg-[#F8FAFC] min-h-screen text-slate-900 font-sans">
      
      {/* Dynamic Store Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-4 py-1.5 bg-slate-900 text-emerald-400 text-[10px] font-black uppercase tracking-[0.3em] rounded-full shadow-md">
              STORE MANAGER REPORTS
            </span>
            <span className="text-[10px] font-bold text-slate-400 font-mono">
              BizSeq Platform
            </span>
          </div>
          <h1 className="text-3xl font-black mt-2 tracking-tight">
            OPERATING STORE: <span className="text-blue-700 underline underline-offset-4 decoration-emerald-500 decoration-3">{profile?.store?.name || profile?.storeName || 'Store'}</span>
          </h1>
          <p className="text-slate-500 font-medium text-xs mt-1">
            Compute real-time analytical records of gross earnings, margin profits, expense logs, and inventory valuations.
          </p>
        </div>

        {/* Action button to quickly add expenses */}
        <button 
          onClick={() => setIsExpenseModalOpen(true)}
          className="flex items-center justify-center space-x-2 bg-slate-900 text-white px-6 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider shadow-md hover:bg-slate-800 transition-all select-none self-start"
        >
          <Plus className="h-4 w-4" />
          <span>Log Store Expense</span>
        </button>
      </header>

      {/* Reports Sub navigation tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-2 scrollbar-none pb-1 print-hidden">
        {[
          { id: 'overview', label: 'Overview Metrics', icon: BarChart3 },
          { id: 'sales', label: 'Earning Reports', icon: TrendingUp },
          { id: 'products', label: 'Product performance', icon: Award },
          { id: 'expenses', label: 'Store Expenses & Net Profit', icon: CreditCard },
          { id: 'analytics', label: 'Visual Trends', icon: BarChart3 }
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "px-5 py-3 rounded-t-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 border-b-2 whitespace-nowrap",
                active 
                  ? "border-blue-600 text-blue-700 bg-blue-50/50" 
                  : "border-transparent text-slate-400 hover:text-slate-800"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* NEW Date Range Picker & Export/Print Actions Bar */}
      <div className="bg-white border border-slate-250/80 rounded-[2rem] p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 print-hidden">
        <div className="flex flex-wrap items-center gap-3 w-full">
          
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-100/50 rounded-2xl px-4 py-2">
            <Calendar className="h-4 w-4 text-[#00529B]" />
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Date Filters:</span>
          </div>
          
          <div className="flex items-center gap-2">
            <input 
              type="date"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              className="bg-slate-50 border-2 border-slate-100 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
            />
            <span className="text-slate-400 text-xs font-bold font-mono">to</span>
            <input 
              type="date"
              value={endDateStr}
              onChange={(e) => setEndDateStr(e.target.value)}
              className="bg-slate-50 border-2 border-slate-100 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
            />
            {(startDateStr || endDateStr) && (
              <button 
                onClick={() => { setStartDateStr(''); setEndDateStr(''); }}
                className="p-2 hover:bg-rose-50 text-rose-500 rounded-xl transition-all font-black uppercase text-[10px]"
                title="Clear Filters"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-2xl px-3 py-1.5 ml-auto">
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Report Focus:</span>
            <select
              value={selectedReportType}
              onChange={(e) => {
                const val = e.target.value as any;
                setSelectedReportType(val);
                if (val === 'income_earning') setActiveTab('sales');
                if (val === 'stock_taking') setActiveTab('products');
                if (val === 'expenses_ledger') setActiveTab('expenses');
              }}
              className="bg-transparent border-0 text-xs font-bold text-[#00529B] focus:outline-none cursor-pointer p-1"
            >
              <option value="income_earning">Sales & Earnings Statement</option>
              <option value="stock_taking">Products Stock-Taking & Performance</option>
              <option value="expenses_ledger">Expenses Audit Ledger</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <button 
            type="button"
            onClick={handleDownloadReportCSV}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-800 text-slate-800 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all select-none"
          >
            <Download className="h-4 w-4 text-emerald-600" />
            <span>Download CSV</span>
          </button>
          
          <button 
            type="button"
            onClick={handlePrintReport}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all select-none shadow-md"
          >
            <Printer className="h-4 w-4" />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-24 flex flex-col items-center justify-center text-slate-400 text-center">
          <RefreshCw className="h-10 w-10 animate-spin text-blue-500 mb-4" />
          <span className="text-xs font-bold uppercase tracking-widest">Compiling Analytics Data...</span>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* 1. OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              
              {/* Gross vs Profit breakdown cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                
                {/* Daily earnings */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between hover:border-blue-200 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Gross Sales Today</span>
                    <Calendar className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="mt-4">
                    <span className="text-2xl font-black text-slate-900 font-mono italic">{formatCurrency(metrics.sales.today)}</span>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">From {metrics.counts.today} invoices today.</p>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3 flex justify-between text-xs">
                    <span className="font-bold text-slate-400">Cashier Profit:</span>
                    <span className="font-mono font-black text-emerald-600">{formatCurrency(metrics.profits.today)}</span>
                  </div>
                </div>

                {/* Gross Profit Today */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between hover:border-amber-200 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Gross Profit Today</span>
                    <TrendingUp className="h-4 w-4 text-amber-500" />
                  </div>
                  <div className="mt-4">
                    <span className="text-2xl font-black text-amber-600 font-mono italic">{formatCurrency(metrics.profits.today)}</span>
                    <p className="text-[10px] text-slate-400 font-medium mt-1 font-sans">Daily cashier gross margin.</p>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3 flex justify-between text-xs">
                    <span className="font-bold text-slate-400">Margin Profit:</span>
                    <span className="font-mono font-black text-amber-600">
                      {metrics.sales.today > 0 
                        ? `${((metrics.profits.today / metrics.sales.today) * 100).toFixed(1)}%` 
                        : '0.0%'}
                    </span>
                  </div>
                </div>

                {/* Gross weekly earnings */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between hover:border-emerald-200 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sales Past 7 Days</span>
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="mt-4">
                    <span className="text-2xl font-black text-slate-900 font-mono italic">{formatCurrency(metrics.sales.week)}</span>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">From {metrics.counts.week} invoices.</p>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3 flex justify-between text-xs">
                    <span className="font-bold text-slate-400">Total Profit:</span>
                    <span className="font-mono font-black text-emerald-600">{formatCurrency(metrics.profits.week)}</span>
                  </div>
                </div>

                {/* Inventory Valuation */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between hover:border-purple-200 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Inventory Valuation</span>
                    <Package className="h-4 w-4 text-purple-500" />
                  </div>
                  <div className="mt-4">
                    <span className="text-2xl font-black text-slate-900 font-mono italic">{formatCurrency(productMetrics.totalValuationCost)}</span>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">Cost basis across all storage sites.</p>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3 flex justify-between text-xs">
                    <span className="font-bold text-slate-400">Valuation at Retail:</span>
                    <span className="font-mono font-black text-purple-600">{formatCurrency(productMetrics.totalValuationRetail)}</span>
                  </div>
                </div>

                {/* Net Earnings monthly (Profit - logged expenses) */}
                <div className="bg-slate-900 border border-slate-950 text-white rounded-3xl p-6 shadow-md flex flex-col justify-between">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Nett Profit (Month)</span>
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="mt-4">
                    <span className={cn("text-2xl font-black font-mono italic", expenseMetrics.netProfitMonth >= 0 ? "text-emerald-400" : "text-rose-500")}>
                      {formatCurrency(expenseMetrics.netProfitMonth)}
                    </span>
                    <p className="text-[10px] text-emerald-400/70 font-medium mt-1">After deducting {formatCurrency(expenseMetrics.totalExpenses)} of expenses.</p>
                  </div>
                  <div className="mt-4 border-t border-slate-800 pt-3 flex justify-between text-xs">
                    <span className="font-bold text-slate-400">Sales (Month):</span>
                    <span className="font-mono font-black text-white">{formatCurrency(metrics.sales.month)}</span>
                  </div>
                </div>

              </div>

              {/* Warnings and alerts row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Stock Warning Box */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 lg:col-span-1 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <span className="text-xs font-black uppercase tracking-wider">Critical Inventory Alerts</span>
                  </div>

                  <div className="flex-1 space-y-4 max-h-[250px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-2 gap-2 bg-rose-50 border border-rose-100 p-3 rounded-2xl">
                      <div className="text-center">
                        <span className="text-lg font-black text-rose-600 font-mono">{productMetrics.lowStock.length}</span>
                        <p className="text-[8px] font-black text-rose-500 uppercase mt-0.5">Low Stock Items</p>
                      </div>
                      <div className="text-center border-l border-rose-200">
                        <span className="text-lg font-black text-red-600 font-mono">{productMetrics.expired.length}</span>
                        <p className="text-[8px] font-black text-red-500 uppercase mt-0.5">Expired Items</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 mt-2">
                      {productMetrics.lowStock.slice(0, 4).map((p, idx) => (
                        <div key={`low-stock-${p.id || 'unkn'}-${idx}`} className="flex justify-between items-center text-xs p-2 bg-slate-50 rounded-xl hover:bg-slate-100">
                          <span className="font-black truncate max-w-[150px] uppercase text-slate-800">{p.name}</span>
                          <span className="font-mono font-bold text-rose-600">Stock: {p.stock}</span>
                        </div>
                      ))}
                      {productMetrics.lowStock.length === 0 && (
                        <p className="text-[10px] text-slate-400 italic text-center py-6">All stock counts are within healthy limits.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Best Selling Products list */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 lg:col-span-1 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-4">
                    <Award className="h-5 w-5 text-blue-500" />
                    <span className="text-xs font-black uppercase tracking-wider">Top 5 Best Selling Items</span>
                  </div>

                  <div className="flex-1 space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {productMetrics.bestSellers.map((item, index) => (
                      <div key={`best-seller-${item.id || 'adhoc'}-${index}`} className="flex items-center justify-between text-xs p-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <span className="h-6 w-6 font-mono font-black bg-blue-100 text-blue-700 flex items-center justify-center rounded-xl text-[10px]">{index + 1}</span>
                          <span className="font-bold text-slate-900 uppercase truncate max-w-[140px]">{item.name}</span>
                        </div>
                        <span className="font-mono font-black text-blue-600">{item.qty} units sold</span>
                      </div>
                    ))}
                    {productMetrics.bestSellers.length === 0 && (
                      <p className="text-[10px] text-slate-400 italic text-center py-10">No sales transactions processed yet.</p>
                    )}
                  </div>
                </div>

                {/* Best Profit Generators */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 lg:col-span-1 shadow-sm flex flex-col">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                    <span className="text-xs font-black uppercase tracking-wider">Top 5 Profit Generators</span>
                  </div>

                  <div className="flex-1 space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {productMetrics.bestProfitable.map((item, index) => (
                      <div key={`best-profitable-${item.id || 'adhoc'}-${index}`} className="flex items-center justify-between text-xs p-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <span className="h-6 w-6 font-mono font-black bg-emerald-100 text-emerald-700 flex items-center justify-center rounded-xl text-[10px]">{index + 1}</span>
                          <span className="font-bold text-slate-900 uppercase truncate max-w-[140px]">{item.name}</span>
                        </div>
                        <span className="font-mono font-black text-emerald-600">+{formatCurrency(item.profit)}</span>
                      </div>
                    ))}
                    {productMetrics.bestProfitable.length === 0 && (
                      <p className="text-[10px] text-slate-400 italic text-center py-10">Waiting for margin data to accumulate.</p>
                    )}
                  </div>
                </div>

              </div>

            </motion.div>
          )}

          {/* 2. SALES TAB */}
          {activeTab === 'sales' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <h3 className="text-sm font-black uppercase tracking-widest text-[#00529B] mb-6">Historical Earning Summaries</h3>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">TODAY'S TURNOVER</span>
                    <h4 className="text-xl font-black font-mono mt-1 text-slate-900">{formatCurrency(metrics.sales.today)}</h4>
                    <span className="text-[8px] font-bold text-slate-400 mt-1 block">{metrics.counts.today} sales registered</span>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">PAST 7 DAYS</span>
                    <h4 className="text-xl font-black font-mono mt-1 text-slate-900">{formatCurrency(metrics.sales.week)}</h4>
                    <span className="text-[8px] font-bold text-slate-400 mt-1 block">{metrics.counts.week} sales registered</span>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">PAST 30 DAYS</span>
                    <h4 className="text-xl font-black font-mono mt-1 text-slate-900">{formatCurrency(metrics.sales.month)}</h4>
                    <span className="text-[8px] font-bold text-slate-400 mt-1 block">{metrics.counts.month} sales registered</span>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">YEAR TO DATE</span>
                    <h4 className="text-xl font-black font-mono mt-1 text-slate-900">{formatCurrency(metrics.sales.year)}</h4>
                    <span className="text-[8px] font-bold text-slate-400 mt-1 block">{metrics.counts.year} sales registered</span>
                  </div>

                </div>
              </div>

              {/* Cash vs POS payment splits breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm md:col-span-2">
                  <h3 className="text-sm font-black uppercase tracking-widest mb-4">Earning Logs Flow</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400 h-10">
                          <th className="py-2">Sale Receipt ID</th>
                          <th className="py-2">Cashier / Staff</th>
                          <th className="py-2 text-center">Items count</th>
                          <th className="py-2">Payment Mode</th>
                          <th className="py-2 text-right">Sum paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {processedSales.slice(0, 10).map((s, index) => (
                          <tr key={`sales-row-${s.id || 'unkn'}-${index}`} className="border-b border-slate-50 h-12 hover:bg-slate-50 transition-colors">
                            <td className="font-mono font-black text-blue-600">#{(s.id || '').substring(0, 8).toUpperCase()}</td>
                            <td className="font-medium text-slate-800 uppercase">{s.cashierName || 'System'}</td>
                            <td className="text-center font-bold">{(s.items || []).reduce((sum, item) => sum + item.quantity, 0)}</td>
                            <td className="capitalize font-black text-[10px] text-slate-500 font-mono tracking-wide">{s.paymentMethod}</td>
                            <td className="font-mono font-black text-slate-900 text-right">{formatCurrency(s.total)}</td>
                          </tr>
                        ))}
                        {processedSales.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-12 text-center text-slate-300 italic">No sales logs stored yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm md:col-span-1">
                  <h3 className="text-sm font-black uppercase tracking-widest mb-4">Payment Methods split</h3>
                  <div className="space-y-4">
                    {['cash', 'pos', 'transfer', 'credit'].map(m => {
                      const modeCount = processedSales.filter(v => v.paymentMethod === m).length;
                      const modeSum = processedSales.filter(v => v.paymentMethod === m).reduce((sum, v) => sum + v.total, 0);

                      return (
                        <div key={m} className="p-3 bg-slate-50 rounded-xl flex justify-between items-center hover:bg-slate-100">
                          <div>
                            <span className="text-xs font-black uppercase text-slate-800">{m}</span>
                            <p className="text-[9px] text-slate-400">{modeCount} transactions</p>
                          </div>
                          <span className="font-mono font-black text-blue-700 text-xs">{formatCurrency(modeSum)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

            </motion.div>
          )}

          {/* 3. PRODUCTS TAB */}
          {activeTab === 'products' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              
              {/* Product margins & expiry dates tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* Expired or nearly expired items */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xs font-black uppercase tracking-wider text-rose-600 flex items-center gap-1.5Packed">
                      <AlertTriangle className="h-4 w-4" /> Soon To Expire / Expired products
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">Within 30 Days</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 h-10">
                          <th className="py-2">Item Name</th>
                          <th className="py-2">Expiry Date</th>
                          <th className="py-2 text-center">Stock</th>
                          <th className="py-2 text-right">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productMetrics.expired.map((p, idx) => (
                          <tr key={`expired-${p.id || 'unkn'}-${idx}`} className="border-b border-slate-50 h-11 text-red-600 font-bold bg-rose-50/20">
                            <td className="py-2 font-black uppercase truncate max-w-[140px]">{p.name}</td>
                            <td>{p.expiryDate ? new Date(p.expiryDate).toLocaleDateString() : 'N/A'}</td>
                            <td className="text-center">{p.stock}</td>
                            <td className="text-right text-[10px] font-black uppercase tracking-wider text-red-500">EXPIRED</td>
                          </tr>
                        ))}
                        {productMetrics.soonExpired.map((p, idx) => (
                          <tr key={`soon-expired-${p.id || 'unkn'}-${idx}`} className="border-b border-slate-50 h-11 text-amber-600 font-bold">
                            <td className="py-2 font-black uppercase truncate max-w-[140px]">{p.name}</td>
                            <td>{p.expiryDate ? new Date(p.expiryDate).toLocaleDateString() : 'N/A'}</td>
                            <td className="text-center">{p.stock}</td>
                            <td className="text-right text-[10px] font-black uppercase tracking-wider text-amber-500">SOON</td>
                          </tr>
                        ))}
                        {productMetrics.expired.length === 0 && productMetrics.soonExpired.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-10 text-center text-slate-300 italic">No expired or nearly expired products found.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Batches Restock Track */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xs font-black uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                      <Clock className="h-4 w-4" /> Batches Entered / Restock History
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 font-mono">Last 15 logs</span>
                  </div>

                  <div className="overflow-y-auto max-h-[300px] pr-1">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 h-10 sticky top-0 bg-white">
                          <th className="py-2">Item Name</th>
                          <th className="py-2">Restock Date</th>
                          <th className="py-2 text-center">Qty Entered</th>
                          <th className="py-2 text-right">Cost Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productMetrics.restockBatches.map((batch, index) => (
                          <tr key={index} className="border-b border-slate-50 h-11 hover:bg-slate-50 transition-colors">
                            <td className="py-2 font-bold text-slate-800 uppercase truncate max-w-[160px]">{batch.productName}</td>
                            <td className="text-slate-500">{batch.date}</td>
                            <td className="text-center font-mono font-black text-slate-900">+{batch.quantity}</td>
                            <td className="text-right font-mono text-emerald-600 font-bold">{formatCurrency(batch.costPrice)}</td>
                          </tr>
                        ))}
                        {productMetrics.restockBatches.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-10 text-center text-slate-300 italic">No restocking activities tracked yet. Use Inventory Restock to input more.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

            </motion.div>
          )}

          {/* 4. EXPENSES TAB */}
          {activeTab === 'expenses' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Expenses logger summary card */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm lg:col-span-1 h-fit">
                  <h3 className="text-sm font-black uppercase tracking-wider mb-6">Store Profitability Deduct</h3>
                  
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex justify-between items-center">
                      <div>
                        <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest">Gross Profit (Month)</span>
                        <h4 className="text-lg font-black mt-1 font-mono text-blue-800">{formatCurrency(metrics.profits.month)}</h4>
                      </div>
                    </div>

                    <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-100 flex justify-between items-center">
                      <div>
                        <span className="text-[8px] font-black text-orange-600 uppercase tracking-widest font-sans">logged Store Expenses</span>
                        <h4 className="text-lg font-black mt-1 font-mono text-orange-800">-{formatCurrency(expenseMetrics.totalExpenses)}</h4>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-900 rounded-2xl border border-slate-950 flex justify-between items-center text-white">
                      <div>
                        <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest font-sans">NET STORE PROFIT</span>
                        <h4 className={cn("text-xl font-black mt-1 font-mono italic", expenseMetrics.netProfitMonth >= 0 ? "text-emerald-400" : "text-rose-500")}>
                          {formatCurrency(expenseMetrics.netProfitMonth)}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsExpenseModalOpen(true)}
                    className="w-full mt-6 bg-blue-600 text-white font-black uppercase text-xs tracking-widest py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-md"
                  >
                    Log New Store Expense
                  </button>
                </div>

                {/* Expenses Log details table */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm lg:col-span-2">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-black uppercase tracking-wider">Historical Expense Ledger</h3>
                    <span className="text-[9px] font-bold text-slate-400">Total Records: {expenses.length}</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 h-10">
                          <th className="py-2">Description / Recipient</th>
                          <th className="py-2">Category</th>
                          <th className="py-2">Date Managed</th>
                          <th className="py-2 text-right">Sum paid</th>
                          <th className="py-2 text-center w-12">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map((e, index) => (
                          <tr key={`expense-ledger-${e.id || 'unkn'}-${index}`} className="border-b border-slate-50 h-12 hover:bg-slate-50 transition-colors">
                            <td className="py-2 font-black uppercase text-slate-900">{e.description}</td>
                            <td>
                              <span className={cn("px-2.5 py-1 text-[8px] font-black uppercase rounded-full border tracking-wide",
                                e.category === 'salaries' ? 'bg-blue-50 border-blue-100 text-blue-700' :
                                e.category === 'bills' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-700'
                              )}>
                                {e.category}
                              </span>
                            </td>
                            <td className="font-medium text-slate-500 font-mono">{e.date}</td>
                            <td className="font-mono font-black text-rose-600 text-right">-{formatCurrency(e.amount)}</td>
                            <td className="text-center">
                              <button 
                                onClick={() => handleDeleteExpense(e.id)}
                                className="p-1.5 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {expenses.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-16 text-center text-slate-300 italic">No expenses reported this cycle. Keep profit secure!</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

            </motion.div>
          )}

          {/* 5. VISUAL ANALYTICS TAB */}
          {activeTab === 'analytics' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              
              {/* Daily Sales trend and Expenses breakout pie charts */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Curve analytics chart */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm lg:col-span-2">
                  <h3 className="text-sm font-black uppercase tracking-widest text-[#00529B] mb-6">7-Day Sales & Profit Curves</h3>
                  <div className="h-80 w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                      <AreaChart data={dailySalesAndProfitChart}>
                        <defs>
                          <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="name" stroke="#94A3B8" fontSize={10} fontWeight={700} />
                        <YAxis stroke="#94A3B8" fontSize={10} fontWeight={700} />
                        <Tooltip />
                        <Area type="monotone" dataKey="sales" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" name="Gross Sales" />
                        <Area type="monotone" dataKey="profit" stroke="#10B981" strokeWidth={3} fillOpacity={1} fill="url(#colorProfit)" name="Gross Profit" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Expenses Pie chart */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm lg:col-span-1">
                  <h3 className="text-sm font-black uppercase tracking-widest mb-6">Expenses Breakdown Pie</h3>
                  
                  {expensesPieData.length > 0 ? (
                    <div className="flex flex-col items-center">
                      <div className="h-60 w-full flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                          <PieChart>
                            <Pie
                              data={expensesPieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {expensesPieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => formatCurrency(v)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      
                      {/* Legend list */}
                      <div className="space-y-2 w-full mt-4">
                        {expensesPieData.map((item, index) => (
                          <div key={index} className="flex justify-between items-center text-xs">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="font-bold text-slate-700">{item.name}</span>
                            </div>
                            <span className="font-mono font-black">{formatCurrency(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-72 flex flex-col items-center justify-center text-slate-400 text-center">
                      <Clock className="h-10 w-10 mb-4 opacity-25" />
                      <p className="text-[10px] font-black uppercase tracking-widest">No Expenses Logged</p>
                      <p className="text-[9px] font-medium italic mt-1.5 px-6">Click "Log Store Expense" at top to add and see details here.</p>
                    </div>
                  )}
                </div>

              </div>

            </motion.div>
          )}

        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 6. MODAL TO LOG EXPENSES */}
      {/* ------------------------------------------------------------------ */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/40">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white border-2 border-slate-900 shadow-none max-w-sm w-full rounded-[2.5rem] overflow-hidden"
          >
            <div className="h-14 bg-slate-950 px-6 flex items-center justify-between text-white shrink-0">
               <span className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                 <CreditCard className="h-4 w-4 text-emerald-400" /> Log Store Expense
               </span>
               <button 
                 onClick={() => setIsExpenseModalOpen(false)} 
                 className="p-1 hover:bg-white/10 rounded-xl transition-colors"
               >
                 <X className="h-5 w-5" />
               </button>
            </div>

            <form onSubmit={handleAddExpense} className="p-6 space-y-4 pr-6">
              
              {/* Exp 1: Category dropdown */}
              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-800 mb-1.5 ml-1">Expense Category</label>
                <select 
                  value={expCategory}
                  onChange={e => setExpCategory(e.target.value as any)}
                  className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-xs outline-none w-full font-bold cursor-pointer"
                >
                  <option value="bills">Bills / Rent / Power</option>
                  <option value="salaries">Workers' Salaries</option>
                  <option value="other">Other Store Overhead</option>
                </select>
              </div>

              {/* Exp 2: Name/Description */}
              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-800 mb-1.5 ml-1">Recipient / Description</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. May Electricity Bill, Cashier Salary"
                  value={expDescription}
                  onChange={e => setExpDescription(e.target.value)}
                  className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-xs outline-none w-full font-sans"
                />
              </div>

              {/* Exp 3: Amount */}
              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-800 mb-1.5 ml-1">Amount Spend</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">₦</span>
                  <input
                    type="number"
                    required
                    placeholder="0.00"
                    value={expAmount}
                    onChange={e => setExpAmount(e.target.value)}
                    className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg pl-7 pr-3 bg-white text-xs outline-none w-full font-mono font-black text-rose-600"
                  />
                </div>
              </div>

              {/* Exp 4: Date */}
              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-800 mb-1.5 ml-1">Payment Date</label>
                <input 
                  type="date"
                  required
                  value={expDate}
                  onChange={e => setExpDate(e.target.value)}
                  className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-xs outline-none w-full font-mono font-bold"
                />
              </div>

              {/* Form buttons */}
              <div className="flex gap-2 pt-4 justify-end">
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="h-11 px-4 border border-slate-200 font-bold uppercase text-[10px] rounded-xl hover:bg-slate-50 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingExpense}
                  className="h-11 px-5 bg-blue-600 text-white font-black uppercase text-[10px] rounded-xl tracking-wider hover:bg-blue-700 transition-colors flex items-center justify-center"
                >
                  {isSavingExpense ? 'Saving...' : 'Confirm Exp.'}
                </button>
              </div>

            </form>
          </motion.div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 7. HIGH-FIDELITY PRINT-ONLY REPORT PREVIEWS */}
      {/* ------------------------------------------------------------------ */}
      <div className="hidden print:block bg-white text-slate-900 font-sans p-8 w-full space-y-8 print-report-wrapper">
        
        {/* REPORT HEADER */}
        <div className="border-b-4 border-slate-900 pb-5">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-black tracking-tight uppercase text-slate-900">
                {profile?.store?.name || profile?.storeName || 'Store'}
              </h1>
              <p className="text-xs font-bold font-mono tracking-wider text-slate-500 uppercase mt-0.5">
                Official Business Management Record
              </p>
              {profile?.storePhone && <p className="text-[10px] text-slate-600 font-mono">Phone: {profile.storePhone}</p>}
              {profile?.storeAddress && <p className="text-[10px] text-slate-600 font-mono mt-0.5">Address: {profile.storeAddress}</p>}
            </div>
            
            <div className="text-right">
              <span className="px-3 py-1 bg-slate-900 text-white text-[9px] font-black uppercase tracking-wider rounded-md">
                {selectedReportType === 'income_earning' ? 'Financial Summary' :
                 selectedReportType === 'stock_taking' ? 'Inventory Audit' : 'Overhead Ledger'}
              </span>
              <p className="text-[10px] text-slate-400 font-mono mt-1.5">
                Generated: {new Date().toLocaleString()}
              </p>
            </div>
          </div>

          <h2 className="text-lg font-black uppercase mt-6 tracking-wide text-slate-800">
            {selectedReportType === 'income_earning' && 'FINANCIAL INCOME & EARNINGS STATEMENT'}
            {selectedReportType === 'stock_taking' && 'PRODUCTS INVENTORY & STOCK-TAKING REPORT'}
            {selectedReportType === 'expenses_ledger' && 'STORE OVERHEAD & EXPENSES AUDIT STATEMENT'}
          </h2>
          
          <p className="text-xs font-bold text-slate-500 mt-1">
            Period Dates: <span className="text-slate-800 font-mono font-black">{startDateStr || 'All Inception'}</span> to <span className="text-slate-800 font-mono font-black">{endDateStr || 'All Inception'}</span>
          </p>
        </div>

        {/* ==================== 1. INCOME & EARNING PRINT Focus ==================== */}
        {selectedReportType === 'income_earning' && (
          <div className="space-y-6">
            
            {/* KPI metrics row for print */}
            <div className="grid grid-cols-4 gap-4">
              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Gross Revenue (Period)</span>
                <p className="text-lg font-black font-mono text-slate-900 mt-1">
                  {formatCurrency(processedSales.reduce((sum, s) => sum + (s.total || 0), 0))}
                </p>
              </div>

              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Estimated Profit</span>
                <p className="text-lg font-black font-mono text-emerald-800 mt-1">
                  {formatCurrency(processedSales.reduce((sum, s) => sum + (s.totalProfit || (s.total - (s.totalCost || 0))), 0))}
                </p>
              </div>

              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Invoice Count</span>
                <p className="text-lg font-black font-mono text-slate-900 mt-1">{processedSales.length} invoices</p>
              </div>

              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Overhead Expenses</span>
                <p className="text-lg font-black font-mono text-rose-800 mt-1">
                  {formatCurrency(processedExpenses.reduce((sum, e) => sum + (e.amount || 0), 0))}
                </p>
              </div>
            </div>

            {/* Payment splitting row for print */}
            <div className="border border-slate-300 p-4 rounded-xl bg-white">
              <h3 className="text-xs font-black uppercase tracking-wider mb-3 text-slate-800">Earning Splits By Payment Method</h3>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
                  <span className="text-[9px] font-black text-slate-400 block">CASH PAYMENTS</span>
                  <span className="text-sm font-black font-mono mt-0.5 block text-slate-800">
                    {formatCurrency(processedSales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + (s.total || 0), 0))}
                  </span>
                </div>
                <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
                  <span className="text-[9px] font-black text-slate-400 block">POS SWITCH PAYMENTS</span>
                  <span className="text-sm font-black font-mono mt-0.5 block text-slate-800">
                    {formatCurrency(processedSales.filter(s => s.paymentMethod === 'pos').reduce((sum, s) => sum + (s.total || 0), 0))}
                  </span>
                </div>
                <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
                  <span className="text-[9px] font-black text-slate-400 block">BANK TRANSFERS</span>
                  <span className="text-sm font-black font-mono mt-0.5 block text-slate-800">
                    {formatCurrency(processedSales.filter(s => s.paymentMethod === 'transfer').reduce((sum, s) => sum + (s.total || 0), 0))}
                  </span>
                </div>
                <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
                  <span className="text-[9px] font-black text-slate-400 block">CREDIT OUTSTANDING</span>
                  <span className="text-sm font-black font-mono mt-0.5 block text-slate-800">
                    {formatCurrency(processedSales.filter(s => s.paymentMethod === 'credit').reduce((sum, s) => sum + (s.total || 0), 0))}
                  </span>
                </div>
              </div>
            </div>

            {/* Invoices logs table */}
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Sales Invoices Logs - Detail Analysis</h3>
              <table className="w-full text-[10px] text-left border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 font-bold uppercase text-slate-700 h-8">
                    <th className="px-3 border-r border-slate-300 text-center w-10">SNo</th>
                    <th className="px-3 border-r border-slate-300 w-24">Receipt ID</th>
                    <th className="px-3 border-r border-slate-300 w-32">Date / Time</th>
                    <th className="px-3 border-r border-slate-300">Staff Cashier</th>
                    <th className="px-3 border-r border-slate-300 text-center w-16">Payment</th>
                    <th className="px-3 border-r border-slate-300 text-center w-12">Items</th>
                    <th className="px-3 text-right">Sum Received</th>
                  </tr>
                </thead>
                <tbody>
                  {processedSales.map((s, index) => {
                    const sTime = getSaleTime(s);
                    const dateObj = sTime ? new Date(sTime) : new Date();
                    const formattedDate = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const itemsCount = (s.items || []).reduce((sum, item) => sum + item.quantity, 0);

                    return (
                      <tr key={`print-sale-row-${s.id || 'unkn'}-${index}`} className="border-b border-slate-300 h-8 hover:bg-slate-50">
                        <td className="px-3 border-r border-slate-300 text-center">{index + 1}</td>
                        <td className="px-3 border-r border-slate-300 font-mono font-bold uppercase text-blue-800">#{(s.id || '').substring(0, 8).toUpperCase()}</td>
                        <td className="px-3 border-r border-slate-300 font-mono">{formattedDate}</td>
                        <td className="px-3 border-r border-slate-300 uppercase font-medium">{s.cashierName || 'System'}</td>
                        <td className="px-3 border-r border-slate-300 text-center uppercase font-bold text-[9px] text-slate-500">{s.paymentMethod}</td>
                        <td className="px-3 border-r border-slate-300 text-center">{itemsCount}</td>
                        <td className="px-3 font-mono font-bold text-right">{formatCurrency(s.total)}</td>
                      </tr>
                    );
                  })}
                  {processedSales.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-400 italic">No sales transactions processed within this range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Performance Ranking and margin summaries */}
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-slate-300 p-4 rounded-xl bg-white">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Top Selling Items (Selected Range)</span>
                <div className="mt-3 space-y-1.5">
                  {productMetrics.bestSellers.slice(0, 5).map((item, index) => (
                    <div key={`print-best-seller-${item.id || 'adhoc'}-${index}`} className="flex justify-between items-center text-[11px] border-b border-slate-100 py-1">
                      <span className="font-bold text-slate-800 uppercase">{index + 1}. {item.name}</span>
                      <span className="font-mono font-black text-slate-900">{item.qty} units</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border border-slate-300 p-4 rounded-xl bg-white">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Estimated Profit Generators</span>
                <div className="mt-3 space-y-1.5">
                  {productMetrics.bestProfitable.slice(0, 5).map((item, index) => (
                    <div key={`print-best-profitable-${item.id || 'adhoc'}-${index}`} className="flex justify-between items-center text-[11px] border-b border-slate-100 py-1">
                      <span className="font-bold text-slate-800 uppercase">{index + 1}. {item.name}</span>
                      <span className="font-mono font-black text-emerald-800">+{formatCurrency(item.profit)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ==================== 2. PRODUCTS STOCK-TAKING PRINT Focus ==================== */}
        {selectedReportType === 'stock_taking' && (
          <div className="space-y-6">
            
            {/* Valuation KPI grids */}
            <div className="grid grid-cols-4 gap-4">
              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Registered Products</span>
                <p className="text-lg font-black font-mono text-slate-900 mt-1">{products.length}</p>
              </div>

              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Total Stock Units</span>
                <p className="text-lg font-black font-mono text-slate-900 mt-1">
                  {products.reduce((sum, p) => sum + (p.stock || 0), 0)}
                </p>
              </div>

              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Inventory Cost Valuation</span>
                <p className="text-lg font-black font-mono text-slate-900 mt-1">
                  {formatCurrency(productMetrics.totalValuationCost)}
                </p>
              </div>

              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Est. Retail Value</span>
                <p className="text-lg font-black font-mono text-emerald-800 mt-1">
                  {formatCurrency(productMetrics.totalValuationRetail)}
                </p>
              </div>
            </div>

            {/* Full Products Stocktaking Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Real-Time Inventory Audit Sheet</h3>
              <table className="w-full text-[10px] text-left border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 font-bold uppercase text-slate-700 h-8">
                    <th className="px-2 border-r border-slate-300 text-center w-8">SNo</th>
                    <th className="px-2 border-r border-slate-300">Product Name</th>
                    <th className="px-2 border-r border-slate-300 w-24">SKU Code</th>
                    <th className="px-2 border-r border-slate-300 w-24">Category</th>
                    <th className="px-2 border-r border-slate-300 text-center w-14">Stock</th>
                    <th className="px-2 border-r border-slate-300 text-right w-16">Cost</th>
                    <th className="px-2 border-r border-slate-300 text-right w-16">Retail Price</th>
                    <th className="px-2 border-r border-slate-300 text-right w-20">Cost Basis Val</th>
                    <th className="px-2 border-r border-slate-300 text-center w-14">Status</th>
                    <th className="px-3 text-center w-24">Physical Count</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, index) => {
                    const isLow = (p.stock || 0) <= (p.lowStockThreshold ?? 5);
                    const isOut = (p.stock || 0) <= 0;
                    
                    return (
                      <tr key={`stocktaking-p-${p.id || 'unkn'}-${index}`} className="border-b border-slate-300 h-8 hover:bg-slate-50">
                        <td className="px-2 border-r border-slate-300 text-center">{index + 1}</td>
                        <td className="px-2 border-r border-slate-300 uppercase font-black">{p.name}</td>
                        <td className="px-2 border-r border-slate-300 font-mono uppercase truncate max-w-[90px]">{p.sku || p.id.substring(0, 6)}</td>
                        <td className="px-2 border-r border-slate-300 truncate max-w-[80px] uppercase font-bold text-slate-500">{p.category || 'General'}</td>
                        <td className={`px-2 border-r border-slate-300 text-center font-mono font-black ${isOut ? 'text-red-600 bg-red-100 font-bold' : isLow ? 'text-amber-600 bg-amber-100 font-bold' : 'text-slate-900'}`}>{p.stock}</td>
                        <td className="px-2 border-r border-slate-300 font-mono text-right">{formatCurrency(p.cost || 0)}</td>
                        <td className="px-2 border-r border-slate-300 font-mono text-right">{formatCurrency(p.price || 0)}</td>
                        <td className="px-2 border-r border-slate-300 font-mono text-right">{formatCurrency((p.stock || 0) * (p.cost || 0))}</td>
                        <td className="px-2 border-r border-slate-300 text-center font-bold">
                          <span className={`${isOut ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-green-600'}`}>
                            {isOut ? 'OUT' : isLow ? 'LOW' : 'OK'}
                          </span>
                        </td>
                        <td className="px-3 font-mono border-l text-center text-slate-400">[ &nbsp; &nbsp; &nbsp; &nbsp; ]</td>
                      </tr>
                    );
                  })}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center text-slate-400 italic">No inventory products registered.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* ==================== 3. EXPENSES AUDIT PRINT Focus ==================== */}
        {selectedReportType === 'expenses_ledger' && (
          <div className="space-y-6">
            
            {/* Overhead KPI grids */}
            <div className="grid grid-cols-3 gap-4">
              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Gross Margin Profit</span>
                <p className="text-lg font-black font-mono text-emerald-800 mt-1">
                  {formatCurrency(processedSales.reduce((sum, s) => sum + (s.totalProfit || (s.total - (s.totalCost || 0))), 0))}
                </p>
              </div>

              <div className="border border-slate-350 p-4 rounded-xl text-center shadow-xs bg-slate-50">
                <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Overhead Expenses</span>
                <p className="text-lg font-black font-mono text-rose-800 mt-1">
                  -{formatCurrency(processedExpenses.reduce((sum, e) => sum + (e.amount || 0), 0))}
                </p>
              </div>

              <div className="border border-slate-900 bg-slate-950 text-white p-4 rounded-xl text-center">
                <span className="text-[8px] font-black uppercase text-slate-300 tracking-wider">Current Period Net Profit</span>
                <p className="text-lg font-black font-mono text-white mt-1">
                  {formatCurrency(
                    processedSales.reduce((sum, s) => sum + (s.totalProfit || (s.total - (s.totalCost || 0))), 0) - 
                    processedExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
                  )}
                </p>
              </div>
            </div>

            {/* Category breakdown rows */}
            <div className="border border-slate-300 p-4 rounded-xl bg-white">
              <h3 className="text-xs font-black uppercase tracking-wider mb-2 text-slate-800">Categorized Cost Overhead Summary</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-2 border border-slate-100 rounded-lg">
                  <span className="text-[8px] font-black text-slate-400 block uppercase">Salaries & Rent</span>
                  <span className="text-sm font-black font-mono text-slate-800">
                    {formatCurrency(processedExpenses.filter(e => e.category === 'salaries').reduce((sum, e) => sum + (e.amount || 0), 0))}
                  </span>
                </div>
                <div className="p-2 border border-slate-100 rounded-lg">
                  <span className="text-[8px] font-black text-slate-400 block uppercase">Utility & Power bills</span>
                  <span className="text-sm font-black font-mono text-slate-800">
                    {formatCurrency(processedExpenses.filter(e => e.category === 'bills').reduce((sum, e) => sum + (e.amount || 0), 0))}
                  </span>
                </div>
                <div className="p-2 border border-slate-100 rounded-lg">
                  <span className="text-[8px] font-black text-slate-400 block uppercase">Other Store Overheads</span>
                  <span className="text-sm font-black font-mono text-slate-800">
                    {formatCurrency(processedExpenses.filter(e => e.category !== 'salaries' && e.category !== 'bills').reduce((sum, e) => sum + (e.amount || 0), 0))}
                  </span>
                </div>
              </div>
            </div>

            {/* Full historical expenses ledger table */}
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Store Overhead Expenses Ledger List</h3>
              <table className="w-full text-[10px] text-left border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 font-bold uppercase text-slate-700 h-8">
                    <th className="px-3 border-r border-slate-300 text-center w-12">SNo</th>
                    <th className="px-3 border-r border-slate-300">Recipient / Description</th>
                    <th className="px-3 border-r border-slate-300 w-32">Expense Category</th>
                    <th className="px-3 border-r border-slate-300 w-32 font-mono text-center">Transaction Date</th>
                    <th className="px-3 text-right">Sum Disbursed</th>
                  </tr>
                </thead>
                <tbody>
                  {processedExpenses.map((e, index) => (
                    <tr key={`print-expense-e-${e.id || 'unkn'}-${index}`} className="border-b border-slate-300 h-8 hover:bg-slate-50">
                      <td className="px-3 border-r border-slate-300 text-center">{index + 1}</td>
                      <td className="px-3 border-r border-slate-300 uppercase font-black">{e.description}</td>
                      <td className="px-3 border-r border-slate-300 font-bold uppercase text-[9px] text-slate-500">{e.category}</td>
                      <td className="px-3 border-r border-slate-300 font-mono text-center">{e.date}</td>
                      <td className="px-3 font-mono font-bold text-right text-rose-700">-{formatCurrency(e.amount || 0)}</td>
                    </tr>
                  ))}
                  {processedExpenses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-400 italic">No overhead expenses found within this range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* PRINT FOOTER SIGNATURE BAR */}
        <div className="pt-12 mt-12 border-t border-dashed border-slate-450 flex justify-between text-xs font-mono">
          <div>
            <p>Prepared By Staff: ___________________________</p>
            <p className="text-[9px] text-slate-400 mt-1">Full Name, Timestamp, Signature</p>
          </div>
          <div className="text-right">
            <p>Audit Approved By Manager: ___________________________</p>
            <p className="text-[9px] text-slate-400 mt-1">Company Executive Signature & Seal</p>
          </div>
        </div>

      </div>

      {/* Print-specific style overrides */}
      <style>{`
        @media print {
          /* Hide all application chrome (sidebar, search, filters) */
          body, #root, main, .min-h-screen, .bg-[#F8FAFC] {
            background: white !important;
            color: black !important;
            font-family: 'Inter', system-ui, sans-serif !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }

          /* Hide interactive body */
          header, 
          .flex.border-b, 
          .print-hidden,
          button,
          aside,
          nav,
          .bg-slate-900:not(.print-report-wrapper span),
          .rounded-3xl,
          .fixed.inset-0 {
            display: none !important;
          }

          /* Show print report body exclusively */
          .print-report-wrapper {
            display: block !important;
            visibility: visible !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            z-index: 999999 !important;
            padding: 10mm !important;
            box-sizing: border-box !important;
          }

          @page {
            size: A4 portrait;
            margin: 10mm;
          }
        }
      `}</style>
    </div>
  );
};

export default Reports;
