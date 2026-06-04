import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Product, ProductUnit } from '../types';
import { useProducts } from '../hooks/useProducts';
import { 
  Plus, 
  Search, 
  Filter, 
  Edit, 
  Trash, 
  Package,
  ArrowRight,
  Zap,
  Layers,
  MoreHorizontal,
  Download,
  Upload,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  History,
  LayoutGrid,
  List as ListIcon,
  TrendingDown,
  Warehouse,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  ArrowLeftRight,
  ClipboardCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn, cleanTo6Digits, generate6DigitCode } from '../lib/utils';
import { useStore } from '../services/store';
import Fuse from 'fuse.js';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { exportProductsToExcel, exportProductsToPDF } from '../lib/exportUtils';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Badge } from '../components/ui/badge';

import { useInventoryLocations } from '../hooks/useInventoryLocations';
import { useInventoryStock } from '../hooks/useInventoryStock';
import { useStockTransfers } from '../hooks/useStockTransfers';

// Helper functions (spec: numeric representation with commas while typing)
const formatNumericInput = (val: string): string => {
  if (val === undefined || val === null) return '';
  // strip standard commas and ensure only digits or one dot
  let clean = String(val).replace(/,/g, '');
  clean = clean.replace(/[^0-9.]/g, '');
  const parts = clean.split('.');
  if (parts.length > 2) {
    clean = parts[0] + '.' + parts.slice(1).join('');
  }
  
  const beforeDec = parts[0] || '';
  const dec = parts[1] !== undefined ? '.' + parts[1] : '';
  
  if (!beforeDec) return dec ? '0' + dec : '';
  
  // Add thousands separator to beforeDec
  const num = parseFloat(beforeDec);
  if (isNaN(num)) return val;
  const formatted = num.toLocaleString('en-US');
  return formatted + dec;
};

