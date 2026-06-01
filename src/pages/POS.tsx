import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  serverTimestamp, 
  runTransaction, 
  doc 
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { Product, SaleItem, PaymentMethod, Sale, SplitPayment, InventoryLocation } from '../types';
import { useInventoryLocations } from '../hooks/useInventoryLocations';
import { useInventoryStock } from '../hooks/useInventoryStock';
import { useProducts } from '../hooks/useProducts';
import { db as dexie } from '../services/db';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { 
  Search, 
  Minus, 
  Plus, 
  Trash2, 
  Barcode, 
  Camera, 
  ArrowLeft, 
  CreditCard, 
  Banknote, 
  Smartphone,
  ChevronRight,
  Package,
  ShoppingCart,
  Zap,
  Target,
  Printer,
  List as ListIcon,
  X,
  Keyboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { createPortal } from 'react-dom';
import { PrintableReceipt } from '../components/common/PrintableReceipt';
import { printElementViaIframe } from '../lib/printHelper';

const POS: React.FC = () => {
  const { profile, loading: authLoading, reconnecting } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (profile) {
      console.log("POS STORE NAME:", profile.storeName || profile.store?.name || 'Store');
    }
  }, [profile]);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const { products: hookProducts, isLoading: productsLoading } = useProducts(profile?.storeId);
  const products = React.useMemo(() => {
    const list = hookProducts || [];
    return Array.from(new Map(list.map(p => [p.id, p])).values());
  }, [hookProducts]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'split'>('cash');
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const [splitCash, setSplitCash] = useState<string>('');
  const [splitPOS, setSplitPOS] = useState<string>('');
  const [splitTransfer, setSplitTransfer] = useState<string>('');

  React.useEffect(() => {
    if (paymentMethod === 'split') {
      const payments: SplitPayment[] = [];
      const cashVal = parseFloat(splitCash) || 0;
      const posVal = parseFloat(splitPOS) || 0;
      const transferVal = parseFloat(splitTransfer) || 0;

      if (cashVal > 0) payments.push({ method: 'cash', amount: cashVal });
      if (posVal > 0) payments.push({ method: 'pos', amount: posVal });
      if (transferVal > 0) payments.push({ method: 'transfer', amount: transferVal });

      setSplitPayments(payments);
    } else {
      setSplitPayments([]);
    }
  }, [splitCash, splitPOS, splitTransfer, paymentMethod]);

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [selectedProductForUnit, setSelectedProductForUnit] = useState<Product | null>(null);
  const [lastSale, setLastSale] = useState<any>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReader = useMemo(() => new BrowserMultiFormatReader(), []);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  
  const showToast = React.useCallback((message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev?.message === message ? null : prev);
    }, 4500);
  }, []);

  // Printer configuration state: '80mm' | '58mm' | 'standard'
  const [printFormat, setPrintFormat] = useState<'80mm' | '58mm' | 'standard'>(() => {
    return (localStorage.getItem('pos_selected_printer_format') as any) || '80mm';
  });

  const printReceiptRef = useRef<HTMLDivElement>(null);

  // New State for requirement matching image
  const [currentTime, setCurrentTime] = useState(new Date());
  const [qtyInput, setQtyInput] = useState('1');
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('ALL ITEMS');
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem("pos_custom_categories");
    return saved ? JSON.parse(saved) : ["BEVERAGES", "SNACKS", "GROCERY", "DAIRY", "FROZEN", "HOUSEHOLD", "PERSONAL CARE", "OTHERS"];
  });

  useEffect(() => {
    const fetchStoreCategories = async () => {
      if (!profile?.storeId) return;
      try {
        const { getDoc, doc } = await import("firebase/firestore");
        const { db } = await import("../services/firebase");
        const storeSnap = await getDoc(doc(db, "stores", profile.storeId));
        if (storeSnap.exists()) {
          const storeData = storeSnap.data();
          if (storeData.customCategories && Array.isArray(storeData.customCategories)) {
            setCategories(storeData.customCategories);
            localStorage.setItem("pos_custom_categories", JSON.stringify(storeData.customCategories));
          }
        }
      } catch (err) {
        console.warn("Failed dynamically reloading categories online, using local memory:", err);
      }
    };
    fetchStoreCategories();
  }, [profile?.storeId]);

  const { locations: hookLocations } = useInventoryLocations(profile?.storeId);
  const locations = React.useMemo(() => {
    const list = hookLocations || [];
    return Array.from(new Map(list.map(l => [l.id, l])).values());
  }, [hookLocations]);
  const { stock: allStock } = useInventoryStock(profile?.storeId);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const addToCart = React.useCallback((product: Product, unit?: any, locationId?: string) => {
    const salePrice = unit ? unit.price : product.price;
    const saleCost = unit ? unit.cost : product.cost;
    const unitName = unit ? unit.name : 'Piece';
    const conversionRate = unit ? unit.conversionRate : 1;
    
    // Use the qtyInput buffer if it's set
    const qty = parseInt(qtyInput) || 1;
    const finalLocationId = locationId || product.defaultLocationId || (locations[0]?.id || '');

    setCart(prev => {
      const cartKey = `${product.id}-${unitName}-${finalLocationId}`;
      const existingIdx = prev.findIndex(item => `${item.productId}-${item.unitName || 'Piece'}-${item.inventoryLocationId}` === cartKey);
      
      if (existingIdx >= 0) {
        const newCart = [...prev];
        const item = newCart[existingIdx];
        newCart[existingIdx] = { 
          ...item, 
          quantity: item.quantity + qty, 
          total: (item.quantity + qty) * item.price 
        };
        setSelectedItemIndex(existingIdx);
        return newCart;
      }
      const newItem = {
        productId: product.id,
        name: product.name,
        unitName,
        quantity: qty,
        price: salePrice,
        cost: saleCost || 0,
        total: salePrice * qty,
        conversionRate, 
        inventoryLocationId: finalLocationId
      } as any;
      const newCart = [...prev, newItem];
      setSelectedItemIndex(newCart.length - 1);
      return newCart;
    });
    setSearch('');
    setIsUnitModalOpen(false);
    setSelectedProductForUnit(null);
    // Reset buffer after adding
    setQtyInput('1');
  }, [qtyInput, locations]);

  const handleProductClick = (product: Product) => {
    const explicitUnits = product.units || [];
    
    // Check if there is an automated package unit
    let hasAutoPkg = false;
    if (product.packageType) {
      const pkgName = product.packageType;
      const pkgCapacity = product.packageCapacity || product.productsPerCarton || 0;
      const alreadyExists = explicitUnits.some(u => u.name.toLowerCase() === pkgName.toLowerCase());
      if (!alreadyExists && pkgCapacity > 1) {
        hasAutoPkg = true;
      }
    }
    
    const totalOptions = 1 + explicitUnits.length + (hasAutoPkg ? 1 : 0);
    
    if (totalOptions > 1) {
      setSelectedProductForUnit(product);
      setIsUnitModalOpen(true);
    } else {
      addToCart(product);
    }
  };

  useEffect(() => {
    let controls: any;
    if (isScanning && videoRef.current) {
      codeReader.decodeFromVideoDevice(undefined, videoRef.current, (result, error) => {
        if (result) {
          const barcode = result.getText();
          const product = products.find(p => p.barcode === barcode);
          if (product) {
            addToCart(product);
            setIsScanning(false);
          }
        }
      }).then(ctrl => controls = ctrl);
    }
    return () => controls?.stop();
  }, [isScanning, products, addToCart, codeReader]);
  const subtotal = cart.reduce((acc, item) => acc + item.total, 0);
  const taxAmount = subtotal * ((profile?.taxRate || 0) / 100);
  const serviceFee = profile?.serviceFee || 0;
  const totalCost = cart.reduce((acc, item) => acc + (item.cost * item.quantity), 0);
  const discount = 0; 
  const total = subtotal + taxAmount + serviceFee - discount;
  const totalProfit = total - totalCost;

  // Search logic is handled reactively via the useProducts hook above.
  const loadingProducts = authLoading || productsLoading;

  // O(1) Local Stock Lookup Map
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!allStock) return map;
    for (const item of allStock) {
      if (item.productId && item.inventoryLocationId) {
        map.set(`${item.productId}_${item.inventoryLocationId}`, item.quantity || 0);
      }
    }
    return map;
  }, [allStock]);

  const filteredProducts = useMemo(() => {
    const list = selectedCategory === 'ALL ITEMS' 
      ? products 
      : products.filter(p => p.category === selectedCategory);
      
    if (!search) return list;
    
    return list.filter(p => 
      p.name.toLowerCase().includes(search.toLowerCase()) || 
      (p.barcode && p.barcode.toLowerCase().includes(search.toLowerCase())) ||
      (p.sku && p.sku.toLowerCase().includes(search.toLowerCase()))
    );
  }, [products, search, selectedCategory]);

  const paginatedPOSProducts = useMemo(() => {
    // Limits DOM rendering to first 60 items so rendering is instant and completely fluid!
    return filteredProducts.slice(0, 60);
  }, [filteredProducts]);

  const updateQuantity = React.useCallback((productId: string, delta: number, unitName?: string, locationId?: string) => {
    setCart(prev => prev.map(item => {
      const match = item.productId === productId && 
                   (unitName ? item.unitName === unitName : true) && 
                   (locationId ? item.inventoryLocationId === locationId : true);
      if (match) {
        const newQty = Math.max(1, (delta < 0 ? item.quantity + delta : delta)); // Handle direct set or delta
        return { ...item, quantity: newQty, total: newQty * item.price };
      }
      return item;
    }));
  }, []);

  const updatePrice = React.useCallback((productId: string, newPrice: number, unitName?: string, locationId?: string) => {
    setCart(prev => prev.map(item => {
      const match = item.productId === productId && 
                   (unitName ? item.unitName === unitName : true) && 
                   (locationId ? item.inventoryLocationId === locationId : true);
      if (match) {
        return { ...item, price: newPrice, total: item.quantity * newPrice };
      }
      return item;
    }));
  }, []);

  const removeFromCart = React.useCallback((productId: string, unitName?: string, locationId?: string) => {
    setCart(prev => prev.filter(item => {
      const match = item.productId === productId && 
                   (unitName ? item.unitName === unitName : true) && 
                   (locationId ? item.inventoryLocationId === locationId : true);
      return !match;
    }));
    setSelectedItemIndex(null);
  }, []);

  const handleCheckout = React.useCallback(async () => {
    if (!profile?.storeId || cart.length === 0) return;

    if (paymentMethod === 'split') {
      const allocated = (parseFloat(splitCash) || 0) + (parseFloat(splitPOS) || 0) + (parseFloat(splitTransfer) || 0);
      if (Math.abs(allocated - total) > 0.01) {
        showToast(`Split payments total (${allocated}) must exactly equal total payable (${total})`, "error");
        return;
      }
    }
    
    setLoading(true);
    const isOnline = navigator.onLine;
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const saleData: Sale = {
      id: saleId,
      storeId: profile.storeId,
      items: cart,
      total: total,
      subtotal: subtotal,
      totalCost: totalCost,
      totalProfit: totalProfit,
      discount: discount,
      paymentMethod: paymentMethod,
      status: 'completed',
      createdAt: new Date() as any,
      cashierId: profile.uid || 'unknown',
      cashierName: profile.username || 'Unknown Cashier',
      ...(paymentMethod === 'split' ? { splitPayments } : {})
    };

    try {
      if (isOnline) {
        await runTransaction(db, async (transaction) => {
          const saleRef = doc(collection(db, 'sales'));
          const finalSaleData: any = {
            ...saleData,
            id: saleRef.id,
            createdAt: serverTimestamp()
          };
          if (finalSaleData.splitPayments === undefined) {
            delete finalSaleData.splitPayments;
          }
          
          for (const item of cart as any[]) {
            const productRef = doc(db, 'products', item.productId);
            const stockId = `${item.productId}_${item.inventoryLocationId}`;
            const stockRef = doc(db, 'inventory_location_stock', stockId);
            
            const [productSnap, stockSnap] = await Promise.all([
              transaction.get(productRef),
              transaction.get(stockRef)
            ]);
            
            if (!productSnap.exists()) {
              throw new Error(`Product ${item.name} not found.`);
            }
            
            const currentProductData = productSnap.data();
            const currentTotalStock = currentProductData.stock || 0;
            // Robust check: if the specific stock location record does not exist yet, fallback to parent total stock
            const currentSectionStock = stockSnap.exists() 
              ? (stockSnap.data().quantity ?? 0) 
              : currentTotalStock;
            
            const totalUnitsToDeduct = item.quantity * (item.conversionRate || 1);
            
            const bypassStockCheck = localStorage.getItem("store_allow_negative_stock") === "true";
            if (!bypassStockCheck && currentSectionStock < totalUnitsToDeduct) {
               const locName = locations.find(l => l.id === item.inventoryLocationId)?.name || 'selected location';
               throw new Error(`Insufficient stock for ${item.name} in ${locName}. Available: ${currentSectionStock}`);
            }
            
            // Update total product stock
            transaction.update(productRef, {
              stock: bypassStockCheck ? (currentTotalStock - totalUnitsToDeduct) : Math.max(0, currentTotalStock - totalUnitsToDeduct),
              updatedAt: serverTimestamp()
            });

            // Update location specific stock
            if (stockSnap.exists()) {
              transaction.update(stockRef, {
                quantity: bypassStockCheck ? (currentSectionStock - totalUnitsToDeduct) : Math.max(0, currentSectionStock - totalUnitsToDeduct),
                updatedAt: serverTimestamp()
              });
            } else {
              transaction.set(stockRef, {
                productId: item.productId,
                inventoryLocationId: item.inventoryLocationId,
                quantity: bypassStockCheck ? (currentSectionStock - totalUnitsToDeduct) : Math.max(0, currentSectionStock - totalUnitsToDeduct),
                synced: true,
                storeId: profile.storeId,
                updatedAt: serverTimestamp()
              });
            }
          }
          
          transaction.set(saleRef, finalSaleData);
          setLastSale({ ...finalSaleData, createdAt: new Date() });
          await dexie.sales.put({ 
            ...finalSaleData, 
            createdAt: new Date(), // Real Date for immediate local rendering & proper caching (avoiding serverTimestamp null-evaluation in sorting)
            synced: true 
          } as any);
        });
        showToast("Sale completed successfully!", "success");
      } else {
        // Offline: record locally first, deduct offline stocks in Dexie, queue for sync
        const offlineSale = {
          ...saleData,
          createdAt: new Date()
        };
        await dexie.sales.put({ ...offlineSale, synced: false } as any);
        await dexie.syncQueue.put({
          action: 'create',
          collection: 'sales',
          data: offlineSale,
          timestamp: Date.now()
        });
        
        const localAllowNegative = localStorage.getItem("store_allow_negative_stock") === "true";
        for (const item of cart as any[]) {
          const localProd = await dexie.products.get(item.productId);
          if (localProd) {
            const totalDeduct = item.quantity * (item.conversionRate || 1);
            await dexie.products.update(item.productId, {
              stock: localAllowNegative ? ((localProd.stock || 0) - totalDeduct) : Math.max(0, (localProd.stock || 0) - totalDeduct)
            });
          }
          
          const localStockId = `${item.productId}_${item.inventoryLocationId}`;
          const localStock = await dexie.inventoryLocationStock.get(localStockId);
          if (localStock) {
            const totalDeduct = item.quantity * (item.conversionRate || 1);
            await dexie.inventoryLocationStock.update(localStockId, {
              quantity: localAllowNegative ? ((localStock.quantity || 0) - totalDeduct) : Math.max(0, (localStock.quantity || 0) - totalDeduct)
            });
          } else {
            // Instantiate local stock
            const totalDeduct = item.quantity * (item.conversionRate || 1);
            const parentProd = await dexie.products.get(item.productId);
            const initialQty = parentProd?.stock || 0;
            await dexie.inventoryLocationStock.put({
              id: localStockId,
              productId: item.productId,
              inventoryLocationId: item.inventoryLocationId,
              quantity: localAllowNegative ? (initialQty - totalDeduct) : Math.max(0, initialQty - totalDeduct),
              synced: false
            } as any);
          }
        }
        
        setLastSale(offlineSale);
        showToast("Checkout completed locally (Offline Mode). Sale will sync when internet is restored.", "warning");
      }
      
      setCart([]);
      setSelectedItemIndex(null);
      setIsCheckoutOpen(false);
      setIsReceiptOpen(true);
    } catch (err: any) {
      console.error(err);
      showToast(`Checkout failed: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [profile, cart, total, subtotal, totalCost, totalProfit, discount, paymentMethod, splitPayments, locations, showToast, splitCash, splitPOS, splitTransfer]);

  const handlePrintReceipt = React.useCallback(() => {
    const printEl = document.getElementById('printable-receipt-container');
    console.log("PRINT CLICKED");
    console.log("PRINT ELEMENT ID:", printEl?.id);
    console.log("PRINT ELEMENT EXISTS:", !!printEl);
    console.log("PRINT ELEMENT OUTER HTML:", printEl?.outerHTML?.slice(0, 500));
    if (!lastSale) return;
    try {
      printElementViaIframe('printable-receipt-container', printFormat);
    } catch (err: any) {
      console.error("POS Printing Trigger Error:", err);
      showToast("Redirecting to standard print device launcher dialog...", "warning");
      try {
        window.print();
      } catch (printErr: any) {
        showToast("Print blocked. Click 'New Tab' icon at top right to run POS outside the iframe!", "error");
      }
    }
  }, [lastSale, printFormat, showToast]);

  return (
    <div className="flex flex-col h-screen bg-[#F0F4F8] font-sans overflow-hidden">
      {/* Top Banner */}
      <div className="bg-[#00529B] text-white p-2 flex items-center justify-between text-xs font-bold shrink-0">
        <div className="flex items-center gap-6">
          <span className="text-sm uppercase tracking-wider">{profile?.store?.name || profile?.storeName || 'Store'} POS SYSTEM</span>
          <div className="flex items-center gap-2">
            <span className="opacity-70 font-normal">Cashier:</span>
            <span>{profile?.username || 'Admin'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="opacity-70 font-normal">Terminal:</span>
            <span>01</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="opacity-70 font-normal">Date:</span>
            <span>{currentTime.toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="opacity-70 font-normal">Time:</span>
            <span>{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="opacity-70 font-normal">Invoice:</span>
            <span>INV{String(lastSale?.id || '00012345').substring(0, 8).toUpperCase()}</span>
          </div>
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded border border-white/20 transition-all text-[10px] uppercase font-bold"
          >
            <Target className="h-3 w-3" /> Dashboard
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row gap-2 p-2 overflow-y-auto lg:overflow-hidden min-h-0">
        {/* Left Section: Table, Categories, products */}
        <div className="flex-1 flex flex-col gap-2 min-h-[450px] lg:min-h-0 overflow-visible lg:overflow-hidden">
          {/* Cart Table Container */}
          <div className="flex-1 flex flex-col bg-white border border-slate-300 rounded overflow-hidden shadow-sm min-h-0">
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#3B82F6] text-white text-[11px] uppercase tracking-wider z-10">
                  <tr>
                    <th className="px-3 py-2 border-r border-[#2563EB] w-12 text-center">No.</th>
                    <th className="px-3 py-2 border-r border-[#2563EB] w-32">Barcode</th>
                    <th className="px-3 py-2 border-r border-[#2563EB]">Item Description</th>
                    <th className="px-3 py-2 border-r border-[#2563EB] w-32 text-center">Location</th>
                    <th className="px-3 py-2 border-r border-[#2563EB] w-20 text-center">Qty</th>
                    <th className="px-3 py-2 border-r border-[#2563EB] w-28 text-right">Unit Price</th>
                    <th className="px-3 py-2 w-32 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="text-xs font-medium text-slate-700">
                  {cart.map((item: any, idx) => (
                    <tr 
                      key={`${item.productId}-${item.unitName || 'PC'}-${item.inventoryLocationId}-${idx}`}
                      onClick={() => setSelectedItemIndex(idx)}
                      className={cn(
                        "border-b border-slate-100 cursor-pointer",
                        selectedItemIndex === idx ? "bg-blue-50" : "hover:bg-slate-50"
                      )}
                    >
                      <td className="px-3 py-2 text-center border-r border-slate-100">{idx + 1}</td>
                      <td className="px-3 py-2 border-r border-slate-100 font-mono text-[10px]">
                        {products.find(p => p.id === item.productId)?.barcode || 'N/A'}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-100 font-bold">
                        {item.name} {item.unitName && item.unitName !== 'Piece' && `(${item.unitName})`}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-100 text-center">
                        <select 
                          value={item.inventoryLocationId}
                          onChange={(e) => {
                            const newCart = [...cart];
                            newCart[idx].inventoryLocationId = e.target.value;
                            setCart(newCart);
                          }}
                          className="w-full bg-transparent text-[10px] uppercase font-bold outline-none text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {locations.map((loc, lIdx) => (
                            <option key={`cart-item-loc-opt-${loc.id || 'unkn'}-${lIdx}`} value={loc.id}>{loc.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 border-r border-slate-100 text-center font-bold">{item.quantity}</td>
                      <td className="px-3 py-2 border-r border-slate-100 text-right font-mono">{formatCurrency(item.price)}</td>
                      <td className="px-3 py-2 text-right font-bold text-blue-700 font-mono">{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-20 text-center text-slate-300 italic">No items in cart</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 shrink-0 overflow-x-auto custom-scrollbar">
             {['ALL ITEMS', ...Array.from(new Set(categories))].map((cat, idx) => (
               <button 
                key={`pos-cat-${cat}-${idx}`}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "px-4 py-2 rounded text-[10px] font-black uppercase transition-all whitespace-nowrap min-w-[100px] shadow-sm border",
                  selectedCategory === cat ? "bg-[#00529B] text-white border-blue-900" : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                )}
               >
                 {cat}
               </button>
             ))}
          </div>

          {/* Product Grid Area / Integrated Search Explorer */}
          <div className="flex-[1.5] min-h-0 overflow-hidden flex flex-col bg-slate-200/20 rounded border border-slate-300 shadow-inner">
            {search.length > 0 ? (
              <div className="flex-1 bg-white overflow-hidden flex flex-col">
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-xs text-left border-collapse min-w-[1000px]">
                      <thead className="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-2 border-r w-32">SKU / ID</th>
                          <th className="px-4 py-2 border-r w-40">Barcode</th>
                          <th className="px-4 py-2 border-r">Item Description</th>
                          <th className="px-4 py-2 border-r w-32 text-right">Selling Price</th>
                          <th className="px-4 py-2 border-r w-24 text-center">Stock</th>
                          {locations.map((loc, lIdx) => (
                            <th key={`pos-hdr-loc-${loc.id || 'unkn'}-${lIdx}`} className="px-4 py-2 border-r w-28 text-center bg-blue-50 text-blue-700">{loc.name}</th>
                          ))}
                          <th className="px-4 py-2">Category</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700 font-medium capitalize">
                        {paginatedPOSProducts.map((p, index) => (
                          <tr 
                            key={`pos-list-row-${p.id || 'unkn'}-${index}`} 
                            onClick={() => handleProductClick(p)}
                            className="hover:bg-blue-50 cursor-pointer border-b border-slate-100 active:bg-blue-100 transition-colors"
                          >
                            <td className="px-4 py-1.5 border-r font-mono text-[10px] uppercase">{p.sku || p.id.substring(0,8)}</td>
                            <td className="px-4 py-1.5 border-r font-mono text-[10px]">{p.barcode || '---'}</td>
                            <td className="px-4 py-1.5 border-r font-bold uppercase">{p.name}</td>
                            <td className="px-4 py-1.5 border-r text-right font-bold text-blue-700 font-mono italic">{formatCurrency(p.price)}</td>
                            <td className="px-4 py-1.5 border-r text-center font-bold">{p.stock}</td>
                            {locations.map((loc, lIdx) => {
                              const qty = stockMap.get(`${p.id}_${loc.id}`) || 0;
                              return (
                                <td key={`pos-list-row-stock-${loc.id || 'unkn'}-${lIdx}`} className="px-4 py-1.5 border-r text-center font-bold text-slate-500">
                                  {qty}
                                </td>
                              );
                            })}
                            <td className="px-4 py-1.5 uppercase text-[10px] text-slate-400 font-bold italic">{p.category}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              </div>
            ) : (
              <div className="flex-1 p-2 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-1.5 overflow-y-auto custom-scrollbar">
                  {paginatedPOSProducts.map((product, index) => (
                  <button 
                    key={`pos-grid-item-${product.id || 'unkn'}-${index}`} 
                    onClick={() => handleProductClick(product)}
                    className="aspect-square bg-white border border-slate-300 rounded p-1.5 flex flex-col items-center justify-center text-center gap-1 hover:border-blue-500 transition-all active:scale-95 shadow-sm group"
                  >
                    <span className="text-[10px] font-black uppercase leading-tight line-clamp-2 text-slate-800 group-hover:text-blue-700">{product.name}</span>
                    <span className="text-[10px] font-black text-blue-600 font-mono">{formatCurrency(product.price)}</span>
                  </button>
                ))}
                {products.length === 0 && (
                  <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-400">
                    <Package className="h-10 w-10 mb-4 opacity-20" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No products found for this store</p>
                    <p className="text-[9px] font-bold italic mt-2">Add items in Inventory to see them here.</p>
                  </div>
                )}
                {products.length > 0 && filteredProducts.length === 0 && (
                  <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-400 text-center px-4">
                    <Search className="h-10 w-10 mb-4 opacity-20" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No matches in {selectedCategory}</p>
                    {search && <p className="text-[9px] font-bold italic mt-2 whitespace-normal">Try changing category or clearing search for "{search}"</p>}
                  </div>
                )}
                {filteredProducts.length > paginatedPOSProducts.length && (
                  <div className="col-span-full py-2.5 px-4 text-center bg-slate-50 text-[10px] font-bold text-slate-400 font-sans border-t border-slate-100 uppercase tracking-wider">
                    Showing first {paginatedPOSProducts.length} of {filteredProducts.length} items. Keep typing to narrow down choices.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Section: Keypad & Summary */}
        <div className="w-full lg:w-[380px] flex flex-col gap-2 shrink-0 overflow-visible lg:overflow-hidden min-h-0 pb-12 lg:pb-0">
          {/* Keypad */}
          <div className="bg-white border border-slate-300 rounded p-1.5 grid grid-cols-4 gap-1 shadow-sm">
            {[7, 8, 9, 'QTY', 4, 5, 6, 'PRICE', 1, 2, 3, 'BACKSPACE', 0, '00', '.', 'REMOVE'].map((k) => (
              <button 
                key={k}
                onClick={() => {
                  if (typeof k === 'number' || k === '00' || k === '.') {
                    setQtyInput(prev => prev === '1' ? String(k) : prev + k);
                  } else if (k === 'REMOVE') {
                    if (selectedItemIndex !== null) {
                      const item = cart[selectedItemIndex];
                      removeFromCart(item.productId, item.unitName, item.inventoryLocationId);
                    }
                  } else if (k === 'QTY') {
                    const val = parseFloat(qtyInput);
                    if (!isNaN(val) && selectedItemIndex !== null) {
                      setCart(prev => prev.map((it, idx) => 
                        idx === selectedItemIndex 
                          ? { ...it, quantity: val, total: val * it.price } 
                          : it
                      ));
                    }
                    setQtyInput('1');
                  } else if (k === 'PRICE') {
                    const val = parseFloat(qtyInput);
                    if (!isNaN(val) && selectedItemIndex !== null) {
                      setCart(prev => prev.map((it, idx) => 
                        idx === selectedItemIndex 
                          ? { ...it, price: val, total: it.quantity * val } 
                          : it
                      ));
                    }
                    setQtyInput('1');
                  } else if (k === 'BACKSPACE') {
                    if (qtyInput.length > 0) setQtyInput(qtyInput.slice(0, -1) || '1');
                  }
                }}
                className={cn(
                  "h-12 flex flex-col items-center justify-center rounded transition-all border shadow-sm active:scale-95",
                  k === 'REMOVE' ? "bg-white text-red-600 border-red-100 hover:bg-red-50" : 
                  typeof k === 'string' ? "bg-slate-50 text-blue-900 border-slate-200 hover:bg-slate-200" : 
                  "bg-white text-slate-900 border-slate-200 hover:bg-blue-50"
                )}
              >
                {k === 'BACKSPACE' ? (
                  <>
                    <Keyboard className="h-4 w-4 mb-0.5" />
                    <span className="text-[8px] font-black uppercase">Backspace</span>
                  </>
                ) : k === 'REMOVE' ? (
                  <>
                    <Trash2 className="h-4 w-4 mb-0.5 text-red-500" />
                    <span className="text-[8px] font-black uppercase">Remove</span>
                  </>
                ) : (
                  <span className={cn("font-black", (typeof k === 'string' && k !== '00' && k !== '.') ? "text-[10px]" : "text-2xl")}>{k}</span>
                )}
              </button>
            ))}
          </div>

          {/* Dedicated Summary Card - Matches Mockup Style */}
          <div className="flex-1 bg-white border border-slate-300 rounded overflow-hidden shadow-sm flex flex-col min-h-0">
             <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-black text-blue-900 uppercase tracking-tight">Order Summary</span>
             </div>
             
             <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                <div className="flex justify-between items-center">
                   <span className="text-xs font-bold text-slate-500 uppercase">Items Selected</span>
                   <span className="text-sm font-black text-slate-800">{cart.reduce((acc, i) => acc + i.quantity, 0)}</span>
                </div>
                
                <div className="space-y-3">
                   <div className="flex justify-between items-center text-xs font-bold text-slate-600">
                      <span>Subtotal</span>
                      <span className="font-mono">{formatCurrency(subtotal)}</span>
                   </div>
                   <div className="flex justify-between items-center text-xs font-bold text-slate-600">
                      <span>Discount</span>
                      <span className="font-mono">{formatCurrency(discount)}</span>
                   </div>
                   <div className="flex justify-between items-center text-xs font-bold text-slate-600">
                      <span>Tax (0%)</span>
                      <span className="font-mono">{formatCurrency(taxAmount)}</span>
                   </div>
                </div>

                <div className="h-px bg-slate-200 mt-2" />
                
                <div className="flex justify-between items-center mt-4 bg-gray-50 p-4 border border-gray-100 rounded-xl">
                   <span className="text-sm font-black uppercase text-slate-500 italic tracking-tight">Invoice Total</span>
                   <div className="text-right">
                      <span className="text-4xl font-black text-slate-950 font-mono tracking-tight leading-none block">
                         {formatCurrency(total)}
                      </span>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>


      {/* Bottom Footer Actions & Search bar */}
      <div className="p-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 bg-[#F8FAFC] border-t border-slate-300 shrink-0">
        <button onClick={() => { setCart([]); setSelectedItemIndex(null); }} className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-blue-50 transition-colors">
          <ListIcon className="h-4 w-4 text-slate-500 group-hover:text-blue-600 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">NEW INVOICE</span>
          <span className="text-[8px] opacity-40">F6</span>
        </button>
        <button className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-yellow-50 transition-colors">
          <Minus className="h-4 w-4 text-slate-500 group-hover:text-yellow-600 mb-1" />
          <span className="text-[10px] font-bold text-slate-700 uppercase">Hold Invoice</span>
          <span className="text-[8px] opacity-40">F7</span>
        </button>
        
        {/* Search Bar integrated into footer replacing some actions */}
        <div className="col-span-2 sm:col-span-2 lg:col-span-3 flex items-center bg-white border-2 border-blue-500 rounded px-4 gap-3 shadow-md focus-within:ring-2 focus-within:ring-blue-200 transition-all h-14">
          <Search className="h-5 w-5 text-blue-500 shrink-0" />
          <input 
            id="footer-search-input"
            type="text"
            placeholder="SCAN BARCODE OR ITEM NAME..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="w-full h-full bg-transparent outline-none font-black text-[11px] text-slate-800 placeholder:text-slate-400 placeholder:italic placeholder:font-normal uppercase"
          />
        </div>

        <button onClick={() => { setCart([]); setSelectedItemIndex(null); }} className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-blue-50 transition-colors">
          <ListIcon className="h-4 w-4 text-slate-500 group-hover:text-blue-600 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">VOID INVOICE</span>
          <span className="text-[8px] opacity-40">F9</span>
        </button>
        <button onClick={() => setIsCheckoutOpen(true)} className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-emerald-50 transition-colors">
          <Banknote className="h-4 w-4 text-emerald-500 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">PAYMENT</span>
          <span className="text-[8px] opacity-40">F11</span>
        </button>
        <button onClick={() => navigate('/login')} className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-red-50 transition-colors">
          <X className="h-4 w-4 text-red-500 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">LOGOUT</span>
          <span className="text-[8px] opacity-40">F12</span>
        </button>
      </div>

      {/* Simple Modals */}
      <AnimatePresence>
        {isCheckoutOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 bg-[#00529B] text-white flex justify-between items-center">
                <h2 className="text-xl font-black uppercase italic tracking-tight">Review & Payment</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="text-white/70 hover:text-white"><X className="h-6 w-6" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">Items Summary</p>
                <div className="space-y-2 mb-8">
                  {cart.map((item: any, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="text-xs font-black uppercase text-slate-800">{item.name}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">{item.quantity} x {formatCurrency(item.price)}</span>
                      </div>
                      <span className="font-mono font-black text-blue-700">{formatCurrency(item.total)}</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col items-center justify-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Select Payment Method</span>
                    <div className="grid grid-cols-2 gap-2 w-full mt-2">
                      {['cash', 'pos', 'transfer', 'split'].map(method => (
                        <button 
                          key={method}
                          onClick={() => setPaymentMethod(method as any)}
                          className={cn(
                            "py-3 rounded-xl border-2 font-black text-[10px] uppercase transition-all",
                            paymentMethod === method ? "bg-blue-600 border-blue-600 text-white shadow-lg" : "bg-white border-slate-100 text-slate-400"
                          )}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-blue-700 text-white p-6 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1">
                    <span className="text-[10px] font-bold opacity-50 uppercase tracking-[0.2em]">Payable Amount</span>
                    <span className="text-4xl font-black font-mono tracking-tighter italic">{formatCurrency(total)}</span>
                  </div>
                </div>

                {paymentMethod === 'split' && (
                  <div className="mt-6 bg-slate-100 p-6 rounded-2xl border border-slate-200">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-4 text-center">Split Payments Allocation (Must sum to {formatCurrency(total)})</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex flex-col">
                        <label className="text-[9px] font-bold text-slate-400 uppercase mb-1 ml-1">Cash amount</label>
                        <input
                          type="number"
                          value={splitCash}
                          onChange={(e) => setSplitCash(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-3 font-mono font-bold text-center text-slate-800 focus:outline-[#00529B]"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[9px] font-bold text-slate-400 uppercase mb-1 ml-1">POS Card amount</label>
                        <input
                          type="number"
                          value={splitPOS}
                          onChange={(e) => setSplitPOS(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-3 font-mono font-bold text-center text-slate-800 focus:outline-[#00529B]"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[9px] font-bold text-slate-400 uppercase mb-1 ml-1">Bank Transfer amount</label>
                        <input
                          type="number"
                          value={splitTransfer}
                          onChange={(e) => setSplitTransfer(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-3 font-mono font-bold text-center text-slate-800 focus:outline-[#00529B]"
                        />
                      </div>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center text-xs font-bold">
                      <div className="text-slate-500">Allocated: <span className="font-mono text-slate-800 font-black">{formatCurrency((parseFloat(splitCash) || 0) + (parseFloat(splitPOS) || 0) + (parseFloat(splitTransfer) || 0))}</span></div>
                      <div>
                        {Math.abs(((parseFloat(splitCash) || 0) + (parseFloat(splitPOS) || 0) + (parseFloat(splitTransfer) || 0)) - total) < 0.01 ? (
                          <span className="text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full text-[10px] tracking-wider uppercase block">Ready</span>
                        ) : (
                          <span className="text-red-600 bg-red-50 px-2.5 py-1 rounded-full text-[10px] tracking-wider uppercase block">
                            Mismatch: {formatCurrency(total - ((parseFloat(splitCash) || 0) + (parseFloat(splitPOS) || 0) + (parseFloat(splitTransfer) || 0)))} left
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 bg-white border-t border-slate-100 flex gap-4">
                <button 
                  onClick={() => setIsCheckoutOpen(false)}
                  className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-xs hover:bg-slate-200 transition-all"
                >
                  Back to POS
                </button>
                <button 
                  onClick={handleCheckout}
                  disabled={loading}
                  className="flex-[2] py-5 bg-[#00529B] text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 shadow-xl hover:bg-blue-800 transition-all active:scale-[0.98]"
                >
                  {loading ? <Zap className="animate-spin h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                  Confirm & Print Receipt [ENTER]
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isReceiptOpen && lastSale && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
             <motion.div 
               initial={{ scale: 0.95, opacity: 0 }} 
               animate={{ scale: 1, opacity: 1 }} 
               className="bg-slate-100 rounded-3xl p-6 md:p-8 w-full max-w-4xl shadow-2xl flex flex-col md:flex-row gap-6 max-h-[90vh] overflow-hidden"
             >
                {/* Formatting controls */}
                <div className="w-full md:w-64 flex flex-col gap-4 justify-between shrink-0">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-1 font-sans text-left">Receipt Output</h3>
                    <p className="text-[11px] text-slate-400 font-sans font-bold mb-4 text-left">Choose layout scaling matching your active store hardware printer.</p>
                    
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
                        <Printer className="h-4 w-4 shrink-0 animate-pulse text-blue-500" />
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
                     <PrintableReceipt sale={lastSale} format={printFormat} profile={profile} />
                  </div>
                </div>

                {/* Actions */}
                <div className="md:w-48 flex flex-col gap-2 shrink-0 md:justify-end">
                   <button 
                     type="button"
                     onClick={() => setIsReceiptOpen(false)} 
                     className="w-full py-4 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-2xl font-black uppercase text-xs tracking-wider transition-all"
                   >
                     Close Panel
                   </button>
                   <button 
                     type="button"
                     onClick={handlePrintReceipt} 
                     className="w-full py-4 bg-[#00529B] text-white hover:bg-blue-800 rounded-2xl font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-xl transition-all active:scale-95"
                   >
                     <Printer className="h-4 w-4"/>
                     Print receipt
                   </button>
                </div>
             </motion.div>
          </div>
        )}

        {isReceiptOpen && lastSale && createPortal(
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
             <PrintableReceipt sale={lastSale} format={printFormat} profile={profile} />
          </div>,
          document.body
        )}

        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-10 right-10 z-[300] max-w-sm p-5 rounded-2xl shadow-2xl border flex items-center gap-4 bg-slate-900 border-slate-800 text-white"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 font-black uppercase text-[10px] tracking-widest text-slate-400">
                {toast.type === 'success' ? (
                  <span className="text-emerald-400">● SUCCESS</span>
                ) : toast.type === 'error' ? (
                  <span className="text-rose-400">● TRANSACTION ERROR</span>
                ) : (
                  <span className="text-amber-400">● WARNING</span>
                )}
              </div>
              <p className="font-bold text-sm mt-1 text-slate-100 font-sans">{toast.message}</p>
            </div>
            <button 
              onClick={() => setToast(null)} 
              className="p-1 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={isUnitModalOpen} onOpenChange={setIsUnitModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-8">
           <DialogHeader><DialogTitle className="text-xl font-black uppercase italic tracking-tight">Select Unit Size</DialogTitle></DialogHeader>
           <div className="grid gap-2 pt-4">
              <button 
                onClick={() => {
                  addToCart(selectedProductForUnit!);
                  setIsUnitModalOpen(false);
                }} 
                className="p-5 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center hover:border-blue-500 transition-all group"
              >
                 <span className="font-bold text-slate-800 group-hover:text-blue-700 uppercase">{selectedProductForUnit?.baseUnit || 'Piece'} / Default</span>
                 <span className="font-mono font-bold text-blue-700">{formatCurrency(selectedProductForUnit?.price || 0)}</span>
              </button>

              {/* Automated package unit (e.g. Cartoon, Crate, etc) if configured and not explicitly present in variations */}
              {selectedProductForUnit && selectedProductForUnit.packageType && (selectedProductForUnit.packageCapacity || selectedProductForUnit.productsPerCarton) && (
                (() => {
                  const pkgName = selectedProductForUnit.packageType;
                  const pkgCapacity = selectedProductForUnit.packageCapacity || selectedProductForUnit.productsPerCarton || 0;
                  const alreadyExists = selectedProductForUnit.units?.some(u => u.name.toLowerCase() === pkgName.toLowerCase());
                  
                  if (!alreadyExists && pkgCapacity > 0) {
                    const pricePerUnit = selectedProductForUnit.price || 0;
                    const calculatedPrice = pricePerUnit * pkgCapacity;
                    const calculatedCost = (selectedProductForUnit.cost || 0) * pkgCapacity;
                    const autoPkg = {
                      name: pkgName,
                      conversionRate: pkgCapacity,
                      price: calculatedPrice,
                      cost: calculatedCost
                    };
                    return (
                      <button 
                        onClick={() => {
                          addToCart(selectedProductForUnit, autoPkg);
                          setIsUnitModalOpen(false);
                        }} 
                        className="p-5 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center hover:border-blue-500 transition-all group border-dashed hover:bg-indigo-50/50"
                      >
                         <div className="flex flex-col text-left">
                           <span className="font-bold text-slate-800 group-hover:text-blue-700 uppercase">{pkgName}</span>
                           <span className="text-[10px] text-slate-400 font-bold font-sans mt-0.5">Capacity: {pkgCapacity} unit(s)</span>
                         </div>
                         <span className="font-mono font-bold text-blue-700">{formatCurrency(calculatedPrice)}</span>
                      </button>
                    );
                  }
                  return null;
                })()
              )}

              {selectedProductForUnit?.units?.map((u, i) => (
                <button 
                  key={i} 
                  onClick={() => {
                    addToCart(selectedProductForUnit!, u);
                    setIsUnitModalOpen(false);
                  }} 
                  className="p-5 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center hover:border-blue-500 transition-all group"
                >
                   <span className="font-bold text-slate-800 group-hover:text-blue-700 uppercase">{u.name}</span>
                   <span className="font-mono font-bold text-blue-700">{formatCurrency(u.price)}</span>
                </button>
              ))}
           </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default POS;
