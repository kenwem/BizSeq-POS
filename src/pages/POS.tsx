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
  Keyboard,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn, cleanTo6Digits } from '../lib/utils';
import { createPortal } from 'react-dom';
import { PrintableReceipt } from '../components/common/PrintableReceipt';
import { printElementViaIframe } from '../lib/printHelper';
import { bluetoothPrinterService } from '../services/bluetoothPrinterService';

const POS: React.FC = () => {
  const { profile, loading: authLoading, reconnecting } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (profile) {
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

  // Web Bluetooth Printer layout states
  const [btSupported, setBtSupported] = useState(false);
  const [btConnected, setBtConnected] = useState(false);
  const [btDeviceName, setBtDeviceName] = useState('');
  const [btConnecting, setBtConnecting] = useState(false);

  useEffect(() => {
    setBtSupported(bluetoothPrinterService.isSupported());
    const interval = setInterval(async () => {
      const conn = await bluetoothPrinterService.isConnected();
      setBtConnected(conn);
      if (conn) {
        setBtDeviceName(bluetoothPrinterService.getConnectedDeviceName());
      } else {
        setBtDeviceName('');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectBluetooth = async () => {
    setBtConnecting(true);
    try {
      const success = await bluetoothPrinterService.connect();
      if (success) {
        const name = bluetoothPrinterService.getConnectedDeviceName();
        setBtConnected(true);
        setBtDeviceName(name);
        showToast(`Connected to Bluetooth Printer: ${name}!`, "success");
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to find or connect Bluetooth Printer.", "error");
    } finally {
      setBtConnecting(false);
    }
  };

  const handleDisconnectBluetooth = async () => {
    try {
      await bluetoothPrinterService.disconnect();
      setBtConnected(false);
      setBtDeviceName('');
      showToast("Bluetooth Printer Disconnected.", "warning");
    } catch (err: any) {
      console.error(err);
      showToast("Error disconnecting bluetooth printer.", "error");
    }
  };

  const handleBluetoothPrint = async () => {
    if (printFormat === 'standard') {
      showToast("Bluetooth printing is only supported for 58mm and 80mm formats.", "warning");
      return;
    }
    if (!lastSale) return;
    if (typeof window !== 'undefined' && (window as any).__PRINT_DEBUG__) {
      (window as any).__PRINT_DEBUG__.printMethod = "Bluetooth ESC/POS Device";
      (window as any).__PRINT_DEBUG__.printFormat = printFormat;
      (window as any).__PRINT_DEBUG__.updateStep(1, 'Success', 'Initiated Bluetooth receipt payload formatting');
      (window as any).__PRINT_DEBUG__.updateStep(8, 'Success', 'Transmitting raw packet stream over BLE GATT characteristics...');
    }
    try {
      showToast("Transmitting print payload over Bluetooth...", "success");
      await bluetoothPrinterService.printReceipt(lastSale, printFormat, profile);
      showToast("Receipt printed via Bluetooth successfully!", "success");
      if (typeof window !== 'undefined' && (window as any).__PRINT_DEBUG__) {
        (window as any).__PRINT_DEBUG__.updateStep(9, 'Success', 'BLE write ack accepted by receipt hardware buffer');
        (window as any).__PRINT_DEBUG__.updateStep(12, 'Success', 'Bluetooth printing task successfully finished.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to print via Bluetooth. Please check connection.", "error");
      if (typeof window !== 'undefined' && (window as any).__PRINT_DEBUG__) {
        (window as any).__PRINT_DEBUG__.updateStep(8, 'Failed', 'GATT character trace error: ' + err.message);
        (window as any).__PRINT_DEBUG__.addError(err);
      }
    }
  };

  // New State for requirement matching image
  const [currentTime, setCurrentTime] = useState(new Date());
  const [tenderedAmount, setTenderedAmount] = useState('');
  const [cashbackAmount, setCashbackAmount] = useState('');
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
    const populated = Array.from(new Map(list.map(l => [l.id, l])).values());
    const loaded = populated.map(l => {
      if (!l.id || l.id === '') {
        return { ...l, id: 'default-storage', name: l.name || 'Main Store/Default Storage' };
      }
      return l;
    });
    if (loaded.length === 0) {
      return [{ id: 'default-storage', name: 'Main Store/Default Storage', status: 'active' } as any];
    }
    return loaded;
  }, [hookLocations]);
  const { stock: allStock } = useInventoryStock(profile?.storeId);

  // Low Stock Alert Modal State
  const [lowStockAlert, setLowStockAlert] = useState<{
    isOpen: boolean;
    productName: string;
    locationName: string;
    available: number;
    requested: number;
    errorMsg: string;
  }>({
    isOpen: false,
    productName: '',
    locationName: '',
    available: 0,
    requested: 0,
    errorMsg: ''
  });

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

  const validateStockAddition = React.useCallback((
    productId: string, 
    locationId: string, 
    qtyDiffBaseUnits: number, 
    excludeCartIndex?: number
  ): { isValid: boolean; errorMsg?: string; available?: number; requested?: number } => {
    const bypassStockCheck = localStorage.getItem("store_allow_negative_stock") === "true";
    if (bypassStockCheck) return { isValid: true };

    const product = products.find(p => p.id === productId);
    if (!product) return { isValid: true };

    const key = `${productId}_${locationId}`;
    const availableStock = stockMap.has(key) ? (stockMap.get(key) ?? 0) : (product.stock ?? 0);

    let existingBaseUnits = 0;
    cart.forEach((item, index) => {
      if (index === excludeCartIndex) return;
      if (item.productId === productId && item.inventoryLocationId === locationId) {
        existingBaseUnits += item.quantity * (item.conversionRate || 1);
      }
    });

    const totalRequested = existingBaseUnits + qtyDiffBaseUnits;

    if (availableStock < totalRequested) {
      const locName = locations.find(l => l.id === locationId)?.name || 'selected location';
      return {
        isValid: false,
        errorMsg: `Insufficient stock for "${product.name}" in "${locName}". Available Stock: ${availableStock}, Requested Total: ${totalRequested}.`,
        available: availableStock,
        requested: totalRequested
      };
    }

    return { isValid: true };
  }, [stockMap, cart, products, locations]);

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
    const defaultSourceLoc = locations.find(l => l.isDefaultSalesSource === true);
    const finalLocationId = locationId || defaultSourceLoc?.id || product.defaultLocationId || (locations[0]?.id || 'default-storage');

    // SELECT STAGE LOW-STOCK POS LOCK:
    const validation = validateStockAddition(product.id, finalLocationId, qty * conversionRate);
    if (!validation.isValid) {
      setLowStockAlert({
        isOpen: true,
        productName: product.name,
        locationName: locations.find(l => l.id === finalLocationId)?.name || 'selected location',
        available: validation.available ?? 0,
        requested: validation.requested ?? 0,
        errorMsg: validation.errorMsg ?? ''
      });
      setQtyInput('1');
      return;
    }

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
  }, [qtyInput, locations, validateStockAddition]);

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
          const product = products.find(p => cleanTo6Digits(p.barcode) === cleanTo6Digits(barcode));
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

  // Held Invoices system state & actions
  const [heldInvoices, setHeldInvoices] = useState<any[]>(() => {
    const saved = localStorage.getItem("pos_held_invoices");
    return saved ? JSON.parse(saved) : [];
  });
  const [isRecallModalOpen, setIsRecallModalOpen] = useState(false);

  const holdCurrentInvoice = React.useCallback(() => {
    if (cart.length === 0) {
      showToast("Cannot hold an empty invoice. Add items first.", "error");
      return;
    }
    const newHold = {
      id: "INV-HELD-" + Math.floor(1000 + Math.random() * 9000),
      cart,
      tenderedAmount,
      cashbackAmount,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      date: new Date().toLocaleDateString('en-US'),
      total: subtotal
    };
    const updated = [newHold, ...heldInvoices];
    setHeldInvoices(updated);
    localStorage.setItem("pos_held_invoices", JSON.stringify(updated));
    
    // Clear current invoice
    setCart([]);
    setTenderedAmount('');
    setCashbackAmount('');
    setSelectedItemIndex(null);
    showToast(`Invoice ${newHold.id} put on hold!`, "success");
  }, [cart, tenderedAmount, cashbackAmount, heldInvoices, subtotal, showToast]);

  const recallInvoice = React.useCallback((invoice: any) => {
    let updatedHolds = heldInvoices.filter(x => x.id !== invoice.id);
    if (cart.length > 0) {
      const autoHold = {
        id: "INV-HELD-" + Math.floor(1000 + Math.random() * 9000),
        cart,
        tenderedAmount,
        cashbackAmount,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: new Date().toLocaleDateString('en-US'),
        total: subtotal
      };
      updatedHolds = [autoHold, ...updatedHolds];
      showToast(`Active products held under ${autoHold.id}`, "warning");
    }
    setHeldInvoices(updatedHolds);
    localStorage.setItem("pos_held_invoices", JSON.stringify(updatedHolds));

    // Set active cart state to retrieved invoice
    setCart(invoice.cart);
    setTenderedAmount(invoice.tenderedAmount || '');
    setCashbackAmount(invoice.cashbackAmount || '');
    setSelectedItemIndex(invoice.cart.length > 0 ? 0 : null);
    setIsRecallModalOpen(false);
    showToast(`Recalled invoice ${invoice.id}`, "success");
  }, [cart, tenderedAmount, cashbackAmount, heldInvoices, subtotal, showToast]);

  const removeHeldInvoice = React.useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = heldInvoices.filter(x => x.id !== id);
    setHeldInvoices(updated);
    localStorage.setItem("pos_held_invoices", JSON.stringify(updated));
    showToast(`Held invoice ${id} cleared`, "success");
  }, [heldInvoices, showToast]);

  // Global key listener for shortcuts (F6: New Invoice, F7: Hold, F8: Open Recalls, F9: Void, F11: Pay)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault();
        setCart([]);
        setTenderedAmount('');
        setCashbackAmount('');
        setSelectedItemIndex(null);
        showToast("New clean invoice sheet created", "success");
      } else if (e.key === 'F7') {
        e.preventDefault();
        holdCurrentInvoice();
      } else if (e.key === 'F8') {
        e.preventDefault();
        setIsRecallModalOpen(true);
      } else if (e.key === 'F9') {
        e.preventDefault();
        setCart([]);
        setTenderedAmount('');
        setCashbackAmount('');
        setSelectedItemIndex(null);
        showToast("Current invoice voided", "warning");
      } else if (e.key === 'F11') {
        e.preventDefault();
        if (cart.length > 0) {
          setIsCheckoutOpen(true);
        } else {
          showToast("Cart is empty", "error");
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [holdCurrentInvoice, cart, showToast]);

  // Search logic is handled reactively via the useProducts hook above.
  const loadingProducts = authLoading || productsLoading;

  const filteredProducts = useMemo(() => {
    const list = selectedCategory === 'ALL ITEMS' 
      ? products 
      : products.filter(p => p.category === selectedCategory);
      
    if (!search) return list;
    
    return list.filter(p => 
      p.name.toLowerCase().includes(search.toLowerCase()) || 
      (p.barcode && cleanTo6Digits(p.barcode).toLowerCase().includes(search.toLowerCase())) ||
      (p.sku && cleanTo6Digits(p.sku).toLowerCase().includes(search.toLowerCase()))
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
    
    const cashBack = parseFloat(cashbackAmount) || 0;
    const finalTendered = parseFloat(tenderedAmount) || (total + cashBack);
    const finalChange = Math.max(0, finalTendered - (total + cashBack));

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
      tenderedAmount: finalTendered,
      changeDue: finalChange,
      cashbackAmount: cashBack,
      status: 'completed',
      createdAt: new Date() as any,
      cashierId: profile.uid || 'unknown',
      cashierName: profile.username || 'Unknown Cashier',
      ...(paymentMethod === 'split' ? { splitPayments } : {})
    };

    try {
      const runOfflineCheckout = async () => {
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
      };

      if (isOnline) {
        try {
          // 4-second timeout race to prevent POS checkout from getting trapped/hanging on network lag or Firestore credential blockage
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Timeout: Firestore transaction is taking too long. Transitioning to offline storage mode to prevent stall.")), 4000);
          });

          await Promise.race([
            runTransaction(db, async (transaction) => {
              const saleRef = doc(collection(db, 'sales'));
              const finalSaleData: any = {
                ...saleData,
                id: saleRef.id,
                createdAt: serverTimestamp()
              };
              if (finalSaleData.splitPayments === undefined) {
                delete finalSaleData.splitPayments;
              }
              
              // 1. ALL READS FIRST
              const productSpecs: {
                item: any;
                productRef: any;
                stockRef: any;
                productSnap: any;
                stockSnap: any;
              }[] = [];

              for (const item of cart as any[]) {
                const productRef = doc(db, 'products', item.productId);
                const stockId = `${item.productId}_${item.inventoryLocationId}`;
                const stockRef = doc(db, 'inventory_location_stock', stockId);
                
                const productSnap = await transaction.get(productRef);
                const stockSnap = await transaction.get(stockRef);
                
                productSpecs.push({
                  item,
                  productRef,
                  stockRef,
                  productSnap,
                  stockSnap
                });
              }

              // 2. ALL WRITES AFTER
              for (const spec of productSpecs) {
                const { item, productRef, stockRef, productSnap, stockSnap } = spec;
                
                if (!productSnap.exists()) {
                  throw new Error(`Product ${item.name} not found.`);
                }
                
                const currentProductData = productSnap.data();
                const currentTotalStock = currentProductData.stock || 0;
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
                createdAt: new Date(),
                synced: true 
              } as any);
            }),
            timeoutPromise
          ]);
          showToast("Sale completed successfully!", "success");
        } catch (onlineErr: any) {
          console.warn("Online transaction aborted or hung, transitioning to secure offline local storage mode:", onlineErr);
          await runOfflineCheckout();
          showToast(`Transaction redirected to safe offline local storage: ${onlineErr.message || 'Stalled Connection'}`, "warning");
        }
      } else {
        await runOfflineCheckout();
        showToast("Checkout completed locally (Offline Mode). Sale will sync when internet is restored.", "warning");
      }
      
      setCart([]);
      setSelectedItemIndex(null);
      setTenderedAmount('');
      setCashbackAmount('');
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
    if (!lastSale) return;
    try {
      const selectedPaperFormat = printFormat;
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
      {/* =========================================================================
          DESKTOP LAYOUT (visible on screen widths lg and up)
         ========================================================================= */}
      <div className="hidden lg:flex flex-col h-full overflow-hidden">
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
                  {cart.map((item: any, idx) => {
                    const keyVal = `${item.productId}-${item.unitName || 'PC'}-${item.inventoryLocationId}-${idx}`;
                    return (
                      <tr 
                        key={keyVal}
                        onClick={() => setSelectedItemIndex(idx)}
                        className={cn(
                          "border-b border-slate-100 cursor-pointer",
                          selectedItemIndex === idx ? "bg-blue-50" : "hover:bg-slate-50"
                        )}
                      >
                        <td className="px-3 py-2 text-center border-r border-slate-100">{idx + 1}</td>
                        <td className="px-3 py-2 border-r border-slate-100 font-mono text-[10px]">
                          {cleanTo6Digits(products.find(p => p.id === item.productId)?.barcode) || 'N/A'}
                        </td>
                        <td className="px-3 py-2 border-r border-slate-100 font-bold">
                          {item.name} {item.unitName && item.unitName !== 'Piece' && `(${item.unitName})`}
                        </td>
                        <td className="px-3 py-2 border-r border-slate-100 text-center">
                          <select 
                            value={item.inventoryLocationId}
                            onChange={(e) => {
                              const newLocId = e.target.value;
                              const currentItem = cart[idx];
                              const baseUnitsNeeded = currentItem.quantity * (currentItem.conversionRate || 1);
                              
                              const validation = validateStockAddition(currentItem.productId, newLocId, baseUnitsNeeded, idx);
                              if (!validation.isValid) {
                                setLowStockAlert({
                                  isOpen: true,
                                  productName: currentItem.name,
                                  locationName: locations.find(l => l.id === newLocId)?.name || 'selected location',
                                  available: validation.available ?? 0,
                                  requested: validation.requested ?? 0,
                                  errorMsg: validation.errorMsg ?? ''
                                });
                                return;
                              }
                              
                              const newCart = [...cart];
                              newCart[idx].inventoryLocationId = newLocId;
                              setCart(newCart);
                            }}
                            className="w-full bg-transparent text-[10px] uppercase font-bold outline-none text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {locations.map((loc, lIdx) => {
                              const keyLoc = `cart-item-loc-opt-${loc.id || 'unkn'}-${lIdx}`;
                              return (
                                <option key={keyLoc} value={loc.id}>{loc.name}</option>
                              );
                            })}
                          </select>
                        </td>
                        <td className="px-3 py-2 border-r border-slate-100 text-center font-bold">{item.quantity}</td>
                        <td className="px-3 py-2 border-r border-slate-100 text-right font-mono">{formatCurrency(item.price)}</td>
                        <td className="px-3 py-2 text-right font-bold text-blue-700 font-mono">{formatCurrency(item.total)}</td>
                      </tr>
                    );
                  })}
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
             {['ALL ITEMS', ...Array.from(new Set(categories))].map((cat, idx) => {
               const keyVal = `pos-cat-${cat}-${idx}`;
               return (
                 <button 
                  key={keyVal}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-4 py-2 rounded text-[10px] font-black uppercase transition-all whitespace-nowrap min-w-[100px] shadow-sm border",
                    selectedCategory === cat ? "bg-[#00529B] text-white border-blue-900" : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                  )}
                 >
                   {cat}
                 </button>
               );
             })}
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
                          {locations.map((loc, lIdx) => {
                            const keyVal = `pos-hdr-loc-${loc.id || 'unkn'}-${lIdx}`;
                            return (
                              <th key={keyVal} className="px-4 py-2 border-r w-28 text-center bg-blue-50 text-blue-700">{loc.name}</th>
                            );
                          })}
                          <th className="px-4 py-2">Category</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700 font-medium capitalize">
                        {paginatedPOSProducts.map((p, index) => {
                          const keyVal = `pos-list-row-${p.id || 'unkn'}-${index}`;
                          return (
                            <tr 
                              key={keyVal} 
                              onClick={() => handleProductClick(p)}
                              className="hover:bg-blue-50 cursor-pointer border-b border-slate-100 active:bg-blue-100 transition-colors"
                            >
                              <td className="px-4 py-1.5 border-r font-mono text-[10px] uppercase">{cleanTo6Digits(p.sku) || p.id.substring(0,8)}</td>
                              <td className="px-4 py-1.5 border-r font-mono text-[10px]">{cleanTo6Digits(p.barcode) || '---'}</td>
                              <td className="px-4 py-1.5 border-r font-bold uppercase">{p.name}</td>
                              <td className="px-4 py-1.5 border-r text-right font-bold text-blue-700 font-mono italic">{formatCurrency(p.price)}</td>
                              <td className="px-4 py-1.5 border-r text-center font-bold">{p.stock}</td>
                              {locations.map((loc, lIdx) => {
                                const qty = stockMap.get(`${p.id}_${loc.id}`) || 0;
                                const keyLocStock = `pos-list-row-stock-${loc.id || 'unkn'}-${lIdx}`;
                                return (
                                  <td key={keyLocStock} className="px-4 py-1.5 border-r text-center font-bold text-slate-500">
                                    {qty}
                                  </td>
                                );
                              })}
                              <td className="px-4 py-1.5 uppercase text-[10px] text-slate-400 font-bold italic">{p.category}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
              </div>
            ) : (
              <div className="flex-1 p-2 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-1.5 overflow-y-auto custom-scrollbar">
                  {paginatedPOSProducts.map((product, index) => {
                    const keyVal = `pos-grid-item-${product.id || 'unkn'}-${index}`;
                    return (
                      <button 
                        key={keyVal} 
                        onClick={() => handleProductClick(product)}
                        className="aspect-square bg-white border border-slate-300 rounded p-1.5 flex flex-col items-center justify-center text-center gap-1 hover:border-blue-500 transition-all active:scale-95 shadow-sm group"
                      >
                        <span className="text-[10px] font-black uppercase leading-tight line-clamp-2 text-slate-800 group-hover:text-blue-700">{product.name}</span>
                        <span className="text-[10px] font-black text-blue-600 font-mono">{formatCurrency(product.price)}</span>
                      </button>
                    );
                  })}
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
            {[7, 8, 9, 'QTY', 4, 5, 6, 'PRICE', 1, 2, 3, 'BACKSPACE', 0, '00', '.', 'REMOVE'].map((k) => {
              return (
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
                        const targetItem = cart[selectedItemIndex];
                        const conversionRate = targetItem.conversionRate || 1;
                        const validation = validateStockAddition(targetItem.productId, targetItem.inventoryLocationId, val * conversionRate, selectedItemIndex);
                        if (!validation.isValid) {
                          setLowStockAlert({
                            isOpen: true,
                            productName: targetItem.name,
                            locationName: locations.find(l => l.id === targetItem.inventoryLocationId)?.name || 'selected location',
                            available: validation.available ?? 0,
                            requested: validation.requested ?? 0,
                            errorMsg: validation.errorMsg ?? ''
                          });
                          setQtyInput('1');
                          return;
                        }
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
              );
            })}
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
        <button 
          onClick={() => { 
            setCart([]); 
            setTenderedAmount('');
            setCashbackAmount('');
            setSelectedItemIndex(null); 
            showToast("New clean invoice sheet created", "success");
          }} 
          className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-blue-50 transition-colors cursor-pointer text-center"
        >
          <ListIcon className="h-4 w-4 text-slate-500 group-hover:text-blue-600 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">NEW INVOICE</span>
          <span className="text-[8px] opacity-40">F6</span>
        </button>
        <button 
          onClick={holdCurrentInvoice}
          className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-yellow-50 transition-colors cursor-pointer text-center"
        >
          <Minus className="h-4 w-4 text-slate-400 group-hover:text-amber-500 mb-1" />
          <span className="text-[10px] font-bold text-slate-700 uppercase">Hold Invoice</span>
          <span className="text-[8px] opacity-40">F7</span>
        </button>
        
        <button 
          onClick={() => setIsRecallModalOpen(true)}
          className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-indigo-50 relative transition-colors cursor-pointer text-center"
        >
          <ShoppingCart className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 mb-1" />
          <span className="text-[10px] font-bold text-slate-700 uppercase">Recall ({heldInvoices.length})</span>
          {heldInvoices.length > 0 && (
            <span className="absolute top-1 right-2 px-1.5 py-0.5 text-[8px] font-extrabold bg-indigo-600 text-white rounded-full leading-none">
              {heldInvoices.length}
            </span>
          )}
          <span className="text-[8px] opacity-40">F8</span>
        </button>

        {/* Search Bar integrated into footer replacing some actions */}
        <div className="col-span-2 sm:col-span-2 lg:col-span-2 flex items-center bg-white border-2 border-blue-500 rounded px-3 gap-2 shadow-md focus-within:ring-2 focus-within:ring-blue-200 transition-all h-14">
          <Search className="h-4 w-4 text-blue-500 shrink-0" />
          <input 
            id="footer-search-input"
            type="text"
            placeholder="SCAN BARCODE / NAME..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="w-full h-full bg-transparent outline-none font-black text-[10px] text-slate-800 placeholder:text-slate-400 placeholder:italic placeholder:font-normal uppercase"
          />
        </div>
 
        <button 
          onClick={() => { 
            setCart([]); 
            setTenderedAmount('');
            setCashbackAmount('');
            setSelectedItemIndex(null); 
            showToast("Current invoice voided", "warning"); 
          }} 
          className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-blue-50 transition-colors cursor-pointer text-center"
        >
          <ListIcon className="h-4 w-4 text-slate-500 group-hover:text-blue-600 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">VOID INVOICE</span>
          <span className="text-[8px] opacity-40">F9</span>
        </button>
        <button onClick={() => setIsCheckoutOpen(true)} className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-emerald-50 transition-colors cursor-pointer text-center">
          <Banknote className="h-4 w-4 text-emerald-500 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">PAYMENT</span>
          <span className="text-[8px] opacity-40">F11</span>
        </button>
        <button onClick={() => navigate('/login')} className="h-14 bg-white border border-slate-300 rounded flex flex-col items-center justify-center group hover:bg-red-50 transition-colors cursor-pointer text-center">
          <X className="h-4 w-4 text-red-500 mb-1" />
          <span className="text-[10px] font-bold text-slate-700">LOGOUT</span>
          <span className="text-[8px] opacity-40">F12</span>
        </button>
      </div>
      </div>

      {/* =========================================================================
          MOBILE OPTIMIZED LAYOUT (visible on screen widths smaller than lg)
         ========================================================================= */}
      <div className="flex lg:hidden flex-col h-full bg-[#F0F4F8] text-slate-800 overflow-hidden relative">
        {/* Mobile Header */}
        <div className="bg-[#00529B] px-3 py-2 flex items-center justify-between shadow-md shrink-0 text-white">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-wider">{profile?.store?.name || profile?.storeName || 'Store'} POS</span>
          </div>
          <div className="flex gap-1">
            <button 
              onClick={() => { setCart([]); setSelectedItemIndex(null); }}
              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-[9px] font-black uppercase tracking-widest rounded border border-white/10 clickable text-white"
            >
              Void All
            </button>
            <button 
              onClick={() => navigate('/')}
              className="px-2.5 py-1 bg-white/15 hover:bg-white/25 text-[9px] font-black uppercase tracking-widest rounded border border-white/15 clickable text-white"
            >
              Exit
            </button>
          </div>
        </div>

        {/* Mobile Search & Category Swiper */}
        <div className="bg-white p-2.5 space-y-2 border-b border-slate-205 shrink-0 text-slate-800">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input 
              type="text"
              placeholder="SEARCH NAME / BARCODE / SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 text-slate-800 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs font-bold leading-none placeholder:text-slate-400 uppercase focus:outline-none focus:border-[#00529B] focus:bg-white text-slate-800"
            />
            {search && (
              <button 
                onClick={() => setSearch('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Horizontally scrollable categories tab row */}
          <div className="flex gap-1 overflow-x-auto whitespace-nowrap py-0.5 no-scrollbar">
            {["ALL ITEMS", ...categories].map((cat, idx) => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={`mob-cat-tab-${cat}-${idx}`}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border",
                    isActive ? "bg-[#00529B] text-white border-blue-900 shadow" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  )}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile Body Area (Dynamic Stacked Layout) */}
        <div className="flex-1 flex flex-col min-h-0 text-slate-800">
          {/* Section 1: Interactive Touch Shopping Cart list (Height: 32%) */}
          <div className="h-[32%] flex flex-col bg-white border-b border-slate-200 min-h-0 text-slate-800">
            <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-550 shrink-0">
              <span>Selected Products ({cart.reduce((acc, i) => acc + i.quantity, 0)})</span>
              <span className="font-mono text-[#00529B] font-black">{formatCurrency(subtotal)}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar bg-slate-50/50">
              {cart.map((item: any, idx) => {
                const keyVal = `mob-cart-it-${item.productId}-${idx}`;
                const isSelected = selectedItemIndex === idx;
                return (
                  <div 
                    key={keyVal} 
                    onClick={() => setSelectedItemIndex(idx)}
                    className={cn(
                      "p-2 rounded-xl flex items-center justify-between gap-2 border transition-all cursor-pointer",
                      isSelected ? "bg-blue-50 border-blue-400 text-slate-900 shadow-inner" : "bg-white border-slate-200 text-slate-800"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold text-slate-800 uppercase truncate tracking-tight">{item.name}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-[8px] text-slate-500 font-mono">
                        <span className="font-bold text-[#00529B]">{formatCurrency(item.price)}</span>
                        <span>• {item.unitName || 'PC'}</span>
                        <span className="bg-slate-100 text-[8px] text-slate-550 px-1 py-px rounded font-sans font-bold uppercase">{locations.find(l => l.id === item.inventoryLocationId)?.name || 'Default'}</span>
                      </div>
                    </div>

                    {/* Quantity controls optimized for one-touch with thumb */}
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          updateQuantity(item.productId, -1, item.unitName, item.inventoryLocationId);
                        }}
                        className="w-10 h-10 md:w-8 md:h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-black font-mono text-slate-700 active:bg-slate-200 active:scale-95 transition-all shadow-sm cursor-pointer select-none"
                      >
                        -
                      </button>
                      <span className="w-6 text-center font-mono font-black text-xs text-slate-800 select-none">{item.quantity}</span>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const limitCheck = validateStockAddition(item.productId, item.inventoryLocationId, (item.quantity + 1) * (item.conversionRate || 1), idx);
                          if (!limitCheck.isValid) {
                            setLowStockAlert({
                              isOpen: true,
                              productName: item.name,
                              locationName: locations.find(l => l.id === item.inventoryLocationId)?.name || 'store',
                              available: limitCheck.available ?? 0,
                              requested: limitCheck.requested ?? 0,
                              errorMsg: limitCheck.errorMsg ?? ''
                            });
                            return;
                          }
                          updateQuantity(item.productId, 1, item.unitName, item.inventoryLocationId);
                        }}
                        className="w-10 h-10 md:w-8 md:h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-black font-mono text-slate-700 active:bg-slate-200 active:scale-95 transition-all shadow-sm cursor-pointer select-none"
                      >
                        +
                      </button>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          removeFromCart(item.productId, item.unitName, item.inventoryLocationId);
                        }}
                        className="w-10 h-10 md:w-8 md:h-8 ml-1 rounded-xl bg-rose-50 hover:bg-rose-100 flex items-center justify-center text-rose-600 active:bg-rose-200 active:scale-95 border border-rose-200 transition-all cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {cart.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 py-6">
                  <ShoppingCart className="h-6 w-6 mb-2 opacity-50 text-slate-300" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Your Basket is Empty</p>
                  <p className="text-[8px] italic mt-1 text-slate-400">Search items above and tap to add</p>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Compact Product Browser / Fast list search sheet (Height: 35%) */}
          <div className="h-[35%] flex flex-col bg-slate-100 border-b border-slate-205 min-h-0 text-slate-800">
            <div className="px-3 py-1 bg-slate-200/60 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500 flex justify-between shrink-0">
              <span>Catalog Matching List</span>
              <span className="text-[9px] text-[#00529B] font-black">Total: {filteredProducts.length}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar bg-slate-100/40">
              {paginatedPOSProducts.map((p, index) => {
                const keyVal = `mob-cat-it-${p.id || 'unkn'}-${index}`;
                return (
                  <button 
                    key={keyVal}
                    onClick={() => handleProductClick(p)}
                    className="w-full text-left bg-white border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-3 active:scale-[0.98] hover:border-[#00529B] transition-all cursor-pointer text-slate-700 shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-black uppercase text-slate-900 tracking-tight truncate leading-normal">{p.name}</div>
                      <div className="flex items-center gap-1.5 mt-1 text-[8px] text-slate-500 font-mono">
                        <span>SKU: {cleanTo6Digits(p.sku) || 'N/A'}</span>
                        <span>•</span>
                        <span>Stock: <strong className="font-bold text-slate-700">{p.stock}</strong></span>
                        <span>•</span>
                        <span className="text-[#00529B] font-sans font-bold uppercase">{p.category}</span>
                      </div>
                    </div>
                    
                    <div className="shrink-0 flex items-center gap-1.5">
                      <span className="px-2 py-1 bg-blue-50 border border-blue-100 text-[#00529B] rounded-lg text-[9px] font-black font-mono">
                        {formatCurrency(p.price)}
                      </span>
                      <span className="w-5 h-5 bg-[#00529B] rounded-full flex items-center justify-center text-white text-xs font-black">
                        +
                      </span>
                    </div>
                  </button>
                );
              })}
              {products.length === 0 && (
                <div className="py-8 flex flex-col items-center justify-center text-slate-400">
                  <Package className="h-6 w-6 mb-2 opacity-30 text-slate-300" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">No Products Registered</p>
                </div>
              )}
              {products.length > 0 && filteredProducts.length === 0 && (
                <div className="py-8 flex flex-col items-center justify-center text-slate-400">
                  <Search className="h-6 w-6 mb-2 opacity-30 text-slate-300" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">No matches found</p>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Realtime Totals, Payments and Checkout Drawer Panel (Height: 33%) */}
          <div className="h-[33%] bg-white border-t border-slate-205 flex flex-col min-h-0 text-slate-800 p-2.5 space-y-1.5 shrink-0">
            {/* Quick Totals Summary row */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-50 border border-slate-200 p-1.5 rounded-xl flex flex-col gap-0.5">
                <span className="text-[8px] text-slate-500 uppercase font-black">Cashback (Handout)</span>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-bold text-[9px] text-slate-400">#</span>
                  <input 
                    type="number"
                    placeholder="0"
                    value={cashbackAmount}
                    onChange={(e) => setCashbackAmount(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-2 pl-4 py-1.5 text-[11px] font-bold font-mono text-slate-800 outline-none focus:border-[#00529B]"
                  />
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-1.5 rounded-xl flex flex-col gap-0.5">
                <span className="text-[8px] text-slate-500 uppercase font-black">Received (Tendered)</span>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-bold text-[9px] text-slate-400">#</span>
                  <input 
                    type="number"
                    placeholder="0"
                    value={tenderedAmount}
                    onChange={(e) => setTenderedAmount(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-2 pl-4 py-1.5 text-[11px] font-bold font-mono text-slate-800 outline-none focus:border-[#00529B]"
                  />
                </div>
              </div>
            </div>

            {/* Balances, payment methods, and Check out trigger */}
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-2 flex flex-col justify-between gap-1.5">
              {/* Balances Row */}
              <div className="flex justify-between items-center bg-slate-100 p-1 px-2.5 rounded-lg">
                <div className="flex flex-col">
                  <span className="text-[8px] text-slate-500 uppercase font-black tracking-wider leading-none mb-0.5 font-sans">Bill Payable</span>
                  <span className="text-xs font-black font-mono text-slate-900">{formatCurrency(total + (parseFloat(cashbackAmount) || 0))}</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-[8px] text-slate-500 uppercase font-black tracking-wider leading-none mb-0.5 font-sans">Change Due</span>
                  <span className="text-xs font-black font-mono text-emerald-600">
                    {formatCurrency(Math.max(0, (parseFloat(tenderedAmount) || (total + (parseFloat(cashbackAmount) || 0))) - (total + (parseFloat(cashbackAmount) || 0))))}
                  </span>
                </div>
              </div>

              {/* Quick payment selector row */}
              <div className="flex gap-0.5">
                {['cash', 'pos', 'transfer', 'split'].map(method => {
                  const isActive = paymentMethod === method;
                  return (
                    <button 
                      key={`mob-pay-meth-${method}`}
                      onClick={() => setPaymentMethod(method as any)}
                      className={cn(
                        "flex-1 py-1 rounded-lg text-[8px] font-black uppercase text-center border transition-all cursor-pointer",
                        isActive ? "bg-[#00529B] border-blue-900 text-white shadow-sm" : "bg-white border-slate-200 text-slate-600"
                      )}
                    >
                      {method}
                    </button>
                  );
                })}
              </div>

              {/* COMPLETE CHECKOUT block CTA */}
              <button
                onClick={() => {
                  if (cart.length === 0) {
                    showToast("Basket is empty, add products first", "error");
                    return;
                  }
                  setIsCheckoutOpen(true);
                }}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 font-black text-center text-[9px] uppercase tracking-wider rounded-lg text-white shadow active:scale-[0.98] transition-all cursor-pointer border border-emerald-500"
              >
                COMPLETE CHECKOUT • {formatCurrency(total + (parseFloat(cashbackAmount) || 0))}
              </button>
            </div>
          </div>
        </div>
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
                  {cart.map((item: any, idx) => {
                    return (
                      <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                        <div className="flex flex-col">
                          <span className="text-xs font-black uppercase text-slate-800">{item.name}</span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase">{item.quantity} x {formatCurrency(item.price)}</span>
                        </div>
                        <span className="font-mono font-black text-blue-700">{formatCurrency(item.total)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col items-center justify-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Select Payment Method</span>
                    <div className="grid grid-cols-2 gap-2 w-full mt-2">
                      {['cash', 'pos', 'transfer', 'split'].map(method => {
                        return (
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
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-blue-700 text-white p-6 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1">
                    <span className="text-[10px] font-bold opacity-50 uppercase tracking-[0.2em]">Payable Amount</span>
                    <span className="text-4xl font-black font-mono tracking-tighter italic">{formatCurrency(total)}</span>
                  </div>
                </div>

                {/* Tender & Cashback Calculations */}
                <div className="mt-6 bg-slate-100 border border-slate-200 p-6 rounded-2xl space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Store Cashback</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-xs text-slate-400">#</span>
                        <input 
                          type="number"
                          placeholder="0.00"
                          value={cashbackAmount}
                          onChange={(e) => setCashbackAmount(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-4 py-3.5 font-mono font-black text-slate-800 text-sm focus:outline-[#00529B] focus:border-[#00529B]"
                        />
                      </div>
                      <span className="text-[8px] text-slate-400 font-bold ml-1 mt-1 uppercase">Billed to transaction, given back as cash</span>
                    </div>

                    <div className="flex flex-col">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Amount Paid / Tendered</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-xs text-slate-400">#</span>
                        <input 
                          type="number"
                          placeholder="0.00"
                          value={tenderedAmount}
                          onChange={(e) => setTenderedAmount(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-4 py-3.5 font-mono font-black text-slate-800 text-sm focus:outline-[#00529B] focus:border-[#00529B]"
                        />
                      </div>
                      <span className="text-[8px] text-slate-400 font-bold ml-1 mt-1 uppercase">Customer cash tender</span>
                    </div>
                  </div>

                  <div className="bg-slate-900 text-white p-4 rounded-xl space-y-2 mt-4 text-xs font-bold leading-normal">
                    <div className="flex justify-between items-center text-[10px] uppercase tracking-wider opacity-70">
                      <span>Items Purchased Price</span>
                      <span className="font-mono">{formatCurrency(total)}</span>
                    </div>
                    {parseFloat(cashbackAmount) > 0 && (
                      <div className="flex justify-between items-center text-[10px] uppercase tracking-wider text-yellow-300">
                        <span>Store Cashback</span>
                        <span className="font-mono">+{formatCurrency(parseFloat(cashbackAmount) || 0)}</span>
                      </div>
                    )}
                    <div className="h-px bg-white/10 my-1" />
                    <div className="flex justify-between items-center uppercase tracking-wider text-slate-300">
                      <span>Total Invoice Charge</span>
                      <span className="font-mono text-white text-sm">{formatCurrency(total + (parseFloat(cashbackAmount) || 0))}</span>
                    </div>
                    <div className="flex justify-between items-center uppercase tracking-wider text-emerald-400">
                      <span>Tendered amount</span>
                      <span className="font-mono">{formatCurrency(parseFloat(tenderedAmount) || (total + (parseFloat(cashbackAmount) || 0)))}</span>
                    </div>
                    <div className="h-px bg-white/10 my-1" />
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase tracking-widest text-[#93C5FD]">Balance Change Due</span>
                      <span className="font-mono text-xl font-black text-emerald-400">
                        {formatCurrency(Math.max(0, (parseFloat(tenderedAmount) || (total + (parseFloat(cashbackAmount) || 0))) - (total + (parseFloat(cashbackAmount) || 0))))}
                      </span>
                    </div>
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

                    {/* Bluetooth Printer Connection Controller Card */}
                    {btSupported ? (
                      <div className="mt-5 border border-slate-250 rounded-2xl p-4 bg-white shadow-sm font-sans flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("h-2.5 w-2.5 rounded-full inline-block", btConnected ? "bg-emerald-500 animate-pulse" : "bg-rose-400")} />
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Bluetooth Link</span>
                          </div>
                          {btConnected && (
                            <span className="text-[9px] font-mono font-black text-emerald-600 bg-emerald-50 border border-emerald-100/55 px-1.5 py-0.5 rounded-md">CONNECTED</span>
                          )}
                        </div>

                        {btConnected ? (
                          <div className="space-y-2">
                            <p className="text-[11px] font-black leading-tight text-slate-800 truncate">Printer: {btDeviceName}</p>
                            <button
                              type="button"
                              onClick={handleDisconnectBluetooth}
                              className="text-[9px] font-extrabold uppercase text-rose-500 hover:text-rose-600 pr-2 tracking-wider inline-block cursor-pointer transition-colors"
                            >
                              Disconnect
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={btConnecting}
                            onClick={handleConnectBluetooth}
                            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all text-center flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-40"
                          >
                            {btConnecting ? "Prv Pairing..." : "🔗 Connect Thermal"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="mt-5 border border-dashed border-slate-250 rounded-2xl p-4 bg-slate-50 font-sans text-center">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Bluetooth Unavailable</p>
                        <p className="text-[9px] text-slate-400 font-medium leading-normal mt-1">Requires Google Chrome, Microsoft Edge, or Android Chrome launcher.</p>
                      </div>
                    )}
                  </div>
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
                   
                   {btConnected && printFormat !== 'standard' && (
                     <button 
                       type="button"
                       onClick={handleBluetoothPrint} 
                       className="w-full py-4 bg-emerald-600 text-white hover:bg-emerald-750 border border-emerald-500 shadow-lg shadow-emerald-600/10 rounded-2xl font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95"
                     >
                       <Zap className="h-4 w-4 shrink-0 animate-bounce text-emerald-200" />
                       Print Bluetooth
                     </button>
                   )}

                   <button 
                     type="button"
                     onClick={handlePrintReceipt} 
                     className="w-full py-4 bg-[#00529B] text-white hover:bg-blue-800 rounded-2xl font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-xl transition-all active:scale-95"
                   >
                     <Printer className="h-4 w-4"/>
                     System Print
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
                 <div className="flex flex-col text-left">
                   <span className="font-bold text-slate-800 group-hover:text-blue-700 uppercase">
                     {selectedProductForUnit?.baseUnit || 'Piece'} / Default (1 unit)
                   </span>
                   <span className="text-[10px] text-slate-400 font-bold font-sans mt-0.5">Base single item unit</span>
                 </div>
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
                           <span className="font-bold text-slate-800 group-hover:text-blue-700 uppercase">
                             {pkgName} ({pkgCapacity} units)
                           </span>
                           <span className="text-[10px] text-slate-400 font-bold font-sans mt-0.5">Capacity: {pkgCapacity} unit(s)</span>
                         </div>
                         <span className="font-mono font-bold text-blue-700">{formatCurrency(calculatedPrice)}</span>
                      </button>
                    );
                  }
                  return null;
                })()
              )}

              {selectedProductForUnit?.units?.map((u, i) => {
                return (
                  <button 
                    key={i} 
                    onClick={() => {
                      addToCart(selectedProductForUnit!, u);
                      setIsUnitModalOpen(false);
                    }} 
                    className="p-5 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center hover:border-blue-500 transition-all group"
                  >
                     <div className="flex flex-col text-left">
                       <span className="font-bold text-slate-800 group-hover:text-blue-700 uppercase">
                         {u.name} ({u.conversionRate} units)
                       </span>
                       <span className="text-[10px] text-slate-400 font-bold font-sans mt-0.5">Capacity: {u.conversionRate} unit(s)</span>
                     </div>
                     <span className="font-mono font-bold text-blue-700">{formatCurrency(u.price)}</span>
                  </button>
                );
              })}
           </div>
        </DialogContent>
      </Dialog>

      <Dialog open={lowStockAlert.isOpen} onOpenChange={(open) => setLowStockAlert(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="max-w-md rounded-2xl p-8 bg-white border border-red-100 shadow-2xl">
          <DialogHeader className="flex flex-col items-center text-center">
            <div className="h-14 w-14 bg-red-50 border border-red-100 rounded-full flex items-center justify-center text-red-500 mb-4 animate-bounce">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl font-black text-rose-700 uppercase tracking-tight">
              Out of Stock
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-medium text-xs mt-2 uppercase tracking-wide">
              Selected Item exceeds storage allocation
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-4 p-4 bg-slate-50 rounded-xl space-y-3 font-sans border border-slate-100">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider">Product:</span>
              <span className="text-slate-900 font-black uppercase text-right leading-tight max-w-[200px] truncate">{lowStockAlert.productName}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider">Selected Location:</span>
              <span className="text-[#00529B] font-black uppercase">{lowStockAlert.locationName}</span>
            </div>
            <div className="border-t border-slate-200/50 my-2 pt-2 flex justify-between items-center text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider">In Stock Available:</span>
              <span className="text-rose-600 font-extrabold font-mono text-sm bg-rose-50 border border-rose-100 px-2.5 py-0.5 rounded-lg">{lowStockAlert.available} Units</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider">Requested Total:</span>
              <span className="text-slate-900 font-extrabold font-mono text-sm">{lowStockAlert.requested} {lowStockAlert.requested === 1 ? 'Unit' : 'Units'}</span>
            </div>
          </div>
          
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={() => setLowStockAlert(prev => ({ ...prev, isOpen: false }))}
              className="w-full py-4 bg-slate-900 hover:bg-slate-950 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 cursor-pointer"
            >
              Acknowledge & Dismiss
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isRecallModalOpen} onOpenChange={setIsRecallModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-8 bg-white shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase italic tracking-tight text-slate-800">
              RECALL HELD INVOICES
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-medium text-xs uppercase tracking-wide">
              Restore previously saved drafts or suspended customer carts.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 max-h-[350px] overflow-y-auto space-y-2 pr-1 font-sans">
            {heldInvoices.length === 0 ? (
              <div className="text-center py-10 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <ShoppingCart className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">No suspense invoices found</p>
                <p className="text-[10px] text-slate-400 font-normal mt-1 leading-normal">
                  Put active purchase sheets on hold using the F7 shortcut key or "HOLD INVOICE" button to recall them later.
                </p>
              </div>
            ) : (
              heldInvoices.map((invoice) => {
                const totalQty = invoice.cart.reduce((s: number, item: any) => s + (item.quantity || 0), 0);
                return (
                  <div 
                    key={invoice.id}
                    onClick={() => recallInvoice(invoice)}
                    className="p-4 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between hover:border-blue-400 hover:bg-blue-50/50 cursor-pointer transition-all group"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-xs text-slate-800 group-hover:text-blue-700 font-mono tracking-tight">{invoice.id}</span>
                        <span className="text-[9px] px-1.5 py-0.5 bg-slate-200 text-slate-600 font-bold uppercase rounded font-sans shrink-0">{totalQty} item{totalQty !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-400 font-medium leading-none">
                        <span>{invoice.date}</span>
                        <span>•</span>
                        <span>{invoice.timestamp}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-black text-xs text-slate-700">{formatCurrency(invoice.total || 0)}</span>
                      <button
                        onClick={(e) => removeHeldInvoice(invoice.id, e)}
                        className="p-1.5 rounded-lg hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Delete Hold Draft"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          <div className="mt-6">
            <button
              onClick={() => setIsRecallModalOpen(false)}
              className="w-full py-3 bg-slate-900 hover:bg-slate-950 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 cursor-pointer"
            >
              Close Panel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default POS;
