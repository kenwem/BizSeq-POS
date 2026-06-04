import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { db as dexie } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { 
  TrendingUp, 
  Package, 
  AlertTriangle, 
  ShoppingCart,
  ShieldCheck,
  ArrowRight,
  Zap,
  Building2,
  Users,
  DollarSign,
  Activity,
  Layers,
  RefreshCw
} from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency, cn, cleanTo6Digits } from '../lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip
} from 'recharts';
import { SafeResponsiveContainer } from '../components/SafeResponsiveContainer';

const Dashboard: React.FC = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (profile) {
    }
  }, [profile]);

  const [loadingByCache, setLoadingByCache] = useState(true);
  const [loadingStoreData, setLoadingStoreData] = useState(true);
  
  // Real database-driven states
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [paymentData, setPaymentData] = useState<any[]>([]);
  const [valuation, setValuation] = useState({ cost: 0, retail: 0 });
  const [stats, setStats] = useState({
    dailySales: 0,
    totalSales: 0,
    inventoryUnits: 0,
    staffCount: 0,
    lowStockItems: [] as any[]
  });

  const isAnalyticalRole = useMemo(() => {
    const role = profile?.role || '';
    return role === 'super_admin' || role === 'store_admin' || role === 'manager';
  }, [profile?.role]);

  // Unified calculations to guarantee exact synchronization
  const calculateStats = React.useCallback((productsListRaw: any[], salesListRaw: any[]) => {
    // Dedup arrays
    const productsList = Array.from(new Map((productsListRaw || []).map(p => [p.id, p])).values());
    const salesList = Array.from(new Map((salesListRaw || []).map(s => [s.id, s])).values());

    setProducts(productsList);
    setSales(salesList);

    let v_cost = 0;
    let v_retail = 0;
    let stockUnits = 0;
    
    productsList.forEach(p => {
      const stock = Number(p.stock) || 0;
      v_cost += (Number(p.cost) || 0) * stock;
      v_retail += (Number(p.price) || 0) * stock;
      stockUnits += stock;
    });
    setValuation({ cost: v_cost, retail: v_retail });

    // Payment breakdown
    const payments: Record<string, number> = { cash: 0, pos: 0, transfer: 0, credit: 0, split: 0 };
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return { 
        name: days[d.getDay()], 
        date: d.toISOString().split('T')[0], 
        val: 0 
      };
    }).reverse();

    salesList.forEach(sale => {
      if (sale.status === 'voided') return;
      let dateStr = '';
      
      if (sale.createdAt?.toDate) {
        dateStr = sale.createdAt.toDate().toISOString().split('T')[0];
      } else if (typeof sale.createdAt === 'string') {
        dateStr = sale.createdAt.split('T')[0];
      } else if (sale.createdAt?.seconds) {
        dateStr = new Date(sale.createdAt.seconds * 1000).toISOString().split('T')[0];
      } else if (sale.createdAt instanceof Date) {
        dateStr = sale.createdAt.toISOString().split('T')[0];
      }
      
      const dayMatch = last7Days.find(d => d.date === dateStr);
      if (dayMatch) {
        dayMatch.val += (Number(sale.total) || 0);
      }
      
      const method = (sale.paymentMethod || '').toLowerCase();
      if (method && payments.hasOwnProperty(method)) {
        payments[method] += (Number(sale.total) || 0);
      }
    });

    setChartData(last7Days);
    setPaymentData(Object.entries(payments).map(([name, value]) => ({ name: name.toUpperCase(), value })));
    
    const lowStockItems = productsList
      .filter(p => {
        const stock = Number(p.stock) || 0;
        const threshold = Number(p.lowStockThreshold) || 5;
        return stock <= threshold;
      })
      .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0));

    setStats({
      dailySales: last7Days.length > 0 ? (last7Days[last7Days.length - 1]?.val || 0) : 0, 
      totalSales: salesList.length,
      inventoryUnits: stockUnits,
      staffCount: 0, 
      lowStockItems: lowStockItems
    });
  }, []);

  // Set up 100% real-time Firestore synchronization & Dexie background backup
  useEffect(() => {
    if (authLoading || !profile?.storeId) {
      setLoadingByCache(false);
      setLoadingStoreData(false);
      return;
    }

    const storeId = profile.storeId;

    // Phase 1: Read Dexie cache immediately for instantaneous rendering
    const loadCache = async () => {
      try {
        const cachedProducts = await dexie.products.where('storeId').equals(storeId).toArray();
        const cachedSales = await dexie.sales.where('storeId').equals(storeId).toArray();
        if (cachedProducts.length > 0 || cachedSales.length > 0) {
          calculateStats(cachedProducts, cachedSales);
          setLoadingByCache(false);
        }
      } catch (err) {
        console.error("Dashboard cached load failed:", err);
      }
    };
    loadCache();

    // Phase 2: Open active real-time listeners on firestore
    const productsQuery = query(collection(db, 'products'), where('storeId', '==', storeId));
    const unsubscribeProducts = onSnapshot(productsQuery, async (snapshot) => {
      const liveProducts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Cache backup
      try {
        await dexie.products.where('storeId').equals(storeId).delete();
        await dexie.products.bulkPut(liveProducts.map(p => ({ ...p, synced: true }) as any));
      } catch (err) {
        console.warn("Background products local backup failed", err);
      }

      // Fetch sales from cache/state to update calculations
      try {
        const currentSales = await dexie.sales.where('storeId').equals(storeId).toArray();
        calculateStats(liveProducts, currentSales);
      } catch (err) {
        calculateStats(liveProducts, []);
      }
      setLoadingByCache(false);
      setLoadingStoreData(false);
    }, (err) => {
      console.warn("Firestore products stream offline", err);
      setLoadingStoreData(false);
    });

    const salesQuery = query(collection(db, 'sales'), where('storeId', '==', storeId));
    const unsubscribeSales = onSnapshot(salesQuery, async (snapshot) => {
      const liveSales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Cache backup
      try {
        await dexie.sales.where('storeId').equals(storeId).delete();
        await dexie.sales.bulkPut(liveSales.map(s => ({ ...s, synced: true }) as any));
      } catch (err) {
        console.warn("Background sales local backup failed", err);
      }

      // Fetch products from cache/state to update calculations
      try {
        const currentProducts = await dexie.products.where('storeId').equals(storeId).toArray();
        calculateStats(currentProducts, liveSales);
      } catch (err) {
        calculateStats([], liveSales);
      }
      setLoadingByCache(false);
      setLoadingStoreData(false);
    }, (err) => {
      console.warn("Firestore sales stream offline", err);
      setLoadingStoreData(false);
    });

    return () => {
      unsubscribeProducts();
      unsubscribeSales();
    };
  }, [profile?.storeId, authLoading, calculateStats]);

  if (authLoading || (loadingByCache && products.length === 0)) {
    return (
      <div className="max-w-7xl mx-auto py-12 px-4 space-y-6">
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-6 w-32 bg-slate-200 rounded" />
          <div className="h-4 w-48 bg-slate-100 rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-slate-50 border border-slate-200 rounded p-4 animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-slate-50 border border-slate-200 rounded animate-pulse" />
      </div>
    );
  }

  if (!profile?.storeId && profile?.role !== 'super_admin') {
    return (
      <div className="max-w-7xl mx-auto py-24 px-4 text-center">
        <p className="inline-flex p-3 bg-rose-50 border border-rose-200 text-rose-700 font-bold rounded text-sm mb-4">
          <AlertTriangle className="h-4 w-4 mr-2 text-rose-600" />
          Store configuration required
        </p>
        <h2 className="text-xl font-bold text-slate-950 uppercase tracking-tight">Access Restricted</h2>
        <p className="text-slate-700 text-sm mt-2 font-medium max-w-md mx-auto">
          Your profile is not assigned to any active store. Please contact your system administrator to configure permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5 pb-16 px-4 font-sans text-slate-900 select-none">
      
      {/* 1. COMPACT ERP TOPBAR HEADER */}
      <header className="bg-white border border-slate-200 p-4 rounded flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1 bg-slate-950 text-white rounded shrink-0">
              <Layers className="h-3.5 w-3.5" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Enterprise Control
            </span>
            <span className="font-mono text-[9px] bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-bold border border-emerald-100 uppercase tracking-wider">
              {profile?.role === 'super_admin' ? 'Superuser' : (profile?.role === 'store_admin' ? 'Store Manager' : 'Operator')}
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-950 uppercase leading-tight">
            {profile?.store?.name || profile?.storeName || 'Store'}
          </h1>
          <p className="text-xs text-slate-700 font-medium">
            Session user: <span className="font-bold text-slate-950">{profile?.username || profile?.email || 'kenny'}</span>
          </p>
        </div>

        {/* Dense Inline System Info Row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] bg-slate-50 border border-slate-200 p-3 rounded font-mono">
          <div className="flex items-center gap-1.5 border-r border-slate-200 pr-4">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-500 uppercase text-[9px] font-bold">Network:</span>
            <span className="text-slate-950 font-bold">Online / Live Stream</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase text-[9px] font-bold">Products:</span>
            <span className="text-slate-950 font-bold">{products.length} SKU</span>
          </div>
        </div>
      </header>

      {/* 2. SUPER ADMIN QUICK LINK BANNER (CONCISE, NO DECORATION) */}
      {profile?.role === 'super_admin' && (
        <div className="bg-slate-950 text-white p-4 rounded flex items-center justify-between border border-slate-900 shadow-sm">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">Super Administrator Master Control</p>
              <p className="text-xs text-slate-300 font-medium mt-0.5">Configure, authorize and administer global retail stores and system user credentials.</p>
            </div>
          </div>
          <Link 
            to="/super-admin"
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider px-4 py-2 rounded shrink-0 flex items-center gap-1 transition-colors"
          >
            <span>Admin Hub</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* 3. CORE STATISTICAL ROW (DENSE ERP DESIGN, ZERO HERO ACCENTS) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { 
            name: "Daily Sales Revenue", 
            value: formatCurrency(stats.dailySales), 
            description: "Gross revenue captured (last 24 hours)", 
            icon: TrendingUp, 
            textColor: "text-emerald-700",
            borderColor: "border-l-[4px] border-l-emerald-600",
            path: "/sales" 
          },
          { 
            name: "Stock Value (Retail)", 
            value: formatCurrency(valuation.retail), 
            description: "Inventory valuation based on product sell prices", 
            icon: Package, 
            textColor: "text-blue-700",
            borderColor: "border-l-[4px] border-l-blue-600",
            path: "/inventory" 
          },
          { 
            name: "Stock Value (Cost)", 
            value: formatCurrency(valuation.cost), 
            description: "Inventory valuation calculated from acquisition cost", 
            icon: Zap, 
            textColor: "text-orange-700",
            borderColor: "border-l-[4px] border-l-orange-600",
            path: "/inventory" 
          },
          { 
            name: "Expected Net Margin", 
            value: formatCurrency(valuation.retail - valuation.cost), 
            description: "Potential profits hidden inside current storage", 
            icon: ShoppingCart, 
            textColor: "text-purple-700",
            borderColor: "border-l-[4px] border-l-purple-600",
            path: "/inventory" 
          }
        ].filter(card => isAnalyticalRole || card.path === "/sales").map((stat) => (
          <div 
            key={stat.name}
            onClick={() => navigate(stat.path)}
            className={cn(
              "bg-white border border-slate-200 rounded p-3 cursor-pointer hover:border-slate-400 hover:shadow-sm transition-all flex items-center justify-between gap-3",
              stat.borderColor
            )}
          >
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">
                {stat.name}
              </span>
              <p className={cn("text-xl font-bold font-mono tracking-tight", stat.textColor)}>
                {stat.value}
              </p>
              <span className="text-[9px] text-slate-500 font-bold block leading-normal">
                {stat.description}
              </span>
            </div>
            <div className="p-2 bg-slate-50 border border-slate-200 rounded text-slate-600 shrink-0">
              <stat.icon className="h-4 w-4" />
            </div>
          </div>
        ))}
      </div>

      {/* 4. MAIN ANALYTICAL DATA GRID (TABLES & CHARTS ONLY) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        
        {/* Left Aspect: Diagnostic tables */}
        <div className="lg:col-span-2 space-y-3">
          
          {/* Section A: Low Stock Monitoring Table (Prefers tables over cards for display) */}
          <section className="bg-white border border-slate-200 rounded p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Critical Inventory & Low-Stock Alerts
                </h3>
              </div>
              <span className="font-mono text-[9px] bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 rounded font-bold uppercase">
                {stats.lowStockItems.length} Alerts
              </span>
            </div>

            <div className="overflow-x-auto max-h-[280px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse font-medium">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="p-2 pl-3">Product Name</th>
                    <th className="p-2">Barcode / SKU</th>
                    <th className="p-2 text-center">Threshold</th>
                    <th className="p-2 text-right pr-3">Current Stock</th>
                    <th className="p-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-900">
                  {stats.lowStockItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-400 font-bold italic">
                        All product stock levels are healthy and within optimal parameters.
                      </td>
                    </tr>
                  ) : (
                    stats.lowStockItems.slice(0, 8).map((p, idx) => {
                      const isCriticalOut = (Number(p.stock) || 0) <= 0;
                      return (
                        <tr key={`dash-lowstock-${p.id || 'unkn'}-${idx}`} className="hover:bg-slate-50 transition-colors">
                          <td className="p-2 pl-3 font-bold text-slate-950 uppercase">{p.name}</td>
                          <td className="p-2 font-mono text-[10px] text-slate-500">{cleanTo6Digits(p.sku || p.barcode) || 'N/A'}</td>
                          <td className="p-2 text-center font-mono">{p.lowStockThreshold || 5}</td>
                          <td className={cn("p-2 text-right pr-3 font-mono font-bold", isCriticalOut ? "text-rose-600" : "text-amber-600")}>
                            {p.stock} units
                          </td>
                          <td className="p-2 text-center">
                            <span className={cn(
                              "inline-block text-[9px] font-bold px-2 py-0.5 rounded uppercase font-mono tracking-wider border",
                              isCriticalOut 
                                ? "bg-rose-50 text-rose-800 border-rose-100" 
                                : "bg-amber-50 text-amber-800 border-amber-100"
                            )}>
                              {isCriticalOut ? 'OUT OF STOCK' : 'LOW LEVEL'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
              <Link 
                to="/inventory" 
                className="text-[10px] font-bold uppercase tracking-wider text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded transition-all"
              >
                Go to Stock Management Panel →
              </Link>
            </div>
          </section>

          {/* Section B: Sales Velocity Revenue Trends (7-day area metric) */}
          {isAnalyticalRole && (
            <section className="bg-white border border-slate-200 rounded p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-emerald-600 shrink-0" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    7-Day Gross Sales Velocity Trend
                  </h3>
                </div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  Currency: NGN (₦)
                </span>
              </div>
              
              <div className="w-full h-[180px]">
                <SafeResponsiveContainer height={180}>
                   <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ecf0f1" />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tickFormatter={(val) => `₦${(val/1000).toFixed(0)}k`}
                        tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#0f172a', 
                          border: 'none', 
                          borderRadius: '4px',
                          padding: '10px',
                        }}
                        itemStyle={{ color: '#10b981', fontWeight: 900, fontSize: '12px' }}
                        labelStyle={{ color: '#94a3b8', fontWeight: 800, fontSize: '10px', textTransform: 'uppercase' }}
                        formatter={(val: any) => [`${formatCurrency(val)}`, 'Revenue']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="val" 
                        stroke="#059669" 
                        strokeWidth={3}
                        fillOpacity={0.05} 
                        fill="#10b981" 
                      />
                   </AreaChart>
                </SafeResponsiveContainer>
              </div>
            </section>
          )}
        </div>

        {/* Right Aspect: Payment details and operations list */}
        <div className="space-y-3">
          
          {/* Section C: Financial Income by Category (Table preferred over large graphs) */}
          <section className="bg-white border border-slate-200 rounded p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Payment Channels Allocation
                </h3>
              </div>
              <span className="font-mono text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded font-bold uppercase">
                Active
              </span>
            </div>

            <div className="space-y-2">
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs font-medium">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-2 pl-3">Channel</th>
                      <th className="p-2 text-right pr-3">Total Volume Recd</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-900">
                    {paymentData.map((channel, i) => (
                      <tr key={channel.name} className="hover:bg-slate-50">
                        <td className="p-2 pl-3 font-bold uppercase flex items-center gap-2">
                          <span className={cn(
                            "w-2.5 h-2.5 rounded-full inline-block",
                            i === 0 ? "bg-emerald-500" : (i === 1 ? "bg-blue-500" : (i === 2 ? "bg-amber-500" : "bg-purple-500"))
                          )} />
                          {channel.name}
                        </td>
                        <td className="p-2 text-right pr-3 font-mono font-bold text-slate-950">
                          {formatCurrency(channel.value)}
                        </td>
                      </tr>
                    ))}
                    {paymentData.length === 0 && (
                      <tr>
                        <td colSpan={2} className="p-4 text-center text-slate-400 italic font-bold">
                          No payments registered in current cycle.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-3 rounded text-[11px] leading-relaxed font-medium">
                <span className="font-black text-slate-950 uppercase block mb-1">Operational Audit Tip</span>
                Ensure that all local cashier POS systems have reconciled their physical cash drawers with Bank Transfers and POS debit invoices before starting the night-shift balance count.
              </div>
            </div>
          </section>

          {/* Section D: Store Operation Hub (Clean & compact list of quick actions) */}
          <section className="bg-white border border-slate-200 rounded p-4 shadow-sm space-y-3">
             <div className="border-b border-slate-100 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Quick Access Task Panels
                </h3>
             </div>
             <div className="grid grid-cols-2 gap-2">
               <Link 
                 to="/pos" 
                 className="p-3 bg-slate-950 text-white rounded font-bold text-xs uppercase tracking-wider hover:bg-black text-center border border-slate-900 flex flex-col items-center justify-center gap-1 transition-all"
               >
                 <ShoppingCart className="h-4 w-4 text-emerald-400" />
                 <span>Open POS Checkout</span>
               </Link>
               <Link 
                 to="/inventory" 
                 className="p-3 bg-white text-slate-900 rounded font-bold text-xs uppercase tracking-wider hover:bg-slate-50 text-center border border-slate-200 flex flex-col items-center justify-center gap-1 transition-all"
               >
                 <Package className="h-4 w-4 text-blue-500" />
                 <span>Managed Items</span>
               </Link>
               <Link 
                 to="/reports" 
                 className="p-3 bg-white text-slate-900 rounded font-bold text-xs uppercase tracking-wider hover:bg-slate-50 text-center border border-slate-200 flex flex-col items-center justify-center gap-1 transition-all"
               >
                 <Activity className="h-4 w-4 text-purple-500" />
                 <span>Generate Reports</span>
               </Link>
               {profile?.role === 'store_admin' && (
                 <Link 
                   to="/staff" 
                   className="p-3 bg-white text-slate-900 rounded font-bold text-xs uppercase tracking-wider hover:bg-slate-50 text-center border border-slate-200 flex flex-col items-center justify-center gap-1 transition-all"
                 >
                   <Users className="h-4 w-4 text-cyan-500" />
                   <span>Store Operators</span>
                 </Link>
               )}
             </div>
          </section>

        </div>
      </div>

    </div>
  );
};

export default Dashboard;