const parseNumericString = (val: string | number): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  // Strip commas and convert to number
  const clean = String(val).replace(/,/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

const UNIT_CATEGORIES = [
  { key: 'VOLUME', name: 'Volume', units: ['Liter', 'Gallon', 'Drum'] },
  { key: 'CONTAINER', name: 'Container', units: ['Bottle', 'Sachet', 'Crate', 'Carton', 'Basket', 'Pack'] },
  { key: 'WEIGHT', name: 'Weight', units: ['Kg', 'Bag', 'Ton'] },
  { key: 'LENGTH', name: 'Length', units: ['Meter', 'Yard', 'Roll'] },
  { key: 'COUNT', name: 'Count', units: ['Piece', 'Dozen', 'Bundle'] }
];

const Inventory: React.FC = () => {
  const { profile } = useAuth();
  const { products: hookProducts, isLoading, addProduct, updateProduct, deleteProduct, isSaving } = useProducts(profile?.storeId);
  const products = React.useMemo(() => {
    const list = hookProducts || [];
    return Array.from(new Map(list.map(p => [p.id, p])).values());
  }, [hookProducts]);

  const { locations: hookLocations, addLocation, updateLocation, deleteLocation } = useInventoryLocations(profile?.storeId);
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

  const handleSetDefaultSalesSource = async (locationId: string) => {
    try {
      for (const loc of locations) {
        if (!loc.id || loc.id === 'default-storage') continue;
        if (loc.id === locationId) {
          await updateLocation({ id: loc.id, isDefaultSalesSource: true });
        } else if (loc.isDefaultSalesSource) {
          await updateLocation({ id: loc.id, isDefaultSalesSource: false });
        }
      }
    } catch (err: any) {
      console.error("Failed to update default sales source", err);
      alert("Error: " + err.message);
    }
  };

  const handleDeleteLocation = async (id: string, name: string) => {
    if (id === 'default-storage') {
      alert("The primary default storage location cannot be deleted.");
      return;
    }
    if (!confirm(`Are you sure you want to delete "${name}"?`)) {
      return;
    }
    try {
      await deleteLocation(id);
    } catch (err: any) {
      console.error("Failed to delete location", err);
      alert("Error: " + err.message);
    }
  };

  // Load and load-balance location inventories and transfers
  const { stock: allStock, updateStock } = useInventoryStock(profile?.storeId);
  const { transfers = [], transferStock } = useStockTransfers(profile?.storeId);

  const stockMap = React.useMemo(() => {
    const map = new Map<string, number>();
    if (!allStock) return map;
    for (const item of allStock) {
      if (item.productId && item.inventoryLocationId) {
        map.set(`${item.productId}_${item.inventoryLocationId}`, item.quantity || 0);
      }
    }
    return map;
  }, [allStock]);

  const uniqueCategoriesFromProducts = React.useMemo(() => {
    return Array.from(new Set(products.map(p => p.category).filter(Boolean)));
  }, [products]);
  
  // Navigation and Modal controller states
  const [activeTab, setActiveTab] = useState<'products' | 'locations' | 'transfers'>('products');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('default-storage');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [stocktakeProductId, setStocktakeProductId] = useState<string | null>(null);
  const [stocktakeCount, setStocktakeCount] = useState('');

  // Transfer Form temporary states
  const [transferProductId, setTransferProductId] = useState('');
  const [transferFromLocId, setTransferFromLocId] = useState('');
  const [transferToLocId, setTransferToLocId] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferError, setTransferError] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);

  const exportLocationReportExcel = (locId: string) => {
    const locName = locations.find(l => l.id === locId)?.name || 'Location';
    const locStock = products.map(p => {
      const qty = stockMap.get(`${p.id}_${locId}`) ?? 0;
      return {
        'Product Name': p.name,
        'SKU': p.sku || '',
        'Barcode': p.barcode || '',
        'Category': p.category,
        'Unit Price': p.price,
        'Cost Price': p.cost,
        'Quantity': qty,
        'Inventory Value (Cost)': qty * (p.cost || 0),
        'Inventory Value (Retail)': qty * (p.price || 0)
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(locStock);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Location Inventory");
    XLSX.writeFile(workbook, `${locName.replace(/\s+/g, '_')}_Inventory_Report.xlsx`);
  };

  const exportLocationReportPDF = (locId: string) => {
    const locName = locations.find(l => l.id === locId)?.name || 'Location';
    const locStockProducts = products.map(p => {
      const qty = stockMap.get(`${p.id}_${locId}`) ?? 0;
      return {
        ...p,
        stock: qty // override product total stock with location stock
      };
    });
    exportProductsToPDF(locStockProducts, `${profile?.storeName || 'Store'} - ${locName}`);
  };

  const handleStockTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError('');
    setIsTransferring(true);
    
    try {
      const parsedQty = parseFloat(transferQty);
      if (isNaN(parsedQty) || parsedQty <= 0) {
        throw new Error('Please enter a valid quantity greater than zero');
      }

      if (!transferProductId) {
        throw new Error('Please select a product');
      }

      if (!transferFromLocId || !transferToLocId) {
        throw new Error('Please specify both source and destination locations');
      }

      if (transferFromLocId === transferToLocId) {
        throw new Error('Source and destination locations must be different');
      }

      const product = products.find(p => p.id === transferProductId);
      if (!product) {
        throw new Error('Selected product does not exist');
      }

      // Check current stock limit
      const sourceKey = `${transferProductId}_${transferFromLocId}`;
      const sourceQtyAvailable = stockMap.get(sourceKey) ?? 0;
      if (sourceQtyAvailable < parsedQty) {
        throw new Error(`Insufficient stock in source location. Available: ${sourceQtyAvailable}`);
      }

      await transferStock({
        storeId: profile?.storeId || '',
        productId: transferProductId,
        fromLocationId: transferFromLocId,
        toLocationId: transferToLocId,
        quantity: parsedQty,
        notes: transferNotes,
        transferredBy: profile?.username || profile?.email || 'System'
      });

      // Reset
      setTransferProductId('');
      setTransferFromLocId('');
      setTransferToLocId('');
      setTransferQty('');
      setTransferNotes('');
      setIsTransferModalOpen(false);
    } catch (err: any) {
      setTransferError(err.message || 'Failed to transfer stock');
    } finally {
      setIsTransferring(false);
    }
  };

  const [search, setSearch] = useState('');
  const [locationsSearch, setLocationsSearch] = useState('');
  const [locationsCategory, setLocationsCategory] = useState('ALL');
  const [locationsPage, setLocationsPage] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
  const [filterMode, setFilterMode] = useState<'all' | 'low' | 'out'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  // Synchronized scrollbar refs & logic
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const topScrollContainerRef = React.useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(1200);

  const handleTopScroll = () => {
    if (topScrollContainerRef.current && tableContainerRef.current) {
      if (tableContainerRef.current.scrollLeft !== topScrollContainerRef.current.scrollLeft) {
        tableContainerRef.current.scrollLeft = topScrollContainerRef.current.scrollLeft;
      }
    }
  };

  const handleTableScroll = () => {
    if (tableContainerRef.current && topScrollContainerRef.current) {
      if (topScrollContainerRef.current.scrollLeft !== tableContainerRef.current.scrollLeft) {
        topScrollContainerRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
      }
    }
  };

  React.useEffect(() => {
    if (viewMode !== 'table') return;

    const updateWidth = () => {
      if (tableContainerRef.current) {
        const tableEl = tableContainerRef.current.querySelector('table');
        const width = tableEl ? tableEl.scrollWidth : tableContainerRef.current.scrollWidth;
        setTableScrollWidth(Math.max(1200, width));
      }
    };

    updateWidth();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && tableContainerRef.current) {
      observer = new ResizeObserver(() => {
        updateWidth();
      });
      observer.observe(tableContainerRef.current);
      const tableEl = tableContainerRef.current.querySelector('table');
      if (tableEl) {
        observer.observe(tableEl);
      }
    }

    const interval = setInterval(updateWidth, 1000);

    return () => {
      if (observer) {
        observer.disconnect();
      }
      clearInterval(interval);
    };
  }, [viewMode, products, search, filterMode, currentPage]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [search, filterMode, products.length]);
  
  // Product Form states
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formBaseUnit, setFormBaseUnit] = useState('Piece');
  const [formBasePrice, setFormBasePrice] = useState('');
  const [formMinStockLevel, setFormMinStockLevel] = useState('5');
  const [formDefaultLocation, setFormDefaultLocation] = useState('');
  const [formLocationAllocations, setFormLocationAllocations] = useState<{ locationId: string; quantity: string; unitName?: string; conversionRate?: number; }[]>([
    { locationId: 'default-storage', quantity: '', unitName: 'Piece', conversionRate: 1 }
  ]);
  const [formProductsPerCarton, setFormProductsPerCarton] = useState('');
  const [formPackageType, setFormPackageType] = useState('Carton');

  // Location Manager states
  const [isLocationManagerOpen, setIsLocationManagerOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationDesc, setNewLocationDesc] = useState('');
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  
  // Cost price batches state
  const [costBatches, setCostBatches] = useState<any[]>([]);
  // Additional units state
  const [additionalUnits, setAdditionalUnits] = useState<any[]>([]);
  
  // UI toggles
  const [showBatchList, setShowBatchList] = useState(false);
  const [showAdditionalUnits, setShowAdditionalUnits] = useState(false);
  
  // Unit picker states
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [isSelectingAdditionalUnit, setIsSelectingAdditionalUnit] = useState(false);
  const [inlineAdditionalUnit, setInlineAdditionalUnit] = useState({ unitType: '', price: '' });
  const [activeAllocIndexForUnitSelect, setActiveAllocIndexForUnitSelect] = useState<number | null>(null);
  
  // Batch modal state
  const [isAddBatchModalOpen, setIsAddBatchModalOpen] = useState(false);
  const [newBatchData, setNewBatchData] = useState({ costPrice: '', quantity: '' });
  
  // Validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  React.useEffect(() => {
    if (isModalOpen) {
      setFormErrors({});
      setShowBatchList(false);
      setShowAdditionalUnits(false);
      setIsSelectingAdditionalUnit(false);
      setInlineAdditionalUnit({ unitType: '', price: '' });
      setNewBatchData({ costPrice: '', quantity: '' });

      if (editingProduct) {
        setFormName(editingProduct.name || '');
        setFormSku(cleanTo6Digits(editingProduct.sku || editingProduct.barcode || ''));
        setFormCategory(editingProduct.category || '');
        setFormBaseUnit(editingProduct.baseUnit || 'Piece');
        setFormBasePrice(formatNumericInput(String(editingProduct.price || '')));
        setFormMinStockLevel(formatNumericInput(String(editingProduct.lowStockThreshold ?? '5')));
        setFormDefaultLocation(editingProduct.defaultLocationId || '');
        setFormProductsPerCarton(String(editingProduct.packageCapacity || editingProduct.productsPerCarton || ''));
        setFormPackageType(editingProduct.packageType || 'Carton');
        
        // Load Location stock allocations
        const existingStocks = allStock.filter(s => s.productId === editingProduct.id);
        if (existingStocks.length > 0) {
          setFormLocationAllocations(existingStocks.map(s => ({
            locationId: s.inventoryLocationId || 'default-storage',
            quantity: String(s.quantity || '0'),
            unitName: editingProduct.baseUnit || 'Piece',
            conversionRate: 1
          })));
        } else {
          setFormLocationAllocations([
            { 
              locationId: editingProduct.defaultLocationId || 'default-storage', 
              quantity: String(editingProduct.stock || '0'), 
              unitName: editingProduct.baseUnit || 'Piece', 
              conversionRate: 1 
            }
          ]);
        }

        // Load additional units
        const mappedUnits = (editingProduct.units || []).map(u => ({
          unitType: u.name,
          conversionRate: String(u.conversionRate || '1'),
          price: formatNumericInput(String(u.price || '0')),
          quantity: String(u.cost || '0')
        }));
        setAdditionalUnits(mappedUnits);

        // Load cost Price History
        const history = (editingProduct as any).costPriceHistory || [];
        if (history.length > 0) {
          setCostBatches(history.map((h: any) => ({
            costPrice: formatNumericInput(String(h.costPrice || '0')),
            quantity: formatNumericInput(String(h.quantity || '0')),
            date: h.date || new Date().toISOString(),
            isNew: false
          })));
        } else {
          setCostBatches([{
            costPrice: formatNumericInput(String(editingProduct.cost || '0')),
            quantity: formatNumericInput(String(editingProduct.stock || '0')),
            date: editingProduct.createdAt || new Date().toISOString(),
            isNew: false
          }]);
        }
      } else {
        setFormName('');
        setFormSku('');
        setFormCategory('');
        setFormBaseUnit('Piece');
        setFormBasePrice('');
        setFormMinStockLevel('5');
        setFormDefaultLocation('');
        setFormProductsPerCarton('');
        setFormPackageType('Carton');
        setAdditionalUnits([]);
        const firstLocId = locations[0]?.id || 'default-storage';
        setFormLocationAllocations([{ locationId: firstLocId, quantity: '', unitName: 'Piece', conversionRate: 1 }]);
        setCostBatches([{
          costPrice: '',
          quantity: '',
          date: new Date().toISOString(),
          isNew: true
        }]);
      }
    }
  }, [isModalOpen, editingProduct, allStock, locations]);

  const availableUnitsForAlloc = useMemo(() => {
    const list: { name: string; conversionRate: number }[] = [];
    list.push({ name: formBaseUnit || 'Piece', conversionRate: 1 });
    
    const capNum = parseNumericString(formProductsPerCarton);
    if (capNum > 1 && formPackageType) {
      list.push({ name: formPackageType, conversionRate: capNum });
    }
    
    additionalUnits.forEach(u => {
      const conv = parseNumericString(u.conversionRate);
      if (conv > 0 && u.unitType) {
        list.push({ name: u.unitType, conversionRate: conv });
      }
    });
    
    return list;
  }, [formBaseUnit, formProductsPerCarton, formPackageType, additionalUnits]);

  // Synchronize first batch quantity with total allocated stock from locations when user modifies allocations
  React.useEffect(() => {
    if (!isModalOpen) return;
    const totalAllocated = formLocationAllocations.reduce((sum, item) => sum + (parseNumericString(item.quantity) * (item.conversionRate || 1)), 0);
    setCostBatches(prev => {
      const copy = [...prev];
      if (copy.length === 0) {
        copy.push({ costPrice: '', quantity: String(totalAllocated), date: new Date().toISOString(), isNew: true });
      } else {
        copy[0] = { ...copy[0], quantity: formatNumericInput(String(totalAllocated || '')) };
      }
      return copy;
    });
  }, [formLocationAllocations, isModalOpen]);

  const computedTotalQuantity = useMemo(() => {
    return costBatches.reduce((sum, b) => sum + parseNumericString(b.quantity), 0);
  }, [costBatches]);

  const primaryCostPrice = costBatches[0]?.costPrice || '';
  const primaryQuantity = costBatches[0]?.quantity || '';

  const handleUpdatePrimaryCostPrice = (val: string) => {
    const formatted = formatNumericInput(val);
    setCostBatches(prev => {
      const copy = [...prev];
      if (copy.length === 0) {
        copy.push({ costPrice: formatted, quantity: '', date: new Date().toISOString(), isNew: true });
      } else {
        copy[0] = { ...copy[0], costPrice: formatted };
      }
      return copy;
    });
  };

  const handleUpdatePrimaryQuantity = (val: string) => {
    const formatted = formatNumericInput(val);
    setCostBatches(prev => {
      const copy = [...prev];
      if (copy.length === 0) {
        copy.push({ costPrice: '', quantity: formatted, date: new Date().toISOString(), isNew: true });
      } else {
        copy[0] = { ...copy[0], quantity: formatted };
      }
      return copy;
    });
  };

  const handleDeleteBatch = (index: number) => {
    if (index === 0) return; // Prevent deleting primary batch
    setCostBatches(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleDeleteAdditionalUnit = (index: number) => {
    setAdditionalUnits(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleAddAdditionalUnit = () => {
    const { unitType, price } = inlineAdditionalUnit;
    if (!unitType) {
      alert("Please select a unit type first.");
      return;
    }
    if (!price || parseNumericString(price) <= 0) {
      alert("Please enter a positive price.");
      return;
    }

    let rate = '1';
    if (unitType.toLowerCase() === formPackageType.toLowerCase()) {
      rate = formProductsPerCarton || '12';
    } else {
      const uLower = unitType.toLowerCase();
      if (uLower === 'carton') rate = formProductsPerCarton || '12';
      else if (uLower === 'crate') rate = formProductsPerCarton || '24';
      else if (uLower === 'dozen') rate = '12';
      else if (uLower === 'pack') rate = formProductsPerCarton || '6';
      else if (uLower === 'roll') rate = formProductsPerCarton || '10';
      else if (uLower === 'bundle') rate = formProductsPerCarton || '10';
      else if (uLower === 'coil') rate = formProductsPerCarton || '10';
    }

    setAdditionalUnits(prev => [...prev, {
      unitType,
      conversionRate: rate,
      price: price,
      quantity: '0'
    }]);
    setInlineAdditionalUnit({ unitType: '', price: '' });
  };

  const handleSubmitProductForm = (e: React.FormEvent) => {
    e.preventDefault();
    handleSaveProduct(e);
  };

  const fuse = useMemo(() => new Fuse(products, {
    keys: ['name', 'barcode', 'sku', 'category'],
    threshold: 0.3
  }), [products]);

  const filteredProducts = useMemo(() => {
    let result = search ? fuse.search(search).map(r => r.item) : products;
    
    if (filterMode === 'low') {
      result = result.filter(p => p.stock <= p.lowStockThreshold && p.stock > 0);
    } else if (filterMode === 'out') {
      result = result.filter(p => p.stock <= 0);
    }
    
    return result;
  }, [search, fuse, products, filterMode]);

  const itemsPerPage = 30;
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(start, start + itemsPerPage);
  }, [filteredProducts, currentPage]);

  const stockStats = useMemo(() => {
    const totalItems = products.length;
    const totalStock = products.reduce((acc, p) => acc + p.stock, 0);
    const totalValue = products.reduce((acc, p) => acc + (p.stock * p.price), 0);
    const totalCost = products.reduce((acc, p) => acc + (p.stock * (p.cost || 0)), 0);
    const lowStockCount = products.filter(p => p.stock <= p.lowStockThreshold && p.stock > 0).length;
    
    return { totalItems, totalStock, totalValue, totalCost, lowStockCount };
  }, [products]);

  const filteredLocProducts = useMemo(() => {
    let list = products || [];
    
    // Filter only products stocked at the selected warehouse/location
    if (selectedLocationId) {
      list = list.filter(p => {
        const qty = stockMap.get(`${p.id}_${selectedLocationId}`) ?? 0;
        return qty > 0;
      });
    }

    if (locationsCategory !== 'ALL') {
      list = list.filter(p => (p.category || 'Uncategorized').toUpperCase() === locationsCategory.toUpperCase());
    }
    if (locationsSearch) {
      const q = locationsSearch.toLowerCase();
      list = list.filter(p => 
        (p.name || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, locationsSearch, locationsCategory, selectedLocationId, stockMap]);

  const LOC_ITEMS_PER_PAGE = 30;
  const paginatedLocProducts = useMemo(() => {
    const start = (locationsPage - 1) * LOC_ITEMS_PER_PAGE;
    return filteredLocProducts.slice(start, start + LOC_ITEMS_PER_PAGE);
  }, [filteredLocProducts, locationsPage]);

  React.useEffect(() => {
    setLocationsPage(1);
  }, [locationsSearch, locationsCategory, selectedLocationId]);

  const isReadOnly = profile?.role === 'staff' || profile?.role === 'cashier';

  const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [restockAmount, setRestockAmount] = useState(0);

  const handleRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockProduct || restockAmount <= 0) return;
    
    try {
      await updateProduct({ 
        id: restockProduct.id, 
        stock: (restockProduct.stock || 0) + Number(restockAmount) 
      });
      alert("SUCCESS: Stock level updated.");
      setIsRestockModalOpen(false);
      setRestockAmount(0);
    } catch (err: any) {
      alert(`ERROR: ${err.message}`);
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    
    if (!formName.trim()) {
      errors.name = 'Name is required';
    }
    if (!formBaseUnit) {
      errors.baseUnit = 'Base unit is required';
    }
    
    const sellPrice = parseNumericString(formBasePrice);
    if (!formBasePrice || sellPrice <= 0) {
      errors.basePrice = 'Selling price must be a positive number';
    }
    
    const minStock = parseNumericString(formMinStockLevel);
    if (!formMinStockLevel || minStock < 0) {
      errors.minStockLevel = 'Minimum stock level must be a non-negative number';
    }
    
    if (computedTotalQuantity < 0) {
      errors.quantity = 'Quantity must be a non-negative number';
    }

    const emptyAllocation = formLocationAllocations.some(a => !a.locationId);
    if (emptyAllocation) {
      errors.locations = 'Each stock allocation row must select a valid storage location';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isReadOnly) return;

    if (!validateForm()) {
      return;
    }

    const storeId = profile?.storeId;
    if (!storeId) {
      alert("ERROR: No store assigned to your account. You cannot add products.");
      return;
    }

    // Determine SKU/barcode
    let finalSku = cleanTo6Digits(formSku.trim());
    if (!finalSku) {
      finalSku = generate6DigitCode();
    }
    const finalBarcode = finalSku;

    // Mapping additionalUnits to ProductUnit db interface
    const formattedUnits = additionalUnits.map(unit => ({
      name: unit.unitType,
      conversionRate: parseNumericString(unit.conversionRate || '1'),
      price: parseNumericString(unit.price || '0'),
      cost: parseNumericString(unit.quantity || '0')
    }));

    // Auto-include inline variation if they filled out the name and price in variation form but forgot to click '+'
    if (inlineAdditionalUnit.unitType && inlineAdditionalUnit.price && parseNumericString(inlineAdditionalUnit.price) > 0) {
      const alreadyExists = formattedUnits.some(
        u => u.name.toLowerCase() === inlineAdditionalUnit.unitType.toLowerCase()
      );
      if (!alreadyExists) {
        let rate = 1;
        const uLower = inlineAdditionalUnit.unitType.toLowerCase();
        if (uLower === formPackageType.toLowerCase()) {
          rate = parseNumericString(formProductsPerCarton || '12');
        } else {
          if (uLower === 'carton') rate = parseNumericString(formProductsPerCarton || '12');
          else if (uLower === 'crate') rate = parseNumericString(formProductsPerCarton || '24');
          else if (uLower === 'dozen') rate = 12;
          else if (uLower === 'pack') rate = parseNumericString(formProductsPerCarton || '6');
          else if (uLower === 'roll') rate = parseNumericString(formProductsPerCarton || '10');
          else if (uLower === 'bundle') rate = parseNumericString(formProductsPerCarton || '10');
          else if (uLower === 'coil') rate = parseNumericString(formProductsPerCarton || '10');
        }
        formattedUnits.push({
          name: inlineAdditionalUnit.unitType,
          conversionRate: rate,
          price: parseNumericString(inlineAdditionalUnit.price),
          cost: 0
        });
      }
    }

    // Auto-generate package-type (carton/crate) variation if productsPerCarton is set but not defined in variations (new products only)
    const packageCapacityNum = parseNumericString(formProductsPerCarton || '0');
    if (!editingProduct && formPackageType && packageCapacityNum > 1) {
      const alreadyHasPackageUnit = formattedUnits.some(
        u => u.name.toLowerCase() === formPackageType.toLowerCase()
      );
      if (!alreadyHasPackageUnit) {
        const basePriceNum = parseNumericString(formBasePrice);
        formattedUnits.push({
          name: formPackageType,
          conversionRate: packageCapacityNum,
          price: basePriceNum * packageCapacityNum,
          cost: 0
        });
      }
    }

    // Prepare Cost Price History
    const cleanCostPriceHistory = costBatches.map(b => ({
      costPrice: String(parseNumericString(b.costPrice)),
      quantity: String(parseNumericString(b.quantity)),
      date: b.date || new Date().toISOString()
    }));

    const finalCost = parseNumericString(costBatches[0]?.costPrice || 0);

    const hasNoUnits = formattedUnits.length === 0;
    const productPayload = {
      name: formName.trim(),
      sku: finalSku,
      barcode: finalBarcode,
      category: formCategory.trim() || 'Uncategorized',
      baseUnit: formBaseUnit,
      price: parseNumericString(formBasePrice),
      cost: finalCost,
      stock: computedTotalQuantity,
      lowStockThreshold: parseNumericString(formMinStockLevel),
      defaultLocationId: formLocationAllocations[0]?.locationId || '',
      productsPerCarton: hasNoUnits ? null : parseNumericString(formProductsPerCarton || '0'),
      packageType: hasNoUnits ? null : formPackageType,
      packageCapacity: hasNoUnits ? null : parseNumericString(formProductsPerCarton || '0'),
      units: formattedUnits,
      costPriceHistory: cleanCostPriceHistory,
      storeId: storeId,
      updatedAt: new Date().toISOString()
    };

    try {
      let finalProductId = '';
      if (editingProduct) {
        finalProductId = editingProduct.id;
        await updateProduct({ id: editingProduct.id, ...productPayload });
      } else {
        finalProductId = await addProduct(productPayload);
      }

      // Sync and distribute stock levels across multiple locations
      const existingProductStock = allStock.filter(s => s.productId === finalProductId);
      const allocatedLocationIds = new Set(formLocationAllocations.map(a => a.locationId));

      // 1. Clear stock to 0 for any location that was previously stocked but is no longer allocated
      for (const ext of existingProductStock) {
        if (ext.inventoryLocationId && !allocatedLocationIds.has(ext.inventoryLocationId)) {
          await updateStock({
            productId: finalProductId,
            locationId: ext.inventoryLocationId,
            quantity: 0,
            lowStockThreshold: parseNumericString(formMinStockLevel)
          });
        }
      }

      // 2. Set/update stock for each allocated location
      for (const alloc of formLocationAllocations) {
        if (!alloc.locationId) continue;
        const qtyNum = parseNumericString(alloc.quantity) * (alloc.conversionRate || 1);
        await updateStock({
          productId: finalProductId,
          locationId: alloc.locationId,
          quantity: qtyNum,
          lowStockThreshold: parseNumericString(formMinStockLevel)
        });
      }

      alert(editingProduct ? "SUCCESS: Product updated." : "SUCCESS: Product created.");
      setIsModalOpen(false);
      setEditingProduct(null);
    } catch (err: any) {
      alert(`SAVE ERROR: ${err.message}`);
    }
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        'Name': 'Example Product',
        'Barcode': '123456789',
        'SKU': 'SKU001',
        'Category': 'General',
        'Price': 1500,
        'Cost': 1000,
        'Stock': 100,
        'Threshold': 10,
        'Variation': 'Carton',
        'Variation Price': 15000
      }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "InventoryTemplate");
    XLSX.writeFile(wb, "bizseq_inventory_template.xlsx");
  };

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet) as any[];

      try {
        for (const item of json) {
          const variationStr = String(item.Variation || item.variation || '').trim();
          const variationPriceStr = String(item['Variation Price'] || item['variation price'] || item.Price || item.price || '').trim();
          
          let unitsList: ProductUnit[] = [];
          const cleanVarStr = variationStr.toLowerCase();
          const isNoVar = !variationStr || ['-', 'none', 'n/a', 'nil', ''].includes(cleanVarStr);
          
          if (!isNoVar) {
            const names = variationStr.split(',').map(s => s.trim()).filter(Boolean);
            const prices = variationPriceStr.split(',').map(s => s.trim()).filter(Boolean);
            
            names.forEach((name, idx) => {
              const priceVal = Number(prices[idx] || item.Price || item.price || 0);
              unitsList.push({
                name,
                conversionRate: 12,
                price: priceVal,
                cost: Number(item.Cost || item.cost || 0)
              });
            });
          }

          const productNameClean = String(item.Name || item.name || '').trim();
          let finalBarcode = cleanTo6Digits(String(item.Barcode || item.barcode || ''));
          let finalSku = cleanTo6Digits(String(item.SKU || item.sku || ''));

          // Find match first: we match by Name or SKU first to prevent barcode collision overwriting the wrong products
          const existingProduct = products.find(p => {
            const pNorm = (p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const csvNorm = productNameClean.toLowerCase().replace(/[^a-z0-9]/g, '');
            const matchName = pNorm === csvNorm;

            const matchSku = !!(p.sku && finalSku && p.sku.trim().toLowerCase() === finalSku.trim().toLowerCase());
            
            // If the name is an exact normalized match, it's the same product
            if (matchName) return true;
            
            // If SKU matches, it's the same product
            if (matchSku) return true;

            // Barcode match only if the name is empty or we have no sku/name conflicts (safer to not match if completely different names)
            const matchBarcode = !!(p.barcode && finalBarcode && p.barcode.trim().toLowerCase() === finalBarcode.trim().toLowerCase());
            if (matchBarcode && (pNorm === "" || csvNorm === "" || pNorm.includes(csvNorm) || csvNorm.includes(pNorm))) {
              return true;
            }

            return false;
          });

          if (existingProduct) {
            finalBarcode = existingProduct.barcode || finalBarcode;
            finalSku = existingProduct.sku || finalSku;
          }

          if (!finalBarcode) {
            finalBarcode = generate6DigitCode();
          }
          if (!finalSku) {
            finalSku = finalBarcode;
          }

          const hasNoUnits = unitsList.length === 0;
          const productData = {
            name: productNameClean,
            barcode: finalBarcode,
            sku: finalSku,
            price: Number(item.Price || item.price || 0),
            cost: Number(item.Cost || item.cost || 0),
            stock: Number(item.Stock || item.stock || 0),
            lowStockThreshold: Number(item.Threshold || 5),
            category: String(item.Category || item.category || 'General').trim(),
            units: unitsList,
            packageType: hasNoUnits ? null : (item.PackageType || item.packageType || ''),
            packageCapacity: hasNoUnits ? null : (Number(item.PackageCapacity || item.packageCapacity || 0)),
            productsPerCarton: hasNoUnits ? null : (Number(item.ProductsPerCarton || item.productsPerCarton || 0)),
            storeId: profile?.storeId || '',
            updatedAt: new Date().toISOString()
          };

          if (productData.name) {
            if (existingProduct) {
              await updateProduct({ id: existingProduct.id, ...productData });
            } else {
              await addProduct(productData);
            }
          }
        }
        alert("SUCCESS: Excel import completed.");
      } catch (err) {
        alert("IMPORT ERROR: Check file format.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } 
  });

  const ProductRow = ({ index, style }: { index: number, style: React.CSSProperties }) => {
    const product = filteredProducts[index];
    if (!product) return null;
    return (
      <div style={style} className="flex items-center px-6 border-b border-slate-50 hover:bg-slate-50 transition-colors group">
         <div className="w-16 shrink-0 text-[10px] font-mono text-slate-400">#{product.id.substring(0, 6)}</div>
         <div className="flex-1 min-w-0 pr-4 font-black uppercase text-xs truncate">{product.name}</div>
         <div className="w-32 shrink-0 font-mono text-xs">{cleanTo6Digits(product.barcode)}</div>
         <div className="w-24 shrink-0 text-xs font-bold text-slate-500">{product.category}</div>
         <div className="w-24 shrink-0 font-mono text-xs text-right whitespace-nowrap">{formatCurrency(product.price)}</div>
         <div className={cn("w-20 shrink-0 text-right font-mono text-xs font-black", product.stock <= product.lowStockThreshold ? 'text-rose-500' : 'text-slate-900')}>
            {product.stock}
         </div>
         <div className="w-24 shrink-0 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => { setEditingProduct(product); setIsModalOpen(true); }} className="p-2 bg-slate-100 rounded-lg hover:bg-slate-900 hover:text-white transition-all"><Edit className="h-3 w-3" /></button>
            {deletingProductId === product.id ? (
              <div className="flex items-center gap-1 bg-rose-50/50 p-1 rounded-lg border border-rose-100 shrink-0 select-none">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProduct(product.id)
                      .then(() => setDeletingProductId(null))
                      .catch(err => alert("Error: " + err.message));
                  }}
                  className="px-2 py-1 text-[8px] bg-rose-600 text-white font-black uppercase tracking-wider rounded-md hover:bg-rose-700 transition active:scale-95"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingProductId(null);
                  }}
                  className="p-1 text-slate-500 hover:text-slate-900 transition"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingProductId(product.id);
                }}
                className="p-2 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-500 hover:text-white transition-all"
                title="Delete Product"
              >
                <Trash className="h-3 w-3" />
              </button>
            )}
         </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-12 pb-24 px-4 sm:px-6">
      {/* Header with Stats */}
      <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
        <div className="space-y-4">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2"
          >
             <div className="p-2 bg-emerald-500 rounded-lg shadow-lg">
                <Warehouse className="h-4 w-4 text-white" />
             </div>
             <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">Enterprise Inventory</span>
          </motion.div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-slate-950 leading-none uppercase italic">Product Control</h1>
          
          {/* Quick Stats Banner */}
          <div className="flex flex-wrap gap-6 pt-4 text-slate-950">
             <div className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-950 mb-1 opacity-60">Total Valuation</span>
                <span className="text-xl font-black font-mono text-emerald-600 italic">{formatCurrency(stockStats.totalValue)}</span>
             </div>
             <div className="w-px h-10 bg-slate-100" />
             <div className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-950 mb-1 opacity-60">Stock Items</span>
                <span className="text-xl font-black font-mono text-slate-950">{stockStats.totalStock} <span className="text-[10px] text-slate-400">units</span></span>
             </div>
             <div className="w-px h-10 bg-slate-100" />
             <div className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-950 mb-1 opacity-60">Product Count</span>
                <span className="text-xl font-black font-mono text-slate-950">{stockStats.totalItems}</span>
             </div>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 lg:pt-8">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <span className="flex items-center justify-center space-x-3 bg-white border-2 border-slate-100 text-slate-600 px-8 py-5 rounded-3xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all cursor-pointer">
                <Download className="h-4 w-4" />
                <span>Export</span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl p-2 border-slate-100 shadow-xl">
               <DropdownMenuItem onClick={() => exportProductsToExcel(products)} className="rounded-xl px-4 py-3 cursor-pointer">
                  <FileSpreadsheet className="mr-3 h-4 w-4 text-emerald-500" />
                  <span className="font-bold">Excel Spreadshet</span>
               </DropdownMenuItem>
               <DropdownMenuItem onClick={() => exportProductsToPDF(products, profile?.storeName || 'Store')} className="rounded-xl px-4 py-3 cursor-pointer">
                  <FileText className="mr-3 h-4 w-4 text-rose-500" />
                  <span className="font-bold">PDF Document</span>
               </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button 
            onClick={downloadTemplate}
            className="flex items-center justify-center space-x-3 bg-white border-2 border-slate-100 text-slate-950 px-8 py-5 rounded-3xl text-sm font-black uppercase tracking-widest hover:border-slate-900 transition-all active:scale-95"
          >
            <Download className="h-4 w-4 text-emerald-600" />
            <span>Template</span>
          </button>

           {profile?.role !== 'staff' && profile?.role !== 'cashier' && (
             <div className="flex gap-4">
               <button 
                 onClick={() => setIsLocationManagerOpen(true)}
                 className="flex items-center justify-center space-x-3 bg-blue-700 hover:bg-blue-800 text-white px-8 py-5 rounded-3xl text-sm font-black uppercase tracking-widest transition-all select-none font-sans cursor-pointer h-[58px]"
               >
                 <Warehouse className="h-4 w-4" />
                 <span>Manage Locations</span>
               </button>
               <button 
                 onClick={() => { setEditingProduct(null); setIsModalOpen(true); }}
                 className="flex items-center justify-center space-x-3 bg-slate-900 text-white px-10 py-5 rounded-3xl text-sm font-black uppercase tracking-widest shadow-2xl shadow-slate-900/20 active:scale-95 transition-all group shrink-0 h-[58px]"
               >
                 <Plus className="h-5 w-5" />
                 <span>New Product</span>
               </button>
             </div>
           )}
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex bg-slate-100 p-1.5 rounded-[2rem] max-w-md border border-slate-200/50">
        <button 
          onClick={() => setActiveTab('products')}
          className={cn(
            "flex-1 py-4.5 text-[10px] font-black uppercase tracking-[0.2em] rounded-[1.5rem] transition-all cursor-pointer text-center", 
            activeTab === 'products' ? "bg-white text-slate-900 shadow-md" : "text-slate-400 hover:text-slate-700"
          )}
        >
          All Products
        </button>
        <button 
          onClick={() => setActiveTab('locations')}
          className={cn(
            "flex-1 py-4.5 text-[10px] font-black uppercase tracking-[0.2em] rounded-[1.5rem] transition-all cursor-pointer text-center", 
            activeTab === 'locations' ? "bg-white text-slate-900 shadow-md" : "text-slate-400 hover:text-slate-700"
          )}
        >
          Locations Stock
        </button>
        <button 
          onClick={() => setActiveTab('transfers')}
          className={cn(
            "flex-1 py-4.5 text-[10px] font-black uppercase tracking-[0.2em] rounded-[1.5rem] transition-all cursor-pointer text-center", 
            activeTab === 'transfers' ? "bg-white text-slate-900 shadow-md" : "text-slate-400 hover:text-slate-700"
          )}
        >
          Transfers Log
        </button>
      </div>

      {activeTab === 'products' && (
        <>
          {/* Toolbar & Filters */}
          <div className="vibrant-card p-6 flex flex-col xl:flex-row items-center gap-6">
        <div className="relative flex-1 w-full group">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-emerald-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Search by name, barcode or SKU..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-16 pr-8 py-5 bg-slate-50/50 border-2 border-slate-50 rounded-[2rem] text-sm focus:outline-none focus:border-slate-200 focus:bg-white transition-all font-black text-slate-900 placeholder:text-slate-500"
          />
        </div>
        <div className="flex items-center gap-3 w-full xl:w-auto">
          <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-100">
             <button onClick={() => setViewMode('grid')} className={cn("p-4 rounded-xl transition-all", viewMode === 'grid' ? 'bg-white shadow-sm text-slate-950' : 'text-slate-300')}><LayoutGrid className="h-4 w-4" /></button>
             <button onClick={() => setViewMode('table')} className={cn("p-4 rounded-xl transition-all", viewMode === 'table' ? 'bg-white shadow-sm text-slate-950' : 'text-slate-300')}><ListIcon className="h-4 w-4" /></button>
          </div>
          <button 
             onClick={() => setFilterMode(filterMode === 'all' ? 'low' : filterMode === 'low' ? 'out' : 'all')}
             className={cn("flex-1 xl:flex-none flex items-center justify-center px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all", 
               filterMode === 'all' ? 'bg-white border-2 border-slate-100 text-slate-400' : 
               filterMode === 'low' ? 'bg-amber-50 border-2 border-amber-200 text-amber-600' : 'bg-rose-50 border-2 border-rose-200 text-rose-600'
             )}
          >
            {filterMode === 'low' ? <TrendingDown className="h-3 w-3 mr-2" /> : filterMode === 'out' ? <Zap className="h-3 w-3 mr-2" /> : <Filter className="h-3 w-3 mr-2" />}
            {filterMode === 'all' ? 'Filters' : filterMode === 'low' ? 'Low Stock' : 'Out of Stock'}
          </button>
        </div>
      </div>

      {/* Main Content View */}
      <div className="min-h-[400px]">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {Array(6).fill(0).map((_, i) => <div key={i} className="h-64 bg-white/50 rounded-[3rem] animate-pulse" />)}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-32 flex flex-col items-center text-center">
             <div className="p-10 bg-white rounded-[3rem] shadow-vibrant mb-6"><Package className="h-16 w-16 text-slate-100" /></div>
             <h3 className="text-2xl font-black uppercase">No Matching Data</h3>
             <p className="text-slate-400 font-bold italic">Adjust your search or filters to see results.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6 text-xs font-black uppercase">
             {paginatedProducts.map((p, i) => (
                <motion.div 
                  key={`inv-grid-${p.id || 'unkn'}-${i}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="vibrant-card p-6 flex flex-col group border-slate-100/50"
                >
                    <div className="flex justify-between items-start mb-4">
                       <div className="flex flex-col min-w-0">
                          <Badge variant="outline" className="w-fit mb-1 text-[7px] rounded-lg border-slate-100 bg-slate-50 text-slate-950">{p.category}</Badge>
                          <h3 className="text-sm font-black text-slate-950 tracking-tight truncate">{p.name}</h3>
                       </div>
                       <DropdownMenu>
                         <DropdownMenuTrigger>
                           <span className="p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-center"><MoreHorizontal className="h-3 w-3 text-slate-500" /></span>
                         </DropdownMenuTrigger>
                         <DropdownMenuContent className="rounded-xl p-2">
                            <DropdownMenuItem 
                              onClick={() => { 
                                setRestockProduct(p); 
                                setRestockAmount(0);
                                setIsRestockModalOpen(true); 
                              }} 
                              className="rounded-lg py-2 cursor-pointer font-bold text-emerald-600"
                            >
                              <Zap className="mr-2 h-3 w-3" /> Restock
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setEditingProduct(p); setIsModalOpen(true); }} className="rounded-lg py-2 cursor-pointer font-bold"><Edit className="mr-2 h-3 w-3" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation();
                                if (deletingProductId === p.id) {
                                  deleteProduct(p.id)
                                    .then(() => setDeletingProductId(null))
                                    .catch(err => alert("Error: " + err.message));
                                } else {
                                  setDeletingProductId(p.id);
                                  setTimeout(() => setDeletingProductId(null), 5000);
                                }
                              }} 
                              className={cn(
                                "rounded-lg py-2 cursor-pointer font-bold transition-all",
                                deletingProductId === p.id ? "text-white bg-rose-600 focus:bg-rose-700 font-extrabold" : "text-rose-500"
                              )}
                            >
                              <Trash className="mr-2 h-3 w-3" /> 
                              {deletingProductId === p.id ? "Confirm Delete!" : "Delete"}
                            </DropdownMenuItem>
                         </DropdownMenuContent>
                       </DropdownMenu>
                    </div>
                   
                   <div className="space-y-3 mb-4 flex-1">
                      <div className="flex justify-between items-center p-2.5 bg-slate-50/50 rounded-xl border border-slate-100">
                         <span className="text-slate-950 text-[8px]">Stock Level</span>
                         <div className="flex items-center gap-1.5">
                            <span className={cn("text-sm font-mono", p.stock <= p.lowStockThreshold ? 'text-rose-600' : 'text-slate-950')}>{p.stock}</span>
                            {p.stock <= p.lowStockThreshold && <AlertTriangle className="h-3 w-3 text-rose-600" />}
                         </div>
                      </div>
                      {p.units && p.units.length > 0 && (
                        <div className="space-y-1">
                           <div className="flex items-center gap-1.5">
                              <Layers className="h-3 w-3 text-emerald-600" />
                              <span className="text-[8px] text-slate-950 font-black">{p.units.length} VARIATIONS</span>
                           </div>
                           <div className="flex flex-wrap gap-1">
                              {p.units.slice(0, 2).map((u, idx) => (
                                <span key={idx} className="text-[6px] bg-emerald-50 text-emerald-700 px-1 rounded font-black">{u.name}</span>
                              ))}
                              {p.units.length > 2 && <span className="text-[6px] text-slate-400 font-black">+{p.units.length - 2} more</span>}
                           </div>
                        </div>
                      )}
                   </div>

                   <div className="flex justify-between items-end border-t border-slate-100 pt-4">
                      <div className="flex flex-col">
                         <span className="text-slate-950 text-[8px] font-black uppercase tracking-widest mb-1 opacity-60">Price</span>
                         <span className="text-xl font-black text-emerald-600 italic font-mono leading-none">{formatCurrency(p.price)}</span>
                      </div>
                      <div className="text-right">
                         <p className="text-slate-950 text-[8px] font-black uppercase tracking-widest mb-1 opacity-60">Base Stock</p>
                         <p className={cn("font-mono font-black text-xs", p.stock <= p.lowStockThreshold ? 'text-rose-600' : 'text-slate-950')}>{p.stock}</p>
                      </div>
                   </div>
                </motion.div>
             ))}
          </div>
        ) : (
          <div className="vibrant-card p-0 overflow-hidden border border-slate-200 bg-white rounded-2xl shadow-sm">
            {/* Top Synchronized Scrollbar for easier horizontal scrolling from the top */}
            <div 
              ref={topScrollContainerRef} 
              onScroll={handleTopScroll} 
              className="overflow-x-auto w-full bg-slate-50 border-b border-slate-200 custom-scrollbar"
              style={{ scrollbarWidth: 'thin' }}
            >
              <div style={{ width: `${tableScrollWidth}px` }} className="h-2" />
            </div>

            <div 
              ref={tableContainerRef}
              onScroll={handleTableScroll}
              className="overflow-x-auto w-full custom-scrollbar pb-4"
            >
              <table className="w-full border-collapse text-left text-xs font-medium text-slate-700 min-w-[1500px]">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-900 border-b border-slate-200 select-none">
                    <th className="p-3 text-center border-r border-slate-200 bg-slate-200/50 text-[9px] font-bold text-slate-400 w-12 sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.03)]">Row</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider font-mono text-slate-600 w-24">A: Barcode</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600">B: Product Name</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 w-32">C: Category</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 w-32 text-right">D: Unit Cost</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 w-32 text-right">E: Sell Price</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 w-32 text-right">F: Stock Level</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 w-36">G: Variation</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 w-36 text-right">H: Price</th>
                    <th className="p-3 border-r border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 w-40">I: Carton/crate</th>
                    <th className="p-3 text-center text-[10px] font-black uppercase tracking-wider text-slate-600 w-36 border-r border-slate-200">J: Adjust / Edit</th>
                    <th className="p-3 text-center text-[10px] font-black uppercase text-rose-600 tracking-wider bg-rose-50/50 w-28">K: Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((p, idx) => {
                    const price = p.price || 0;
                    const cost = p.cost || 0;
                    
                    // Stock warnings
                    const isOutOfStock = p.stock === 0;
                    const isLowStock = p.stock <= p.lowStockThreshold;

                    return (
                      <tr 
                        key={`inv-table-row-${p.id || 'unkn'}-${idx}`} 
                        onClick={() => {
                          setEditingProduct(p);
                          setIsModalOpen(true);
                        }}
                        className="hover:bg-slate-50/70 border-b border-slate-200 transition-colors group cursor-pointer"
                      >
                        {/* Row Index Sticky Column */}
                        <td className="p-3 text-center bg-slate-50/50 border-r border-slate-200 text-[10px] font-black font-mono text-slate-400 sticky left-0 z-10 select-none shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                          {((currentPage - 1) * itemsPerPage) + idx + 1}
                        </td>
                        
                        {/* A: Barcode */}
                        <td className="p-3 border-r border-slate-200 font-mono text-slate-950 font-bold whitespace-nowrap" title={cleanTo6Digits(p.barcode || p.sku || '-')}>
                          {cleanTo6Digits(p.barcode || p.sku || '-')}
                        </td>

                        {/* B: Product Name */}
                        <td className="p-3 border-r border-slate-200 text-slate-950 font-black">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center overflow-hidden border border-slate-100 shrink-0">
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                              ) : (
                                <Package className="h-3.5 w-3.5 text-slate-400" />
                              )}
                            </div>
                            <span className="truncate max-w-[280px] uppercase font-black" title={p.name}>{p.name}</span>
                          </div>
                        </td>

                        {/* C: Category */}
                        <td className="p-3 border-r border-slate-200">
                          <Badge variant="outline" className="text-[9px] px-2 py-0.5 rounded-md font-extrabold bg-slate-50 text-slate-600 border-slate-100">
                            {p.category}
                          </Badge>
                        </td>

                        {/* D: Unit Cost */}
                        <td className="p-3 border-r border-slate-200 text-right font-mono font-bold text-slate-500">
                          {cost > 0 ? formatCurrency(cost) : '₦0.00'}
                        </td>

                        {/* E: Sell Price */}
                        <td className="p-3 border-r border-slate-200 text-right font-mono font-black text-emerald-600">
                          {formatCurrency(price)}
                        </td>

                        {/* F: Stock Level with safe background highlighting */}
                        <td className={cn(
                          "p-3 border-r border-slate-200 text-right font-mono font-black",
                          isOutOfStock ? "bg-rose-50 text-rose-600" : isLowStock ? "bg-amber-50 text-amber-600" : "text-slate-900 bg-emerald-50/10"
                        )}>
                          <div className="flex items-center justify-end gap-1.5">
                            <span>{p.stock}</span>
                            {isOutOfStock ? (
                              <span className="text-[8px] bg-rose-600 text-white px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider scale-90">OUT</span>
                            ) : isLowStock ? (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            ) : null}
                          </div>
                        </td>

                        {/* G: Variation */}
                        <td className="p-3 border-r border-slate-200 text-slate-600" onClick={(e) => e.stopPropagation()}>
                          {p.units && p.units.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]" onClick={(e) => e.stopPropagation()}>
                              {p.units.map((u, ui) => (
                                <span key={ui} className="text-[10px] bg-slate-50 border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-black whitespace-nowrap uppercase tracking-wide">
                                  {u.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-300 font-mono text-[10px]">-</span>
                          )}
                        </td>

                        {/* H: Price */}
                        <td className="p-3 border-r border-slate-200 text-right font-mono font-black text-slate-900" onClick={(e) => e.stopPropagation()}>
                          {p.units && p.units.length > 0 ? (
                            <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {p.units.map((u, ui) => (
                                <span key={ui} className="text-xs font-mono font-bold text-slate-700 uppercase whitespace-nowrap py-0.5">
                                  {formatCurrency(u.price)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-300 font-mono text-[10px]">-</span>
                          )}
                        </td>

                        {/* I: Carton/crate */}
                        <td className="p-3 border-r border-slate-200 font-mono text-slate-700 font-bold whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {p.packageType ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] px-1.5 py-0.5 font-black uppercase border border-slate-200 rounded text-slate-600 bg-slate-50">{p.packageType}</span>
                              {p.packageCapacity || p.productsPerCarton ? (
                                <span className="text-xs font-bold text-slate-500">({p.packageCapacity || p.productsPerCarton} units)</span>
                              ) : null}
                            </div>
                          ) : p.productsPerCarton ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] px-1.5 py-0.5 font-black uppercase border border-slate-200 rounded text-slate-600 bg-slate-50">Carton</span>
                              <span className="text-xs font-bold text-slate-500">({p.productsPerCarton} units)</span>
                            </div>
                          ) : (
                            <span className="text-slate-300 font-mono text-[10px]">-</span>
                          )}
                        </td>

                        {/* J: Adjust / Edit */}
                        <td className="p-2 text-center border-r border-slate-200 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5 align-middle">
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRestockProduct(p);
                                setRestockAmount(0);
                                setIsRestockModalOpen(true);
                              }}
                              className="p-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-600 hover:bg-emerald-600 hover:text-white transition-colors"
                              title="Restock Item"
                            >
                              <Zap className="h-3 w-3" />
                            </button>
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingProduct(p);
                                setIsModalOpen(true);
                              }}
                              className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-900 hover:text-white transition-colors"
                              title="Edit Product"
                            >
                              <Edit className="h-3 w-3" />
                            </button>
                          </div>
                        </td>

                        {/* K: Delete */}
                        <td className="p-2 text-center bg-rose-50/20 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center">
                            {deletingProductId === p.id ? (
                              <div className="flex items-center gap-1 bg-rose-100/50 p-1 rounded-lg border border-rose-200 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteProduct(p.id)
                                      .then(() => setDeletingProductId(null))
                                      .catch(err => alert("Error: " + err.message));
                                  }}
                                  className="px-2 py-1 text-[8px] bg-rose-600 text-white font-black uppercase tracking-wider rounded-md hover:bg-rose-700 transition active:scale-95 shadow-sm"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeletingProductId(null);
                                  }}
                                  className="p-1 text-slate-500 hover:text-slate-900 transition"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingProductId(p.id);
                                }}
                                className="p-1.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-500 hover:bg-rose-500 hover:text-white transition-all transform hover:scale-110 active:scale-95 duration-150"
                                title="Delete Product"
                              >
                                <Trash className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Dynamic Pagination Controls */}
        {filteredProducts.length > itemsPerPage && (
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl shadow-sm text-xs font-sans">
            <span className="text-[#333333] font-medium leading-none">
              Showing <strong className="font-bold">{((currentPage - 1) * itemsPerPage) + 1}</strong> to <strong className="font-bold">{Math.min(currentPage * itemsPerPage, filteredProducts.length)}</strong> of <strong className="font-bold">{filteredProducts.length}</strong> products
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="h-8 px-3 border border-[#CCCCCC] bg-white text-slate-700 font-bold hover:bg-[#F2F2F7] disabled:opacity-40 rounded-lg transition-colors select-none font-sans"
              >
                Prev
              </button>
              <span className="h-8 px-3 flex items-center justify-center font-bold text-[#007AFF] bg-[#007AFF]/10 rounded-lg font-mono min-w-8 text-center select-none border border-[#007AFF]/20">
                {currentPage}
              </span>
              <button
                type="button"
                disabled={currentPage === Math.ceil(filteredProducts.length / itemsPerPage)}
                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredProducts.length / itemsPerPage), prev + 1))}
                className="h-8 px-3 border border-[#CCCCCC] bg-white text-slate-700 font-bold hover:bg-[#F2F2F7] disabled:opacity-40 rounded-lg transition-colors select-none font-sans"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Import / Dropzone */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div {...getRootProps()} className={cn(
          "vibrant-card p-10 border-dashed border-2 flex flex-col items-center justify-center text-center transition-all cursor-pointer h-full",
          isDragActive ? "border-emerald-500 bg-emerald-50/30" : "border-slate-100 hover:border-slate-200"
        )}>
          <input {...getInputProps()} />
          <div className="p-4 bg-slate-50 rounded-full mb-4"><Upload className="h-6 w-6 text-slate-200" /></div>
          <h4 className="text-sm font-black uppercase mb-1">Import from Excel</h4>
          <p className="text-slate-400 text-[10px] italic font-bold">Drop .xlsx file here</p>
        </div>
        
        <div className="vibrant-card p-10 flex flex-col items-center justify-center text-center gap-4 border-2 border-slate-50">
          <div className="p-4 bg-emerald-50 rounded-full"><FileSpreadsheet className="h-6 w-6 text-emerald-500" /></div>
          <div>
            <h4 className="text-sm font-black uppercase mb-1">First time?</h4>
            <p className="text-slate-400 text-[10px] italic font-bold">Download our template to ensure correct format</p>
          </div>
          <button 
            onClick={downloadTemplate}
            className="px-6 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all"
          >
            Download Template
          </button>
        </div>
      </div>
    </>
  )}

      {activeTab === 'locations' && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* Financial summary metrics calculated per location */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {locations.map((loc) => {
              // calculate valuation metrics for this location
              let totalItemsCount = 0;
              let totalValuationCost = 0;
              let totalValuationRetail = 0;

              products.forEach(p => {
                const qty = stockMap.get(`${p.id}_${loc.id}`) ?? 0;
                if (qty > 0) {
                  totalItemsCount += qty;
                  totalValuationCost += qty * (p.cost || 0);
                  totalValuationRetail += qty * (p.price || 0);
                }
              });

              return (
                <div 
                  key={`val-card-${loc.id}`} 
                  onClick={() => setSelectedLocationId(loc.id)}
                  className={cn(
                    "vibrant-card p-6 flex flex-col justify-between cursor-pointer border-2 transition-all rounded-[2rem] bg-white",
                    selectedLocationId === loc.id ? "border-blue-500 bg-blue-50/10 shadow-2xl" : "border-slate-100 hover:border-slate-200"
                  )}
                >
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl"><Warehouse className="h-4 w-4" /></div>
                      <span className="px-2.5 py-1 text-[8px] font-black uppercase tracking-wider rounded-lg border bg-green-50 border-green-200 text-green-700">{loc.status}</span>
                    </div>
                    <h3 className="font-extrabold text-slate-800 text-base uppercase tracking-tight">{loc.name}</h3>
                    <p className="text-[9px] text-slate-400 font-bold mb-4 uppercase mt-0.5">{loc.description || 'Active storage level'}</p>
                  </div>
                  
                  <div className="border-t border-slate-100 pt-4 mt-2 grid grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Asset Value (Cost)</span>
                      <span className="text-sm font-black font-mono text-slate-900">{formatCurrency(totalValuationCost)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Sales Worth</span>
                      <span className="text-sm font-black font-mono text-emerald-600">{formatCurrency(totalValuationRetail)}</span>
                    </div>
                  </div>
                  
                  <div className="mt-3 text-[9px] font-bold text-slate-400 italic">
                    {totalItemsCount} unit(s) currently stocked
                  </div>
                </div>
              );
            })}
          </div>

          {/* Table display of products at selected location */}
          <div className="vibrant-card p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100/50 pb-6">
              <div>
                <h3 className="font-black uppercase text-lg text-slate-900">
                  Stock Sheet: {locations.find(l => l.id === selectedLocationId)?.name || 'Default Storage'}
                </h3>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mt-0.5">
                  Generate offline report sheet or execute audits for physical stock take
                </p>
              </div>
              
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={() => exportLocationReportExcel(selectedLocationId)}
                  className="flex-1 sm:flex-none flex items-center justify-center space-x-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-emerald-100 transition-all cursor-pointer"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Download Excel</span>
                </button>
                <button
                  onClick={() => exportLocationReportPDF(selectedLocationId)}
                  className="flex-1 sm:flex-none flex items-center justify-center space-x-2 bg-rose-50 text-rose-700 border border-rose-200 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-rose-100 transition-all cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Download PDF Report</span>
                </button>
              </div>
            </div>

            {/* Search and Filters inside Stock Sheet */}
            <div className="flex flex-col sm:flex-row gap-4 items-center bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search stock sheet by name, SKU or barcode..." 
                  value={locationsSearch}
                  onChange={(e) => setLocationsSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-blue-300 font-bold text-slate-800 placeholder:text-slate-400 uppercase"
                />
              </div>
              <div className="w-full sm:w-48">
                <select
                  value={locationsCategory}
                  onChange={(e) => setLocationsCategory(e.target.value)}
                  className="w-full px-3 py-3 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase text-slate-700 focus:outline-none focus:border-blue-300"
                >
                  <option value="ALL">All Categories</option>
                  {uniqueCategoriesFromProducts.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto rounded-[2rem] border border-slate-100 bg-white">
              <table className="w-full text-left font-sans text-xs">
                <thead>
                  <tr className="bg-slate-50 uppercase text-[9px] font-black tracking-widest text-slate-400 border-b border-slate-100">
                    <th className="p-4 text-center">#</th>
                    <th className="p-4">SKU / Barcode</th>
                    <th className="p-4">Product Name</th>
                    <th className="p-4">Category</th>
                    <th className="p-4 text-right">Cost Price</th>
                    <th className="p-4 text-right">Selling Price</th>
                    <th className="p-4 text-center">Location Quantity</th>
                    <th className="p-4 text-center">Packages Remaining</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {paginatedLocProducts.map((p, idx) => {
                    const localQty = stockMap.get(`${p.id}_${selectedLocationId}`) ?? 0;
                    const threshold = p.lowStockThreshold || 10;
                    let statusColor = "bg-green-50 text-green-700 border-green-200";
                    let statusLabel = "Ok";

                    if (localQty === 0) {
                      statusColor = "bg-rose-50 text-rose-700 border-rose-200";
                      statusLabel = "Out of Stock";
                    } else if (localQty <= threshold) {
                      statusColor = "bg-amber-50 text-amber-700 border-amber-200";
                      statusLabel = "Low Stock";
                    }

                    return (
                      <tr key={`loc-sh-p-${p.id}`} className="hover:bg-slate-50/35 transition-colors">
                        <td className="p-4 text-center font-bold text-slate-400">{((locationsPage - 1) * LOC_ITEMS_PER_PAGE) + idx + 1}</td>
                        <td className="p-4 font-mono text-[10px] whitespace-nowrap">
                          <div>SKU: {cleanTo6Digits(p.sku) || 'N/A'}</div>
                          <div className="text-slate-400 mt-0.5">BC: {cleanTo6Digits(p.barcode) || 'N/A'}</div>
                        </td>
                        <td className="p-4 font-bold text-slate-900 uppercase tracking-tight">{p.name}</td>
                        <td className="p-4 font-bold uppercase text-[10px] text-slate-500">{p.category || 'Uncategorized'}</td>
                        <td className="p-4 text-right font-mono font-bold text-slate-500">{formatCurrency(p.cost || 0)}</td>
                        <td className="p-4 text-right font-mono font-bold text-slate-900">{formatCurrency(p.price || 0)}</td>
                        <td className="p-4 text-center font-mono font-black text-xs leading-none">
                          <span className={cn(
                            "px-2.5 py-1 rounded-lg text-[10px] font-black border",
                            localQty === 0 ? "bg-rose-50 border-rose-200 text-rose-600" : 
                            localQty <= threshold ? "bg-amber-50 border-amber-200 text-amber-600" : 
                            "bg-emerald-50 border-emerald-200 text-emerald-600"
                          )}>
                            {localQty} Unit(s)
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {(() => {
                            const capacity = p.packageCapacity || p.productsPerCarton || 0;
                            const pkgName = p.packageType || 'Carton';
                            if (capacity > 1) {
                              const fullPkgs = Math.floor(localQty / capacity);
                              const remainingUnits = localQty % capacity;
                              if (fullPkgs === 0 && remainingUnits === 0) {
                                return <span className="text-slate-300 font-medium text-[10px]">-</span>;
                              }
                              return (
                                <div className="flex flex-col items-center justify-center">
                                  <span className="font-sans font-black text-indigo-600 text-[11px] leading-tight bg-indigo-50/50 px-2.5 py-1 rounded border border-indigo-100/50">
                                    {fullPkgs} {pkgName}{fullPkgs !== 1 ? 's' : ''}
                                  </span>
                                  {remainingUnits > 0 && (
                                    <span className="text-[9px] text-slate-400 font-bold font-sans mt-1">
                                      + {remainingUnits} pcs
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return <span className="text-slate-400 italic text-[9px] font-semibold uppercase tracking-tight">No pack qty</span>;
                          })()}
                        </td>
                        <td className="p-4 text-center">
                          <span className={cn("px-2.5 py-1 border text-[8px] font-black uppercase tracking-wider rounded-lg", statusColor)}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => {
                              setStocktakeProductId(p.id);
                              setStocktakeCount(String(localQty));
                            }}
                            className="bg-slate-900 hover:bg-black text-white text-[9px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl active:scale-95 transition-all cursor-pointer"
                          >
                            Audited Count
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {paginatedLocProducts.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-20 text-center text-slate-300 italic">No products matched current filters or exist in this location.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {filteredLocProducts.length > LOC_ITEMS_PER_PAGE && (
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100 text-xs text-slate-500 font-bold">
                <span>
                  Showing <strong className="font-bold">{((locationsPage - 1) * LOC_ITEMS_PER_PAGE) + 1}</strong> to <strong className="font-bold">{Math.min(locationsPage * LOC_ITEMS_PER_PAGE, filteredLocProducts.length)}</strong> of <strong className="font-bold">{filteredLocProducts.length}</strong> products
                </span>
                <div className="flex gap-2">
                  <button 
                    disabled={locationsPage === 1}
                    onClick={() => setLocationsPage(prev => Math.max(1, prev - 1))}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase disabled:opacity-50 hover:bg-slate-50 transition-all cursor-pointer shadow-sm"
                  >
                    Prev
                  </button>
                  <button 
                    disabled={locationsPage === Math.ceil(filteredLocProducts.length / LOC_ITEMS_PER_PAGE)}
                    onClick={() => setLocationsPage(prev => Math.min(Math.ceil(filteredLocProducts.length / LOC_ITEMS_PER_PAGE), prev + 1))}
                    className="px-4 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black uppercase disabled:opacity-50 hover:bg-black transition-all cursor-pointer shadow-sm"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'transfers' && (
        <div className="space-y-8 animate-in fade-in duration-200">
          <div className="vibrant-card p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b-4 border-slate-900 bg-white">
            <div>
              <h2 className="text-3xl font-black uppercase tracking-tight text-slate-900">Warehouse ←→ Supermarket Relocator</h2>
              <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">
                Record and execute real-time physical stock distribution securely
              </p>
            </div>
            <button
              onClick={() => setIsTransferModalOpen(true)}
              className="px-8 py-5 bg-blue-700 hover:bg-blue-800 text-white rounded-3xl font-black uppercase tracking-wider text-xs shadow-xl shadow-blue-700/20 active:scale-95 transition-all flex items-center gap-2 cursor-pointer h-[58px]"
            >
              <ArrowLeftRight className="h-4 w-4" />
              <span>Initiate Stock Transfer</span>
            </button>
          </div>

          <div className="vibrant-card p-6 bg-white">
            <h3 className="font-black text-[10px] uppercase text-slate-400 mb-4 tracking-widest">Historical Transfer Audit Trail</h3>
            <div className="overflow-x-auto rounded-[2rem] border border-slate-100 bg-white">
              <table className="w-full text-left font-sans text-xs">
                <thead>
                  <tr className="bg-slate-50 uppercase text-[9px] font-black tracking-widest text-slate-400 border-b border-slate-100">
                    <th className="p-4 text-center">#</th>
                    <th className="p-4">Date & Time</th>
                    <th className="p-4">Product Name</th>
                    <th className="p-4">From Location</th>
                    <th className="p-4">→ To Location</th>
                    <th className="p-4 text-center">Quantity</th>
                    <th className="p-4">Transferred By</th>
                    <th className="p-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {transfers.map((t, idx) => {
                    const fromLocName = locations.find(l => l.id === t.fromLocationId)?.name || 'Secondary Source';
                    const toLocName = locations.find(l => l.id === t.toLocationId)?.name || 'Secondary Destination';
                    const dateFormatted = t.createdAt 
                      ? new Date((t.createdAt as any).seconds * 1000).toLocaleString() 
                      : 'Recently Added';

                    return (
                      <tr key={`tr-log-${t.id || idx}`} className="hover:bg-slate-50/40 transition-colors">
                        <td className="p-4 text-center font-bold text-slate-400">{idx + 1}</td>
                        <td className="p-4 font-mono text-[10px] whitespace-nowrap text-slate-500">{dateFormatted}</td>
                        <td className="p-4 font-bold text-slate-900 uppercase tracking-tight">
                          {products.find(p => p.id === t.productId)?.name || 'Unknown Product'}
                        </td>
                        <td className="p-4 font-extrabold text-[#D9381E] uppercase text-[10px]">{fromLocName}</td>
                        <td className="p-4 font-extrabold text-blue-700 uppercase text-[10px]">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-slate-400 font-normal">→</span> {toLocName}
                          </span>
                        </td>
                        <td className="p-4 text-center font-mono font-black text-sm text-slate-900">{t.quantity} Units</td>
                        <td className="p-4 font-bold text-slate-600 uppercase text-[10px]">{t.transferredBy || 'Admin'}</td>
                        <td className="p-4 italic text-slate-400 max-w-[180px] truncate">{t.notes || 'Routine distribution'}</td>
                      </tr>
                    );
                  })}
                  {transfers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-20 text-center text-slate-300 italic uppercase font-bold text-[10px] tracking-widest">
                        No background transfers recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Stock Transfer creation modal dialog popup */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-8 bg-white border border-slate-100 shadow-2xl font-sans">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-black uppercase text-slate-950 tracking-tight flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-blue-700" />
              <span>Stock Relocation</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Deduct stock atomically from warehouse storage areas and balance it inside active sales floors.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleStockTransferSubmit} className="space-y-5">
            {transferError && (
              <div className="p-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl text-[10px] font-black uppercase tracking-wider leading-relaxed">
                ● TRANSFER ERROR: {transferError}
              </div>
            )}

            <div className="flex flex-col">
              <label className="text-[10px] font-black uppercase text-slate-500 mb-1">Select Product *</label>
              <select
                required
                value={transferProductId}
                onChange={(e) => {
                  setTransferProductId(e.target.value);
                  // auto select the first location with stock > 0 if available!
                  const pId = e.target.value;
                  const validSrc = locations.find(l => (stockMap.get(`${pId}_${l.id}`) ?? 0) > 0);
                  if (validSrc) setTransferFromLocId(validSrc.id);
                }}
                className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] bg-white rounded-xl px-3 text-xs uppercase font-bold outline-none"
              >
                <option value="">-- Choose Product to Move --</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} (Total In Stock: {p.stock || 0})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase text-slate-500 mb-1">From Location *</label>
                <select
                  required
                  value={transferFromLocId}
                  onChange={(e) => setTransferFromLocId(e.target.value)}
                  className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] bg-white rounded-xl px-3 text-xs uppercase font-bold outline-none"
                >
                  <option value="">-- Source --</option>
                  {locations.map(l => {
                    const srcQty = transferProductId ? (stockMap.get(`${transferProductId}_${l.id}`) ?? 0) : 0;
                    return (
                      <option key={l.id} value={l.id}>{l.name} ({srcQty} Avail)</option>
                    );
                  })}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="text-[10px] font-black uppercase text-slate-500 mb-1">To Location *</label>
                <select
                  required
                  value={transferToLocId}
                  onChange={(e) => setTransferToLocId(e.target.value)}
                  className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] bg-white rounded-xl px-3 text-xs uppercase font-bold outline-none"
                >
                  <option value="">-- Destination --</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-[10px] font-black uppercase text-slate-500 mb-1 font-sans">Transfer Quantity *</label>
              <input
                type="number"
                step="any"
                required
                min="0.01"
                placeholder="e.g. 15"
                value={transferQty}
                onChange={e => setTransferQty(e.target.value)}
                className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] bg-white rounded-xl px-3 text-xs font-bold outline-none font-sans"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-[10px] font-black uppercase text-slate-500 mb-1 font-sans">Audit / Reference Notes</label>
              <input
                type="text"
                placeholder="e.g. Move backstore crate to Shop Fridge floor"
                value={transferNotes}
                onChange={e => setTransferNotes(e.target.value)}
                className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] bg-white rounded-xl px-3 text-xs font-bold outline-none font-sans"
              />
            </div>

            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isTransferring}
                className="flex-1 py-4 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/10 cursor-pointer"
              >
                {isTransferring ? 'Relocating...' : 'Relocate Stock'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Physical Stock Audit count popup tool */}
      <Dialog open={stocktakeProductId !== null} onOpenChange={(open) => !open && setStocktakeProductId(null)}>
        <DialogContent className="max-w-sm rounded-[2rem] p-8 bg-white border border-slate-100 shadow-2xl font-sans">
          <DialogHeader className="mb-4 text-center flex flex-col items-center">
            <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-800 mb-3"><ClipboardCheck className="h-5 w-5" /></div>
            <DialogTitle className="text-xl font-black uppercase text-slate-950 tracking-tight leading-none">
              Physical Audit Count
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-[10px] uppercase font-bold mt-1.5 max-w-[240px] leading-relaxed text-center">
              Updating details for "{products.find(p => p.id === stocktakeProductId)?.name}" in "{locations.find(l => l.id === selectedLocationId)?.name || 'Default Storage'}"
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="flex flex-col text-center bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <span className="text-[10px] font-black uppercase text-slate-400 mb-1">Previous Tracked Count</span>
              <span className="text-2xl font-black font-mono text-slate-800">
                {stocktakeProductId ? (stockMap.get(`${stocktakeProductId}_${selectedLocationId}`) ?? 0) : 0} Units
              </span>
            </div>

            <div className="flex flex-col">
              <label className="text-[10px] font-black uppercase text-slate-500 mb-1.5 text-center">New Actual Audited count *</label>
              <input
                type="number"
                required
                min="0"
                placeholder="e.g. 50"
                value={stocktakeCount}
                onChange={e => setStocktakeCount(e.target.value)}
                className="h-12 border border-[#CCCCCC] focus:border-[#007AFF] text-center bg-white rounded-xl text-lg font-mono font-black uppercase outline-none"
              />
            </div>

            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={() => setStocktakeProductId(null)}
                className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const parsedCount = parseInt(stocktakeCount);
                    if (isNaN(parsedCount) || parsedCount < 0) {
                      throw new Error('Please enter a valid count index >= 0');
                    }
                    if (stocktakeProductId) {
                      await updateStock({
                        productId: stocktakeProductId,
                        locationId: selectedLocationId,
                        quantity: parsedCount,
                        lowStockThreshold: 10
                      });
                      setStocktakeProductId(null);
                    }
                  } catch (err: any) {
                    alert(err.message || 'Audit count adjustment failed');
                  }
                }}
                className="flex-1 py-4 bg-slate-950 hover:bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg cursor-pointer"
              >
                Adjust Stock
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Product Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl rounded-[3rem] p-8 bg-white flex flex-col max-h-[90vh] overflow-y-auto custom-scrollbar font-sans border-0 shadow-2xl">
          <DialogHeader className="mb-6 relative border-b border-slate-100 pb-4">
            <DialogTitle className="text-3xl font-black uppercase tracking-tight text-slate-900 leading-none">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable Body */}
          <div className="flex-1 space-y-8">
            {/* SECTION A: Basic Information */}
            <div className="border-b border-slate-100 pb-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4 uppercase tracking-wider text-xs">Basic Information</h3>
              
              <div className="space-y-4">
                {/* Field 1: Product Name */}
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-[#333333] mb-2 flex items-center">
                    Product Name <span className="text-[#FF3B30] ml-1">*</span>
                  </label>
                  <input 
                    required 
                    type="text"
                    value={formName} 
                    onChange={e => setFormName(e.target.value)} 
                    placeholder="Enter product name"
                    className={cn(
                      "h-10 border rounded-lg px-3 bg-white text-sm outline-none transition-colors w-full font-sans",
                      formErrors.name ? "border-[#FF3B30]" : "border-[#CCCCCC] focus:border-[#007AFF]"
                    )}
                  />
                  {formErrors.name && (
                    <span className="text-[#FF3B30] text-xs font-medium mt-1">{formErrors.name}</span>
                  )}
                </div>

                {/* Field 2: SKU (Optional) */}
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-[#333333] mb-2">SKU (Optional)</label>
                  <input 
                    type="text"
                    value={formSku} 
                    onChange={e => setFormSku(e.target.value)} 
                    placeholder="Auto-generate or leave blank"
                    className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-sm outline-none w-full font-sans uppercase"
                  />
                  <span className="text-[#8E8E93] text-xs font-normal mt-1 leading-normal">
                    Optional. Auto-generated if left blank. Prevents duplicates.
                  </span>
                </div>

                {/* Field 3: Category (Optional Select Dropdown) */}
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-[#333333] mb-2">Category (Optional)</label>
                  <select 
                    value={formCategory} 
                    onChange={e => {
                      if (e.target.value === '+++NEW+++') {
                        const newCat = window.prompt("Enter name of new category:");
                        if (newCat && newCat.trim()) {
                          setFormCategory(newCat.trim());
                        }
                      } else {
                        setFormCategory(e.target.value);
                      }
                    }} 
                    className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-xs outline-none w-full font-sans cursor-pointer font-medium"
                  >
                    <option value="">Select Category (Optional)</option>
                    {Array.from(new Set([
                      'General', 'Beverages', 'Snacks', 'Grocery', 'Dairy', 'Frozen', 'Household', 'Personal Care', 'Others',
                      ...uniqueCategoriesFromProducts,
                      formCategory
                    ].filter(Boolean))).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="+++NEW+++" className="font-bold text-blue-600 font-sans">+ Create New Category...</option>
                  </select>
                </div>
              </div>
            </div>

            {/* SECTION B: Base Unit */}
            <div className="border-b border-[#E5E5EA] pb-6">
              <h3 className="text-lg font-bold text-[#000000] mb-4">Base Unit</h3>

              <div className="space-y-4">
                {/* Field 4: Base Unit Picker */}
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-[#333333] mb-2 flex items-center">
                    Base Unit <span className="text-[#FF3B30] ml-1">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSelectingAdditionalUnit(false);
                      setIsUnitModalOpen(true);
                    }}
                    className={cn(
                      "h-10 border rounded-lg px-3 bg-white flex items-center justify-between text-sm w-full font-sans text-left transition-colors",
                      formErrors.baseUnit ? "border-[#FF3B30]" : "border-[#CCCCCC] focus:border-[#007AFF]"
                    )}
                  >
                    <span className={formBaseUnit ? "text-[#333333] font-medium" : "text-[#999999]"}>
                      {formBaseUnit || 'Select base unit'}
                    </span>
                    <ChevronDown className="h-4 w-4 text-[#8E8E93]" />
                  </button>
                  {formErrors.baseUnit && (
                    <span className="text-[#FF3B30] text-xs font-medium mt-1">{formErrors.baseUnit}</span>
                  )}
                </div>

                {/* Field Extra: Package Type and Capacity split */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="text-sm font-semibold text-[#333333] mb-2">
                      Package Type
                    </label>
                    <select
                      value={formPackageType}
                      onChange={e => setFormPackageType(e.target.value)}
                      className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-sm outline-none w-full font-bold"
                    >
                      <option value="Carton">Carton</option>
                      <option value="Bag">Bag</option>
                      <option value="Crate">Crate</option>
                      <option value="Pack">Pack</option>
                      <option value="Roll">Roll</option>
                      <option value="Bundle">Bundle</option>
                      <option value="Coil">Coil</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div className="flex flex-col">
                    <label className="text-sm font-semibold text-[#333333] mb-2">
                      Capacity
                    </label>
                    <input 
                      type="number"
                      value={formProductsPerCarton} 
                      onChange={e => setFormProductsPerCarton(e.target.value)} 
                      placeholder="e.g. 12, 24, 48"
                      className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-sm outline-none w-full font-mono font-bold"
                    />
                  </div>
                </div>
                <div className="text-[#8E8E93] text-xs font-normal mt-1 leading-normal">
                  Set number of product per package type.
                </div>

                {/* Field 5: Selling Price */}
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-[#333333] mb-2 flex items-center">
                    Selling Price <span className="text-[#FF3B30] ml-1">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#333333] font-bold text-sm">₦</span>
                    <input 
                      required 
                      type="text"
                      value={formBasePrice} 
                      onChange={e => setFormBasePrice(formatNumericInput(e.target.value))} 
                      placeholder="Enter selling price"
                      className={cn(
                        "h-10 border rounded-lg pl-7 pr-3 bg-white text-sm outline-none transition-colors w-full font-mono font-bold",
                        formErrors.basePrice ? "border-[#FF3B30]" : "border-[#CCCCCC] focus:border-[#007AFF]"
                      )}
                    />
                  </div>
                  {formErrors.basePrice && (
                    <span className="text-[#FF3B30] text-xs font-medium mt-1">{formErrors.basePrice}</span>
                  )}
                </div>

                {/* Field 6 & 7: Primary Cost Price + Quantity side-by-side */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="text-sm font-semibold text-[#333333] mb-2 flex items-center">
                      Cost Price <span className="text-[#FF3B30] ml-1">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#333333] font-bold text-sm">₦</span>
                      <input 
                        required 
                        type="text"
                        value={primaryCostPrice} 
                        onChange={e => handleUpdatePrimaryCostPrice(e.target.value)} 
                        placeholder="Enter cost price"
                        className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg pl-7 pr-3 bg-white text-sm outline-none w-full font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="text-sm font-semibold text-[#333333] mb-2 flex items-center">
                      Quantity <span className="text-slate-400 ml-1">(Computed)</span>
                    </label>
                    <input 
                      readOnly 
                      type="text"
                      value={primaryQuantity} 
                      placeholder="Location Sum"
                      className="h-10 border border-[#CCCCCC] rounded-lg px-3 bg-slate-50 text-sm outline-none w-full font-mono font-bold text-slate-500 cursor-not-allowed"
                      title="This is the automatically computed sum of the location stock levels defined above."
                    />
                  </div>
                </div>
                {formErrors.quantity && (
                  <span className="text-[#FF3B30] text-xs font-medium mt-1">{formErrors.quantity}</span>
                )}

                {/* Field 8: Minimum Stock Level */}
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-[#333333] mb-2 flex items-center">
                    Minimum Stock Level <span className="text-[#FF3B30] ml-1">*</span>
                  </label>
                  <input 
                    required 
                    type="text"
                    value={formMinStockLevel} 
                    onChange={e => setFormMinStockLevel(formatNumericInput(e.target.value))} 
                    placeholder="Enter minimum stock level"
                    className={cn(
                      "h-10 border rounded-lg px-3 bg-white text-sm outline-none transition-colors w-full font-mono font-bold",
                      formErrors.minStockLevel ? "border-[#FF3B30]" : "border-[#CCCCCC] focus:border-[#007AFF]"
                    )}
                  />
                  <span className="text-[#8E8E93] text-xs font-normal mt-1 leading-normal">
                    Low stock alert threshold.
                  </span>
                  {formErrors.minStockLevel && (
                    <span className="text-[#FF3B30] text-xs font-medium mt-1">{formErrors.minStockLevel}</span>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION C: Cost Price Batches */}
            <div className="border-b border-[#E5E5EA] pb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-[#000000]">Cost Price Batches</h3>
                  <span className="text-xs text-[#8E8E93] font-mono font-medium block mt-0.5">
                    Total Quantity: {computedTotalQuantity.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setNewBatchData({ costPrice: '', quantity: '' });
                      setIsAddBatchModalOpen(true);
                    }}
                    className="h-9 px-3 bg-[#007AFF] hover:bg-[#0066CC] font-sans text-xs font-bold text-white rounded-lg transition-colors flex items-center gap-1 leading-none select-none"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Batch
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBatchList(!showBatchList)}
                    className="p-1.5 border border-[#CCCCCC] rounded-lg text-black hover:bg-[#F2F2F7] transition-colors"
                  >
                    {showBatchList ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {showBatchList && (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {costBatches.map((batch, idx) => (
                    <div 
                      key={idx} 
                      className="border border-[#E5E5EA] p-3 flex items-center justify-between text-sm bg-white rounded-lg hover:border-[#CCCCCC] transition-colors"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0 pr-4">
                        <span className="font-bold text-[#333333] text-xs uppercase tracking-tight truncate">
                          {idx === 0 ? 'Primary Batch (linked to fields above)' : `Batch #${idx}`}
                        </span>
                        <span className="text-[10px] text-[#8E8E93] font-mono leading-none font-medium">
                          Added {new Date(batch.date).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase text-[#8E8E93] font-bold leading-none select-none">Cost</span>
                            <span className="font-mono text-xs font-bold text-black mt-0.5">₦{batch.costPrice || '0'}</span>
                          </div>
                          <div className="flex flex-col items-end pl-2 border-l border-[#E5E5EA]">
                            <span className="text-[10px] uppercase text-[#8E8E93] font-bold leading-none select-none">Qty</span>
                            <span className="font-mono text-xs font-black text-black mt-0.5">{batch.quantity || '0'}</span>
                          </div>
                        </div>
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteBatch(idx)}
                            className="p-1.5 hover:bg-[#FF3B30]/10 text-[#FF3B30] rounded-lg transition-colors shrink-0"
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {costBatches.length === 0 && (
                    <div className="text-center py-4 border border-dashed border-[#CCCCCC] rounded-lg">
                      <span className="text-xs text-[#8E8E93] font-sans font-medium">No batches registered.</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION: Location Stock Levels */}
            <div className="border-b border-[#E5E5EA] pb-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-[#000000]">Location Stock Levels</h3>
                  <span className="text-xs text-[#8E8E93] font-sans font-medium block mt-0.5">
                    Set other location e.g warehouse.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextLocId = locations.find(l => !formLocationAllocations.some(a => a.locationId === l.id))?.id || locations[0]?.id || 'default-storage';
                    setFormLocationAllocations(prev => [
                      ...prev,
                      { locationId: nextLocId, quantity: '', unitName: formBaseUnit || 'Piece', conversionRate: 1 }
                    ]);
                  }}
                  className="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-sans text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer select-none border border-indigo-100 font-bold"
                >
                  <Plus className="h-3 w-3" /> Add Location
                </button>
              </div>

              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {formLocationAllocations.map((alloc, idx) => (
                  <div key={`alloc-row-${idx}`} className="flex items-center gap-2 bg-slate-50/50 p-2 rounded-xl border border-slate-100/80">
                    <div className="flex-1 min-w-[130px]">
                      <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Storage Location</label>
                      <select
                        value={alloc.locationId}
                        onChange={e => {
                          const updated = [...formLocationAllocations];
                          updated[idx].locationId = e.target.value;
                          setFormLocationAllocations(updated);
                        }}
                        className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-2.5 bg-white text-xs outline-none w-full font-sans cursor-pointer font-bold text-slate-800"
                      >
                        {locations.map((loc, index) => (
                          <option key={`alloc-loc-${loc.id || index}-${index}`} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="w-14 shrink-0">
                      <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Qty</label>
                      <input
                        type="text"
                        placeholder="Qty"
                        value={alloc.quantity}
                        onChange={e => {
                          const updated = [...formLocationAllocations];
                          updated[idx].quantity = formatNumericInput(e.target.value);
                          setFormLocationAllocations(updated);
                        }}
                        className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg p-2 bg-white text-xs outline-none w-full font-mono font-bold text-slate-800 text-right"
                      />
                    </div>

                    <div className="w-24 shrink-0">
                      <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Unit</label>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAllocIndexForUnitSelect(idx);
                        }}
                        className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-2 text-xs text-left w-full font-sans font-bold text-[#00529B] flex items-center justify-between bg-white"
                      >
                        <span className="truncate">{alloc.unitName || formBaseUnit || 'Piece'}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-[#8E8E93] shrink-0 ml-0.5" />
                      </button>
                    </div>

                    {formLocationAllocations.length > 1 && (
                      <div className="flex flex-col justify-end h-full pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            setFormLocationAllocations(prev => prev.filter((_, i) => i !== idx));
                          }}
                          className="p-2.5 border border-slate-200 hover:border-rose-200 hover:bg-rose-50 rounded-lg text-rose-500 hover:text-rose-700 transition-colors shrink-0 cursor-pointer"
                          title="Remove Allocation row"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {formErrors.locations && (
                <span className="text-[#FF3B30] text-[#FF3B30] text-xs font-medium mt-2 block">{formErrors.locations}</span>
              )}
            </div>

            {/* SECTION D: Variations */}
            <div className="pb-4">
              <div 
                onClick={() => setShowAdditionalUnits(!showAdditionalUnits)}
                className="flex items-center justify-between mb-4 cursor-pointer select-none"
              >
                <h3 className="text-lg font-bold text-[#000000]">Variations</h3>
                <div className="p-1.5 border border-[#CCCCCC] rounded-lg text-black hover:bg-[#F2F2F7] transition-colors">
                  {showAdditionalUnits ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>

              {showAdditionalUnits && (
                <div className="space-y-4">
                  {/* List of custom additions */}
                  <div className="space-y-2">
                    {additionalUnits.map((item, idx) => (
                      <div key={idx} className="border border-[#E5E5EA] p-3 flex items-center justify-between text-sm bg-white rounded-lg">
                        <div className="flex flex-col">
                          <span className="font-bold text-[#333333] text-xs uppercase leading-none">{item.unitType}</span>
                          <span className="text-[10px] text-[#8E8E93] mt-1 font-mono leading-none">
                            1 {item.unitType} = {item.conversionRate || '1'} {formBaseUnit || 'Piece'}(s)
                          </span>
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                          <span className="font-bold text-black text-xs">₦{item.price}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteAdditionalUnit(idx)}
                            className="p-1.5 hover:bg-[#FF3B30]/10 text-[#FF3B30] rounded-lg transition-colors shrink-0"
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Row Horizontally */}
                  <div className="flex items-center gap-2 pt-2 border-t border-dashed border-[#E5E5EA]">
                    {/* Inline Picker touchable row */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelectingAdditionalUnit(true);
                        setIsUnitModalOpen(true);
                      }}
                      className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white flex items-center justify-between text-xs flex-1 font-sans text-left text-[#333333]"
                    >
                      <span className="truncate max-w-[120px] font-medium">
                        {inlineAdditionalUnit.unitType || 'Select unit type'}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 text-[#8E8E93] shrink-0 ml-1" />
                    </button>

                    {/* Price Input */}
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#333333] font-bold text-xs font-mono">₦</span>
                      <input 
                        type="text"
                        value={inlineAdditionalUnit.price}
                        onChange={e => setInlineAdditionalUnit({ ...inlineAdditionalUnit, price: formatNumericInput(e.target.value) })}
                        placeholder="Price"
                        className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg pl-6 pr-2 bg-white text-xs outline-none w-full font-mono font-bold"
                      />
                    </div>

                    {/* Plus trigger button */}
                    <button
                      type="button"
                      onClick={handleAddAdditionalUnit}
                      className="h-10 w-10 bg-[#007AFF] hover:bg-[#0066CC] rounded-lg text-white font-sans flex items-center justify-center transition-colors shrink-0 select-none"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer controls (side-by-side cancel and apply, centered) */}
          <div className="h-16 border-t border-[#E5E5EA] flex items-center justify-end px-4 py-3 bg-white shrink-0 gap-3 font-sans">
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(false);
                setEditingProduct(null);
              }}
              className="h-10 px-5 border border-[#CCCCCC] text-[#FF3B30] hover:bg-[#FF3B30]/5 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors select-none font-sans"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitProductForm}
              disabled={isSaving}
              className="h-10 px-6 bg-[#007AFF] hover:bg-[#0066CC] disabled:opacity-55 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors select-none font-sans flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                editingProduct ? 'Update Product' : 'Add Product'
              )}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unit Selection Custom Modal */}
      {isUnitModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/45">
          <div className="bg-white rounded-none border border-[#E5E5EA] max-w-md w-full p-6 space-y-6 font-sans shadow-none">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
              <span className="text-base font-bold text-black font-sans leading-none">
                Select Unit Type
              </span>
              <button
                type="button"
                onClick={() => setIsUnitModalOpen(false)}
                className="p-1 hover:bg-[#F2F2F7] rounded-lg text-black transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
              {UNIT_CATEGORIES.map(category => (
                <div key={category.name} className="space-y-2">
                  <span className="text-xs uppercase font-bold text-[#8E8E93] block select-none">
                    {category.name}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {category.units.map(unit => {
                      const currentSelected = isSelectingAdditionalUnit 
                        ? inlineAdditionalUnit.unitType === unit
                        : formBaseUnit === unit;

                      return (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => {
                            if (isSelectingAdditionalUnit) {
                              setInlineAdditionalUnit(prev => ({ ...prev, unitType: unit }));
                            } else {
                              setFormBaseUnit(unit);
                            }
                            setIsUnitModalOpen(false);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors select-none font-sans",
                            currentSelected 
                              ? "bg-[#007AFF] border-[#007AFF] text-white font-bold" 
                              : "bg-white border-[#CCCCCC] text-[#333333] hover:bg-[#F2F2F7]"
                          )}
                        >
                          {unit}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stocking Unit Selection Custom Modal for Location Allocations */}
      {activeAllocIndexForUnitSelect !== null && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/45">
          <div className="bg-white rounded-none border border-[#E5E5EA] max-w-md w-full p-6 space-y-6 font-sans shadow-none">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
              <span className="text-base font-bold text-black font-sans leading-none">
                Select Stocking Unit
              </span>
              <button
                type="button"
                onClick={() => setActiveAllocIndexForUnitSelect(null)}
                className="p-1 hover:bg-[#F2F2F7] rounded-lg text-black transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
              {UNIT_CATEGORIES.map(category => (
                <div key={`alloc-cat-${category.name}`} className="space-y-2">
                  <span className="text-xs uppercase font-bold text-[#8E8E93] block select-none">
                    {category.name}
                  </span>
                  <div className="flex flex-wrap gap-2 flex-wrap">
                    {category.units.map(unit => {
                      const currentSelected = formLocationAllocations[activeAllocIndexForUnitSelect]?.unitName === unit;

                      return (
                        <button
                          key={`alloc-unit-btn-${unit}`}
                          type="button"
                          onClick={() => {
                            const updated = [...formLocationAllocations];
                            updated[activeAllocIndexForUnitSelect].unitName = unit;
                            
                            // Determine correct conversion rate
                            let rate = 1;
                            if (unit.toLowerCase() === (formBaseUnit || 'Piece').toLowerCase()) {
                              rate = 1;
                            } else if (formPackageType && unit.toLowerCase() === formPackageType.toLowerCase()) {
                              rate = parseNumericString(formProductsPerCarton || '12');
                            } else {
                              const matchedVar = additionalUnits.find(u => u.unitType?.toLowerCase() === unit.toLowerCase());
                              if (matchedVar) {
                                rate = parseNumericString(matchedVar.conversionRate || '1');
                              } else {
                                const uLower = unit.toLowerCase();
                                if (uLower === 'carton') rate = parseNumericString(formProductsPerCarton || '12');
                                else if (uLower === 'crate') rate = parseNumericString(formProductsPerCarton || '24');
                                else if (uLower === 'dozen') rate = 12;
                                else if (uLower === 'pack') rate = parseNumericString(formProductsPerCarton || '6');
                                else if (uLower === 'roll' || uLower === 'bundle' || uLower === 'coil' || uLower === 'bag') {
                                  rate = parseNumericString(formProductsPerCarton || '10');
                                }
                              }
                            }
                            
                            updated[activeAllocIndexForUnitSelect].conversionRate = rate;
                            setFormLocationAllocations(updated);
                            setActiveAllocIndexForUnitSelect(null);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors select-none font-sans",
                            currentSelected 
                              ? "bg-[#007AFF] border-[#007AFF] text-white font-bold" 
                              : "bg-white border-[#CCCCCC] text-[#333333] hover:bg-[#F2F2F7]"
                          )}
                        >
                          {unit}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add New Batch Custom Modal */}
      {isAddBatchModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/45">
          <div className="bg-white rounded-none border border-[#E5E5EA] max-w-xs w-full p-5 space-y-4 font-sans shadow-none">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-2">
              <span className="text-sm font-bold text-black font-sans leading-none">
                Add New Batch
              </span>
              <button
                type="button"
                onClick={() => setIsAddBatchModalOpen(false)}
                className="p-1 hover:bg-[#F2F2F7] rounded-lg text-black transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 font-sans">
              <div className="flex flex-col">
                <label className="text-xs font-semibold text-[#333333] mb-1.5 flex items-center">
                  Cost Price <span className="text-[#FF3B30] ml-1">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#333333] font-bold text-xs">₦</span>
                  <input 
                    type="text"
                    required
                    value={newBatchData.costPrice}
                    onChange={e => setNewBatchData(prev => ({ ...prev, costPrice: formatNumericInput(e.target.value) }))}
                    placeholder="Enter cost price"
                    className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg pl-6 pr-2 bg-white text-xs outline-none w-full font-mono font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-xs font-semibold text-[#333333] mb-1.5 flex items-center">
                  Quantity <span className="text-[#FF3B30] ml-1">*</span>
                </label>
                <input 
                  type="text"
                  required
                  value={newBatchData.quantity}
                  onChange={e => setNewBatchData(prev => ({ ...prev, quantity: formatNumericInput(e.target.value) }))}
                  placeholder="Enter quantity"
                  className="h-10 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-2.5 bg-white text-xs outline-none w-full font-mono font-bold"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E5E5EA] font-sans">
              <button
                type="button"
                onClick={() => setIsAddBatchModalOpen(false)}
                className="h-8 px-3 border border-[#CCCCCC] text-[#FF3B30] hover:bg-[#FF3B30]/5 text-xs font-bold uppercase rounded-lg transition-colors select-none font-sans"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { costPrice, quantity } = newBatchData;
                  if (!costPrice || parseNumericString(costPrice) <= 0) {
                    alert("Please enter a positive cost price for this batch.");
                    return;
                  }
                  if (!quantity || parseNumericString(quantity) <= 0) {
                    alert("Please enter a positive quantity for this batch.");
                    return;
                  }
                  setCostBatches(prev => [...prev, {
                    costPrice,
                    quantity,
                    date: new Date().toISOString(),
                    isNew: true
                  }]);
                  setIsAddBatchModalOpen(false);
                  setShowBatchList(true);
                }}
                className="h-8 px-4 bg-[#007AFF] hover:bg-[#0066CC] font-sans text-xs font-bold text-white rounded-lg transition-colors select-none font-sans"
              >
                Save Batch
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Restock Modal */}
      <Dialog open={isRestockModalOpen} onOpenChange={setIsRestockModalOpen}>
        <DialogContent className="max-w-md rounded-[2.5rem] p-10">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight">Restock Item</DialogTitle>
            <DialogDescription className="font-bold italic text-slate-400">{restockProduct?.name}</DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleRestock} className="space-y-6 pt-4">
             <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-950">Current Stock: {restockProduct?.stock}</label>
                <div className="relative">
                   <Package className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300" />
                   <input 
                     type="number" 
                     placeholder="Quantity to add..." 
                     value={restockAmount} 
                     onChange={e => setRestockAmount(Number(e.target.value))}
                     className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-14 py-5 font-black outline-none focus:border-emerald-500 transition-all text-xl"
                     autoFocus
                   />
                </div>
             </div>
             
             <div className="flex gap-4">
                <button type="button" onClick={() => setIsRestockModalOpen(false)} className="flex-1 py-4 font-black uppercase tracking-widest text-[10px] text-slate-400">Cancel</button>
                <button type="submit" className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20">Add Stock</button>
             </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Locations Manager Modal */}
      {isLocationManagerOpen && (
        <Dialog open={isLocationManagerOpen} onOpenChange={setIsLocationManagerOpen}>
          <DialogContent className="max-w-md rounded-2xl p-6 bg-white max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold uppercase select-none tracking-tight">Manage Storage Locations</DialogTitle>
              <DialogDescription className="text-xs text-slate-400">Add, edit or list storage warehouse locations for your store's items.</DialogDescription>
            </DialogHeader>

            <div className="space-y-6 mt-4">
              {/* Existing Locations */}
              <div className="space-y-2">
                <span className="text-xs font-black uppercase text-slate-400">Active Storage Locations</span>
                <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                  {locations.map((loc, index) => {
                    if (loc.id === '' || loc.id === undefined || loc.id === null) {
                      console.warn("TEMPORARY KEY DETECTOR:", { file: "Inventory.tsx", component: "ManageStorageLocations", keyVal: loc.id, index });
                    }
                    const isDefault = loc.isDefaultSalesSource === true;
                    return (
                      <div key={`inv-loc-act-${loc.id || index}-${index}`} className="flex justify-between items-center p-3 bg-slate-50 border border-slate-100 rounded-xl hover:bg-slate-100 transition-colors">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900 uppercase text-xs">{loc.name}</span>
                            {isDefault && (
                              <span className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded bg-indigo-50 border border-indigo-200 text-indigo-700">Default Source</span>
                            )}
                          </div>
                          {loc.description && <p className="text-[10px] text-slate-400 mt-0.5">{loc.description}</p>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {!isDefault && loc.id !== 'default-storage' && (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultSalesSource(loc.id)}
                              className="px-2 py-1 text-[8px] font-black uppercase tracking-wider rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all cursor-pointer"
                            >
                              Set Default
                            </button>
                          )}
                          <span className="px-2.5 py-1 text-[8px] font-black uppercase tracking-wider rounded-lg border bg-green-50 border-green-200 text-green-700">{loc.status}</span>
                          {loc.id !== 'default-storage' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteLocation(loc.id, loc.name)}
                              className="p-1.5 hover:bg-rose-50 border border-transparent hover:border-rose-100 text-[#FF3B30] rounded-lg transition-colors select-none cursor-pointer"
                              title="Delete Location"
                            >
                              <Trash className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {locations.length === 0 && (
                    <p className="text-xs text-slate-400 italic text-center py-4">No custom locations added yet.</p>
                  )}
                </div>
              </div>

              {/* Add Location Form */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <span className="text-xs font-black uppercase text-slate-400">Add New Storage Location</span>
                <div className="flex flex-col">
                  <label className="text-[10px] font-black uppercase text-slate-700 mb-1 ml-1">Location Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Backroom, Warehouse A, Main Rack"
                    value={newLocationName}
                    onChange={e => setNewLocationName(e.target.value)}
                    className="h-9 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-xs outline-none w-full font-sans"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-[10px] font-black uppercase text-slate-700 mb-1 ml-1">Description (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Storage shelves in back office"
                    value={newLocationDesc}
                    onChange={e => setNewLocationDesc(e.target.value)}
                    className="h-9 border border-[#CCCCCC] focus:border-[#007AFF] rounded-lg px-3 bg-white text-xs outline-none w-full font-sans"
                  />
                </div>
                <button
                  type="button"
                  disabled={isSavingLocation}
                  onClick={async () => {
                    if (!newLocationName.trim()) return alert("Please enter location name");
                    setIsSavingLocation(true);
                    try {
                      await addLocation({
                        storeId: profile?.storeId || '',
                        name: newLocationName.trim(),
                        description: newLocationDesc.trim(),
                        status: 'active'
                      });
                      setNewLocationName('');
                      setNewLocationDesc('');
                      alert("Location added successfully.");
                    } catch (err: any) {
                      alert("Error: " + err.message);
                    } finally {
                      setIsSavingLocation(false);
                    }
                  }}
                  className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider hover:bg-blue-700 transition-colors"
                >
                  {isSavingLocation ? 'Saving...' : 'Add Location'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default Inventory;
