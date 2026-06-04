import React, { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Bell,
  Cloud,
  Shield,
  Database,
  Printer,
  User,
  Zap,
  Building2,
  LayoutGrid,
  List as ListIcon,
  TrendingDown,
  Warehouse,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  CreditCard,
  Save,
  CheckCircle2,
  RefreshCcw,
  Edit,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { motion, AnimatePresence } from "motion/react";
import { db, handleFirestoreError, OperationType } from "../services/firebase";
import { db as dexie } from "../services/db";
import { doc, updateDoc, getDoc, setDoc } from "firebase/firestore";
import { Badge } from "../components/ui/badge";
import { useInventoryLocations } from "../hooks/useInventoryLocations";
import { cn } from "../lib/utils";

const Settings: React.FC = () => {
  const { profile } = useAuth();
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [diagStats, setDiagStats] = useState({ daily: 0, total: 0, inventory: 0 });

  // States for inline editing categories and locations (eliminating window.prompt & window.confirm in sandbox iframe)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editingLocationValue, setEditingLocationValue] = useState("");
  const [showAddLocationInline, setShowAddLocationInline] = useState(false);
  const [newLocationInlineName, setNewLocationInlineName] = useState("");

  const [editingCategoryIndex, setEditingCategoryIndex] = useState<number | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState("");
  const [showAddCategoryInline, setShowAddCategoryInline] = useState(false);
  const [newCategoryInlineName, setNewCategoryInlineName] = useState("");
  const [deletingCategoryName, setDeletingCategoryName] = useState<string | null>(null);

  useEffect(() => {
    const loadDiagStats = async () => {
      if (!profile?.storeId) return;
      try {
        const cachedProducts = await dexie.products.where('storeId').equals(profile.storeId).toArray();
        const cachedSales = await dexie.sales.where('storeId').equals(profile.storeId).toArray();
        let inventoryUnits = 0;
        cachedProducts.forEach(p => {
          inventoryUnits += (Number(p.stock) || 0);
        });
        
        const payments: Record<string, number> = { cash: 0, pos: 0, transfer: 0, credit: 0, split: 0 };
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const last7Days = Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          return { name: days[d.getDay()], date: d.toISOString().split('T')[0], val: 0 };
        }).reverse();
        
        cachedSales.forEach(sale => {
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
        });

        setDiagStats({
          daily: last7Days.length > 0 ? (last7Days[last7Days.length - 1]?.val || 0) : 0,
          total: cachedSales.length,
          inventory: inventoryUnits
        });
      } catch(err) {
        console.error("Failed to load settings diagnostics stats", err);
      }
    };
    loadDiagStats();
  }, [profile?.storeId]);

  const { locations, addLocation, updateLocation } = useInventoryLocations(profile?.storeId);

  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem("pos_custom_categories");
    return saved ? JSON.parse(saved) : ["BEVERAGES", "SNACKS", "GROCERY", "DAIRY", "FROZEN", "HOUSEHOLD", "PERSONAL CARE", "OTHERS"];
  });

  const [allowNegativeStock, setAllowNegativeStock] = useState<boolean>(() => {
    return localStorage.getItem("store_allow_negative_stock") === "true";
  });

  useEffect(() => {
    const loadStoreConfig = async () => {
      if (!profile?.storeId) return;
      try {
        const storeSnap = await getDoc(doc(db, 'stores', profile.storeId));
        if (storeSnap.exists()) {
          const storeData = storeSnap.data();
          if (storeData.name) {
            setStoreNameInput(storeData.name);
          }
          if (storeData.storeAddress) {
            setStoreAddressInput(storeData.storeAddress);
          }
          if (storeData.storePhone) {
            setStorePhoneInput(storeData.storePhone);
          }
          if (storeData.receiptHeader) {
            setReceiptHeaderInput(storeData.receiptHeader);
          }
          if (storeData.receiptFooter) {
            setReceiptFooterInput(storeData.receiptFooter);
          }
          if (storeData.taxRate !== undefined) {
            setTaxInput(storeData.taxRate);
          }
          if (storeData.serviceFee !== undefined) {
            setFeeInput(storeData.serviceFee);
          }
          if (storeData.customCategories && Array.isArray(storeData.customCategories)) {
            setCategories(storeData.customCategories);
            localStorage.setItem("pos_custom_categories", JSON.stringify(storeData.customCategories));
          }
          if (storeData.allowNegativeStock !== undefined) {
            setAllowNegativeStock(storeData.allowNegativeStock);
            localStorage.setItem("store_allow_negative_stock", String(storeData.allowNegativeStock));
          }
        }
      } catch (err) {
        console.warn("Failed to load store configs from Firebase, using offline/local storage.", err);
      }
    };
    loadStoreConfig();
  }, [profile?.storeId]);

  const handleUpdateCategories = async (newCategories: string[]) => {
    setCategories(newCategories);
    localStorage.setItem("pos_custom_categories", JSON.stringify(newCategories));
    
    if (profile?.storeId) {
      const writePath = `stores/${profile.storeId}`;
      try {
        await setDoc(doc(db, "stores", profile.storeId), {
          customCategories: newCategories
        }, { merge: true });
      } catch (err) {
        console.error("Failed to update customCategories in Firestore for path", writePath, err);
        try {
          handleFirestoreError(err, OperationType.WRITE, writePath);
        } catch (formattedError) {
          console.error("Structured Firestore Error Info:", formattedError);
        }
      }
    }
  };

  // Form states
  const [username, setUsername] = useState(profile?.username || "");
  const [printFormat, setPrintFormat] = useState<"80mm" | "58mm" | "standard">(
    () => {
      return (
        (localStorage.getItem("pos_selected_printer_format") as any) || "80mm"
      );
    },
  );
  const printerName =
    printFormat === "58mm"
      ? "Mobile Thermal 58mm (XP-58)"
      : printFormat === "80mm"
        ? "Standard Thermal 80mm (XP-80C)"
        : "Desktop Office Printer (A4 Invoice)";
  const [taxInput, setTaxInput] = useState(profile?.store?.taxRate ?? profile?.taxRate ?? 0);
  const [feeInput, setFeeInput] = useState(profile?.store?.serviceFee ?? profile?.serviceFee ?? 0);
  const [storeNameInput, setStoreNameInput] = useState(
    profile?.store?.name ?? profile?.storeName ?? "",
  );
  const [storeAddressInput, setStoreAddressInput] = useState(
    profile?.store?.storeAddress ?? profile?.storeAddress ?? "",
  );
  const [storePhoneInput, setStorePhoneInput] = useState(
    profile?.store?.storePhone ?? profile?.storePhone ?? "",
  );
  const [receiptHeaderInput, setReceiptHeaderInput] = useState(
    profile?.store?.receiptHeader ?? profile?.receiptHeader ?? "",
  );
  const [receiptFooterInput, setReceiptFooterInput] = useState(
    profile?.store?.receiptFooter ?? profile?.receiptFooter ?? "",
  );

  useEffect(() => {
    if (profile) {
      setUsername(profile.username || "");
      setTaxInput(profile.store?.taxRate ?? profile.taxRate ?? 0);
      setFeeInput(profile.store?.serviceFee ?? profile.serviceFee ?? 0);
      setStoreNameInput(profile.store?.name ?? profile.storeName ?? "");
      setStoreAddressInput(profile.store?.storeAddress ?? profile.storeAddress ?? "");
      setStorePhoneInput(profile.store?.storePhone ?? profile.storePhone ?? "");
      setReceiptHeaderInput(profile.store?.receiptHeader ?? profile.receiptHeader ?? "");
      setReceiptFooterInput(profile.store?.receiptFooter ?? profile.receiptFooter ?? "");
      const allowNeg = profile.store?.allowNegativeStock ?? (profile as any).allowNegativeStock;
      if (allowNeg !== undefined) {
        setAllowNegativeStock(allowNeg);
        localStorage.setItem("store_allow_negative_stock", String(allowNeg));
      }
    }
  }, [profile]);

  const sections = [
    {
      id: "profile",
      title: "Profile Settings",
      icon: User,
      desc: "Manage your profile and business details.",
    },
    {
      id: "business",
      title: "Business Identity",
      icon: Building2,
      desc: "Update store name, address, and tax info.",
    },
    {
      id: "locations",
      title: "Store Locations",
      icon: Warehouse,
      desc: "Manage aisles, warehouses and shelf locations.",
    },
    {
      id: "categories",
      title: "Product Categories",
      icon: LayoutGrid,
      desc: "Organize products into logical groups for POS.",
    },
    {
      id: "printer",
      title: "Printer Settings",
      icon: Printer,
      desc: "Setup your receipt printers and layout.",
    },
    {
      id: "security",
      title: "Security & Password",
      icon: Shield,
      desc: "Change your password and manage security.",
    },
    {
      id: "backup",
      title: "Database & Sync",
      icon: Database,
      desc: "Manage your data backups and cloud sync.",
    },
  ];

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "users", profile.uid), {
        username: username,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      console.error("Settings: Profile update failed", err);
      alert("Failed to update profile.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStore = async (field: string, value: any) => {
    if (!profile?.storeId) return;
    const storeId = profile.storeId;
    const writePath = `stores/${storeId}`;
    const payload = field === 'name' ? { name: value, storeName: value } : { [field]: value };

    setIsSaving(true);
    try {
      await setDoc(doc(db, "stores", storeId), payload, { merge: true });
      alert("SUCCESS: Store details updated successfully.");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      console.error("Settings: Store update failed for path", writePath, err);
      try {
        handleFirestoreError(err, OperationType.WRITE, writePath);
      } catch (formattedError) {
        console.error("Structured Firestore Error Info:", formattedError);
      }
      alert("ERROR: Failed to save store setting. " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestPrint = () => {
    const storeName = profile?.storeName || "BIZSEQ STORE";

    // Formatting variables based on selected printFormat
    const sizeLabel =
      printFormat === "58mm"
        ? "58mm Mobile Roll"
        : printFormat === "80mm"
          ? "80mm Standard Roll"
          : "Standard A4/Letter Sheet";
    const bodyMaxWidth =
      printFormat === "58mm"
        ? "200px"
        : printFormat === "80mm"
          ? "300px"
          : "800px";
    const fontSize =
      printFormat === "58mm"
        ? "10.5px"
        : printFormat === "80mm"
          ? "12px"
          : "14px";
    const padding = printFormat === "standard" ? "40px" : "15px";
    const borderStyle =
      printFormat === "standard" ? "1px solid #cbd5e1" : "none";
    const shadowStyle =
      printFormat === "standard" ? "0 10px 15px -3px rgb(0 0 0 / 0.1)" : "none";
    const fontFamily = printFormat === "standard" ? "sans-serif" : "monospace";

    const receiptHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Print - BIZSEQ</title>
        <style>
          @page {
            margin: 0;
            size: auto;
          }
          body {
            font-family: ${fontFamily};
            color: #000;
            margin: 0;
            padding: ${padding};
            max-width: ${bodyMaxWidth};
            margin: 0 auto;
            background-color: #fff;
            border: ${borderStyle};
            box-shadow: ${shadowStyle};
            font-size: ${fontSize};
            line-height: 1.4;
          }
          .header {
            text-align: center;
            margin-bottom: 15px;
          }
          .store-name {
            font-size: 16px;
            font-weight: bold;
            text-transform: uppercase;
            margin: 0 0 4px 0;
          }
          .divider {
            border-top: 2px dashed #000;
            margin: 10px 0;
          }
          .info {
            font-size: 11px;
            margin-bottom: 10px;
          }
          .footer {
            text-align: center;
            margin-top: 25px;
            font-size: 10px;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="store-name">${storeName}</div>
          <div style="font-size: 10px; text-transform: uppercase;">PRINTER DIAGNOSTIC TEST</div>
        </div>
        
        <div class="divider"></div>
        
        <p class="info" style="text-align: center;">
          SUCCESSFUL CONNECTION!<br/>
          Printer: ${printerName}<br/>
          Selected Class: ${sizeLabel}<br/>
          Time: ${new Date().toLocaleString()}
        </p>
        
        <div class="divider"></div>
        
        <div style="font-size: 10px; font-family: monospace; line-height: 1.2;">
          --- BARCODE COMPATIBILITY TEST ---<br/>
          *1234567890*<br/>
          --- CHARACTER SET TEST ---<br/>
          ABCDEFGHIJKLMNOPQRSTUVWXYZ<br/>
          abcdefghijklmnopqrstuvwxyz<br/>
          1234567890 !@#$%^&*()_+<br/>
        </div>

        <div class="divider"></div>
        
        <div class="footer">
          <p>BIZSEQ POS • Diagnostic Tool</p>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(receiptHtml);
      doc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          console.error("Diagnostic test print failed from hidden iframe", e);
          const printWindow = window.open("", "_blank");
          if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(receiptHtml);
            printWindow.document.close();
          } else {
            window.print();
          }
        }

        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 3000);
      }, 500);
    } else {
      window.print();
    }
  };

  const selectModule = (id: string) => {
    setActiveModule(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderModule = () => {
    switch (activeModule) {
      case "profile":
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-4 bg-slate-200 rounded-2xl hover:bg-slate-300 transition-all shadow-sm"
              >
                <ChevronLeft className="h-6 w-6 text-slate-900" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                User Identity Node
              </h2>
            </div>

            <div className="vibrant-card p-10 bg-white border-2 border-slate-100 max-w-2xl relative overflow-hidden">
              <form
                onSubmit={handleUpdateProfile}
                className="space-y-8 relative z-10"
              >
                <div className="space-y-3">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
                    Operator Alias
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="kenny"
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 outline-none focus:border-emerald-500 font-black text-lg transition-all"
                  />
                </div>

                <button
                  disabled={isSaving}
                  type="submit"
                  className="w-full bg-slate-950 text-white py-6 rounded-2xl font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-4 shadow-2xl hover:bg-black transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? (
                    <RefreshCcw className="h-5 w-5 animate-spin" />
                  ) : (
                    <Save className="h-5 w-5" />
                  )}
                  {isSaving ? "Synchronizing..." : "Save Profile Changes"}
                </button>

                {success && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-5 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center gap-3 justify-center border border-emerald-100"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-[11px] font-black uppercase tracking-widest">
                      Update Propagated Successfully
                    </span>
                  </motion.div>
                )}
              </form>
              <User className="absolute -right-8 -bottom-8 h-40 w-40 text-slate-50 rotate-12" />
            </div>
          </motion.div>
        );
      case "business":
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-4 bg-slate-200 rounded-2xl hover:bg-slate-300 transition-all shadow-sm"
              >
                <ChevronLeft className="h-6 w-6 text-slate-900" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                Business Unit
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="vibrant-card p-10 bg-slate-950 text-white space-y-6">
                <div>
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2">
                    Store Identity
                  </p>
                  <h3 className="text-4xl font-black tracking-tighter italic">
                    {profile?.store?.name || profile?.storeName || ""}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-bold mt-4 uppercase tracking-[0.2em]">
                    ACTIVE STORE PROFILE
                  </p>
                </div>
                <div className="pt-6 border-t border-white/10">
                  <p className="text-slate-400 font-bold italic text-sm">
                    Contact super admin to change primary store metadata.
                  </p>
                </div>
              </div>

              <div className="vibrant-card p-10 bg-white border-2 border-slate-100 space-y-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-3 bg-emerald-50 rounded-xl">
                    <Zap className="h-5 w-5 text-emerald-600" />
                  </div>
                  <h4 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    Tax & Fees Setup
                  </h4>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-950 tracking-widest ml-2">
                      VAT / Tax Percentage (%)
                    </label>
                    <div className="flex gap-4">
                      <input
                        type="number"
                        value={taxInput}
                        onChange={(e) => setTaxInput(Number(e.target.value))}
                        className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-mono font-bold outline-none focus:border-emerald-500 transition-all text-slate-950"
                      />
                      <button
                        onClick={() => handleUpdateStore("taxRate", taxInput)}
                        disabled={isSaving}
                        className="px-8 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all"
                      >
                        Update
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 italic">
                      This rate will be automatically applied to all POS
                      transactions.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-950 tracking-widest ml-2">
                      Service Charge / Flat Fee
                    </label>
                    <div className="flex gap-4">
                      <input
                        type="number"
                        value={feeInput}
                        onChange={(e) => setFeeInput(Number(e.target.value))}
                        className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-mono font-bold outline-none focus:border-emerald-500 transition-all text-slate-950"
                      />
                      <button
                        onClick={() =>
                          handleUpdateStore("serviceFee", feeInput)
                        }
                        disabled={isSaving}
                        className="px-8 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all"
                      >
                        Update
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 italic">
                      Static fee added to the final checkout total.
                    </p>
                  </div>

                  <div className="space-y-2 pt-6 border-t border-slate-100">
                    <label className="text-[10px] font-black uppercase text-slate-950 tracking-widest ml-2 flex items-center justify-between">
                      <span>Allow Negative Stock (Overselling)</span>
                      <span className={cn(
                        "font-mono px-2 py-0.5 rounded text-[8px] tracking-wider",
                        allowNegativeStock ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                      )}>
                        {allowNegativeStock ? "ENABLED" : "DISABLED"}
                      </span>
                    </label>
                    <div className="flex gap-4 items-center">
                      <p className="flex-1 text-[10px] text-slate-400 italic">
                        By default, transactions fail if section stock is 0. Enable this to bypass stock validation prompts.
                      </p>
                      <button
                        onClick={async () => {
                          const nextVal = !allowNegativeStock;
                          setAllowNegativeStock(nextVal);
                          localStorage.setItem('store_allow_negative_stock', String(nextVal));
                          await handleUpdateStore("allowNegativeStock", nextVal);
                        }}
                        disabled={isSaving}
                        className={cn(
                          "px-6 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all whitespace-nowrap",
                          allowNegativeStock ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-slate-900 hover:bg-black text-white"
                        )}
                      >
                        {allowNegativeStock ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Store Address, Phone & Receipt Custom messages branding */}
              <div className="vibrant-card col-span-1 border-2 border-slate-100 bg-white p-10 space-y-8 md:col-span-2">
                <div className="mb-2 flex items-center gap-3">
                  <div className="bg-blue-50 p-3 rounded-xl">
                    <Printer className="h-5 w-5 text-blue-600" />
                  </div>
                  <h4 className="text-xl font-black uppercase tracking-tight text-slate-900">
                    Receipt Branding & Custom Message
                  </h4>
                </div>

                <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                  {/* Name, Address, and Phone inputs */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-950">
                        Store Display Name {profile?.role !== 'super_admin' && "(Managed by Global Admin)"}
                      </label>
                      <div className="flex gap-4">
                        {profile?.role === 'super_admin' ? (
                          <>
                            <input
                              type="text"
                              value={storeNameInput}
                              onChange={(e) => setStoreNameInput(e.target.value)}
                              className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-blue-500 transition-all text-slate-950 text-sm"
                              placeholder="BIZSEQ STORE"
                            />
                            <button
                              onClick={() => handleUpdateStore("name", storeNameInput)}
                              disabled={isSaving}
                              className="px-6 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all outline-none"
                            >
                              Update
                            </button>
                          </>
                        ) : (
                          <>
                            <input
                              type="text"
                              value={storeNameInput}
                              readOnly
                              className="flex-1 bg-slate-100 border-2 border-slate-200 rounded-2xl px-6 py-4 font-bold text-slate-500 text-sm cursor-not-allowed outline-none"
                              placeholder="BIZSEQ STORE"
                            />
                            <div className="px-6 bg-slate-200/50 text-slate-500 border border-slate-200 rounded-2xl font-black uppercase text-[9px] tracking-widest flex items-center justify-center cursor-not-allowed">
                              Locked
                            </div>
                          </>
                        )}
                      </div>
                      {profile?.role !== 'super_admin' && (
                        <p className="text-[10px] text-slate-400 italic ml-1">
                          Set during enrollment by Global Admin. Receipt other settings below remain fully customizable.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-950">
                        Store Address
                      </label>
                      <div className="flex gap-4">
                        <input
                          type="text"
                          value={storeAddressInput}
                          onChange={(e) => setStoreAddressInput(e.target.value)}
                          className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-blue-500 transition-all text-slate-950 text-sm"
                          placeholder="e.g. 123 Broad Street, Lagos"
                        />
                        <button
                          onClick={() =>
                            handleUpdateStore("storeAddress", storeAddressInput)
                          }
                          disabled={isSaving}
                          className="px-6 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all outline-none"
                        >
                          Update
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-950">
                        Store Phone Number
                      </label>
                      <div className="flex gap-4">
                        <input
                          type="text"
                          value={storePhoneInput}
                          onChange={(e) => setStorePhoneInput(e.target.value)}
                          className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-blue-500 transition-all text-slate-950 text-sm"
                          placeholder="e.g. +234 801 234 5678"
                        />
                        <button
                          onClick={() =>
                            handleUpdateStore("storePhone", storePhoneInput)
                          }
                          disabled={isSaving}
                          className="px-6 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all outline-none"
                        >
                          Update
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Header and Footer message inputs */}
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-950">
                        Receipt Header Custom Message
                      </label>
                      <div className="flex gap-4">
                        <input
                          type="text"
                          value={receiptHeaderInput}
                          onChange={(e) => setReceiptHeaderInput(e.target.value)}
                          className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-blue-500 transition-all text-slate-950 text-xs"
                          placeholder="e.g. Welcome to Bizseq! High quality daily needs."
                        />
                        <button
                          onClick={() =>
                            handleUpdateStore("receiptHeader", receiptHeaderInput)
                          }
                          disabled={isSaving}
                          className="px-6 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all outline-none"
                        >
                          Update
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-950">
                        Receipt Footer Custom Message
                      </label>
                      <div className="flex gap-4">
                        <textarea
                          value={receiptFooterInput}
                          onChange={(e) => setReceiptFooterInput(e.target.value)}
                          rows={3}
                          className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-blue-500 transition-all text-slate-950 text-xs resize-none"
                          placeholder="e.g. Goods sold in good condition are not returnable. Thank you!"
                        />
                        <button
                          onClick={() =>
                            handleUpdateStore("receiptFooter", receiptFooterInput)
                          }
                          disabled={isSaving}
                          className="px-6 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all shrink-0 h-fit self-end py-4 outline-none"
                        >
                          Update
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        );
      case "locations":
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-4 bg-slate-200 rounded-2xl hover:bg-slate-300 transition-all shadow-sm"
              >
                <ChevronLeft className="h-6 w-6 text-slate-900" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                Inventory Geography
              </h2>
            </div>

            <div className="vibrant-card p-10 bg-white border-2 border-slate-100 max-w-2xl">
              <p className="text-slate-400 font-bold italic mb-8">
                Specify physical locations within your store facility for
                precision stock tracking.
              </p>

              <div className="space-y-4">
                {locations.map((loc, index) => {
                  if (loc.id === '' || loc.id === undefined || loc.id === null) {
                    console.warn("TEMPORARY KEY DETECTOR:", { file: "Settings.tsx", component: "LocationsSettings", keyVal: loc.id });
                  }
                  return (
                    <div key={`set-loc-${loc.id || index}-${index}`} className="flex flex-col p-6 bg-slate-50 rounded-2xl border border-slate-100 group">
                    {editingLocationId === loc.id ? (
                      <div className="flex flex-col gap-3">
                        <label className="text-[10px] font-black uppercase text-slate-400">Edit Location Name</label>
                        <div className="flex items-center gap-2">
                          <input 
                            type="text"
                            value={editingLocationValue}
                            onChange={(e) => setEditingLocationValue(e.target.value)}
                            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                            placeholder="Location name..."
                            autoFocus
                          />
                          <button 
                            onClick={async () => {
                              if (editingLocationValue.trim()) {
                                await updateLocation({
                                  id: loc.id,
                                  name: editingLocationValue.trim()
                                });
                                setEditingLocationId(null);
                              }
                            }}
                            className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase text-[9px] rounded-lg"
                          >
                            Save
                          </button>
                          <button 
                            onClick={() => setEditingLocationId(null)}
                            className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black uppercase text-[9px] rounded-lg"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-blue-100 rounded-xl">
                            <Warehouse className="h-4 w-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-slate-900 uppercase">
                              {loc.name}
                            </p>
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                              {loc.description || "Active Inventory Node"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Edit
                            onClick={() => {
                              setEditingLocationId(loc.id);
                              setEditingLocationValue(loc.name);
                            }}
                            className="h-3.5 w-3.5 text-slate-300 hover:text-slate-950 cursor-pointer transition-colors"
                          />
                          <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100 uppercase text-[8px] font-black">
                            {loc.status || 'Active'}
                          </Badge>
                        </div>
                      </div>
                    )}
                  </div>
                );})}
                {locations.length === 0 && (
                  <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-center text-slate-400 font-bold italic">
                    No custom locations defined yet.
                  </div>
                )}
              </div>

              {showAddLocationInline ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mt-6 flex flex-col gap-3">
                  <span className="text-xs font-black text-slate-800 uppercase">Create New Location</span>
                  <input 
                    type="text"
                    value={newLocationInlineName}
                    onChange={(e) => setNewLocationInlineName(e.target.value)}
                    className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500 placeholder:text-slate-400 placeholder:font-medium"
                    placeholder="E.g., Warehouse B, Shelf 3..."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={async () => {
                        if (newLocationInlineName.trim()) {
                          await addLocation({
                            name: newLocationInlineName.trim(),
                            storeId: profile?.storeId || "",
                            status: "active",
                            description: "Custom Section"
                          });
                          setNewLocationInlineName("");
                          setShowAddLocationInline(false);
                        }
                      }}
                      className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition-colors"
                    >
                      Add Location
                    </button>
                    <button 
                      onClick={() => {
                        setShowAddLocationInline(false);
                        setNewLocationInlineName("");
                      }}
                      className="px-4 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black uppercase text-[10px] tracking-wider rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setShowAddLocationInline(true)}
                  className="w-full mt-8 py-5 border-2 border-dashed border-slate-200 text-slate-400 rounded-3xl font-black uppercase text-[10px] tracking-widest hover:border-slate-400 hover:text-slate-800 transition-all font-bold"
                >
                  + Add New Store Location
                </button>
              )}
            </div>
          </motion.div>
        );
      case "categories":
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-4 bg-slate-200 rounded-2xl hover:bg-slate-300 transition-all shadow-sm"
              >
                <ChevronLeft className="h-6 w-6 text-slate-900" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                Product Taxonomy
              </h2>
            </div>

            <div className="vibrant-card p-10 bg-white border-2 border-slate-100 max-w-2xl">
              <p className="text-slate-400 font-bold italic mb-8">
                Define standard categories to organize your POS interface and
                inventory reports.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from(new Set(categories)).map((cat, idx) => (
                  <div
                    key={`set-cat-${cat}-${idx}`}
                    className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col group gap-2"
                  >
                    {editingCategoryIndex === idx ? (
                      <div className="flex flex-col gap-2 w-full">
                        <label className="text-[9px] font-black uppercase text-slate-400">Rename Category</label>
                        <div className="flex items-center gap-2">
                          <input 
                            type="text"
                            value={editingCategoryValue}
                            onChange={(e) => setEditingCategoryValue(e.target.value)}
                            className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                            placeholder="Category name..."
                            autoFocus
                          />
                          <button 
                            onClick={async () => {
                              const cleanVal = editingCategoryValue.trim().toUpperCase();
                              if (cleanVal && cleanVal !== cat) {
                                const updated = categories.map((c, i) => i === idx ? cleanVal : c);
                                await handleUpdateCategories(updated);
                              }
                              setEditingCategoryIndex(null);
                            }}
                            className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase text-[8px] rounded-lg cursor-pointer"
                          >
                            Save
                          </button>
                          <button 
                            onClick={() => setEditingCategoryIndex(null)}
                            className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black uppercase text-[8px] rounded-lg cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : deletingCategoryName === cat ? (
                      <div className="flex flex-col gap-2 w-full">
                        <span className="text-[9px] font-black uppercase text-red-500">Delete category "{cat}"?</span>
                        <div className="flex gap-2">
                          <button 
                            onClick={async () => {
                              const updated = categories.filter((c, i) => i !== idx);
                              await handleUpdateCategories(updated);
                              setDeletingCategoryName(null);
                            }}
                            className="flex-1 py-1 px-2 bg-red-500 hover:bg-red-600 text-white font-black uppercase text-[8px] rounded-lg cursor-pointer animate-pulse"
                          >
                            Delete
                          </button>
                          <button 
                            onClick={() => setDeletingCategoryName(null)}
                            className="flex-1 py-1 px-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black uppercase text-[8px] rounded-lg cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between w-full">
                        <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">
                          {cat}
                        </span>
                        <div className="flex items-center gap-2">
                          <Edit
                            onClick={() => {
                              setEditingCategoryIndex(idx);
                              setEditingCategoryValue(cat);
                            }}
                            className="h-3.5 w-3.5 text-slate-300 hover:text-slate-950 cursor-pointer transition-colors"
                          />
                          <X
                            onClick={() => {
                              setDeletingCategoryName(cat);
                            }}
                            className="h-3.5 w-3.5 text-slate-300 hover:text-red-500 cursor-pointer transition-colors"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {showAddCategoryInline ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mt-6 flex flex-col gap-3">
                  <span className="text-xs font-black text-slate-800 uppercase">Define New Category</span>
                  <input 
                    type="text"
                    value={newCategoryInlineName}
                    onChange={(e) => setNewCategoryInlineName(e.target.value)}
                    className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-blue-500 placeholder:text-slate-400 placeholder:font-medium placeholder:normal-case"
                    placeholder="E.g., CANNED GOODS, PROVISIONS..."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={async () => {
                        const cleanName = newCategoryInlineName.trim().toUpperCase();
                        if (cleanName) {
                          if (categories.includes(cleanName)) {
                            alert("Category already exists!");
                            return;
                          }
                          await handleUpdateCategories([...categories, cleanName]);
                          setNewCategoryInlineName("");
                          setShowAddCategoryInline(false);
                        }
                      }}
                      className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl transition-colors cursor-pointer"
                    >
                      Add Category
                    </button>
                    <button 
                      onClick={() => {
                        setShowAddCategoryInline(false);
                        setNewCategoryInlineName("");
                      }}
                      className="px-4 py-3 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black uppercase text-[10px] tracking-wider rounded-xl transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddCategoryInline(true)}
                  className="w-full mt-8 py-5 border-2 border-dashed border-slate-200 text-slate-400 rounded-3xl font-black uppercase text-[10px] tracking-widest hover:border-slate-400 hover:text-slate-800 transition-all font-bold cursor-pointer"
                >
                  + Define Custom Category
                </button>
              )}
            </div>
          </motion.div>
        );
      case "printer":
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-3 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all"
              >
                <ChevronLeft className="h-5 w-5 text-slate-600" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                Peripheral Node
              </h2>
            </div>

            <div className="vibrant-card p-10 bg-white border-2 border-slate-100 max-w-2xl space-y-10">
              <div className="p-6 bg-slate-900 rounded-[2rem] text-white flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-emerald-600 rounded-2xl shadow-lg">
                    <Printer className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">
                      Active Printer
                    </p>
                    <p className="text-lg font-black tracking-tight">
                      {printerName}
                    </p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase rounded-lg border border-emerald-500/30">
                  Ready
                </div>
              </div>

              <div className="space-y-6">
                <div className="group">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-3">
                    Printer Configuration
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => {
                        const nextFormat =
                          printFormat === "80mm"
                            ? "58mm"
                            : printFormat === "58mm"
                              ? "standard"
                              : "80mm";
                        setPrintFormat(nextFormat);
                        localStorage.setItem(
                          "pos_selected_printer_format",
                          nextFormat,
                        );
                      }}
                      className="p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-center hover:border-slate-950 transition-all group active:scale-95 animate-pulse"
                    >
                      <p className="text-[10px] font-black text-slate-400 uppercase mb-2">
                        Paper Width (Toggle)
                      </p>
                      <p className="text-xl font-black text-slate-950 uppercase">
                        {printFormat}
                      </p>
                    </button>
                    <button className="p-6 bg-slate-50 border border-slate-100 rounded-2xl text-center hover:bg-slate-100 cursor-default transition-all group">
                      <p className="text-[10px] font-black text-slate-400 uppercase mb-2">
                        Interface
                      </p>
                      <p className="text-xl font-black text-slate-950">
                        USB/LAN
                      </p>
                    </button>
                  </div>
                </div>

                {/* Bluetooth Thermal Printer Setup Guide */}
                <div className="bg-slate-50 border border-slate-100 p-6 rounded-2xl space-y-4">
                  <div className="flex gap-3">
                    <span className="text-xl">💡</span>
                    <div>
                      <h5 className="font-extrabold text-sm text-slate-900 uppercase tracking-tight">
                        Connecting Bluetooth Thermal Printers (58mm / 80mm)
                      </h5>
                      <p className="text-[11px] text-slate-500 font-bold mt-1">
                        Yes, your Bluetooth printer will work seamlessly with BIZSEQ! Follow these quick pairing steps:
                      </p>
                    </div>
                  </div>

                  <ol className="text-[11px] text-slate-600 font-semibold space-y-2.5 pl-4 list-decimal">
                    <li>
                      <span className="font-extrabold text-slate-800">Pair via System Bluetooth:</span> Turn on your printer. Open your laptop, tablet, or phone's Bluetooth settings and pair with your mobile printer (often labeled as <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-[9px]">MTP-2</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-[9px]">PT-210</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-[9px]">POS-58</code>, or <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-[9px]">Bluetooth Printer</code>).
                    </li>
                    <li>
                      <span className="font-extrabold text-slate-800">Set Paper Width:</span> Toggle the <code className="bg-slate-200 px-1 py-0.5 rounded">Paper Width</code> option above to <code className="font-bold text-slate-900">58mm</code>. This tells BIZSEQ's layout engine to optimize font spacing and border alignments to prevent receipt text overflowing or getting cut off.
                    </li>
                    <li>
                      <span className="font-extrabold text-slate-800">Run Diagnostic Test:</span> Click the <code className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-800">Execute Test Print</code> button above to test.
                    </li>
                    <li>
                      <span className="font-extrabold text-slate-800">Margin Hint:</span> In the system print preview screen, set margins to <span className="text-blue-600 font-bold">None</span>, set size to fit mobile roll, and disable headers/footers for a perfect receipt layout.
                    </li>
                  </ol>
                </div>

                <button
                  onClick={() => {
                    handleTestPrint();
                  }}
                  className="w-full bg-white border-2 border-slate-950 text-slate-950 py-5 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-50 transition-all"
                >
                  Execute Test Print
                </button>
              </div>
            </div>
          </motion.div>
        );
      case "security":
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-4 bg-slate-200 rounded-2xl hover:bg-slate-300 transition-all shadow-sm"
              >
                <ChevronLeft className="h-6 w-6 text-slate-900" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                Enterprise Shield
              </h2>
            </div>

            <div className="vibrant-card p-10 bg-white border-2 border-slate-100 max-w-2xl relative overflow-hidden">
              <div className="space-y-6">
                <div>
                  <h4 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    Reset Security Password
                  </h4>
                  <p className="text-sm text-slate-400 font-bold mt-2">
                    Send password recovery reset credentials directly to your verified email:
                  </p>
                  <p className="text-sm text-emerald-600 font-mono font-bold mt-1 bg-emerald-50 px-3 py-2 rounded-lg w-fit">
                    {profile?.email}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    if (profile?.email) {
                      setIsSaving(true);
                      try {
                        const { auth } = await import("../services/firebase");
                        const { sendPasswordResetEmail } = await import("firebase/auth");
                        await sendPasswordResetEmail(auth, profile.email);
                        alert(`Password reset credentials successfully transmitted to ${profile.email}! Please verify your inbox.`);
                      } catch (err: any) {
                        alert(`Failed to transmit recovery credentials: ${err.message}`);
                      } finally {
                        setIsSaving(false);
                      }
                    }
                  }}
                  className="w-full bg-slate-950 text-white py-6 rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-black transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="h-5 w-5" />
                  Transmit Reset Credentials
                </button>
              </div>
            </div>
          </motion.div>
        );
      case "backup":
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-4 bg-slate-200 rounded-2xl hover:bg-slate-300 transition-all shadow-sm"
              >
                <ChevronLeft className="h-6 w-6 text-slate-900" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                Sync & Backup Node
              </h2>
            </div>

            <div className="vibrant-card p-10 bg-white border-2 border-slate-100 max-w-2xl relative overflow-hidden space-y-8">
              <div className="space-y-4">
                <h4 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                  <Database className="h-5 w-5 text-indigo-600" />
                  IndexedDB Engine Status
                </h4>
                <p className="text-sm text-slate-400 font-bold">
                  BIZSEQ runs an offline-first storage engine using browser-level Dexie IndexedDB cache to shield checkout stations from weak connections.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-6 bg-slate-50 border border-slate-100 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                    Cached Sales Count
                  </p>
                  <p className="text-3xl font-black text-slate-950 font-mono">
                    {diagStats.total}
                  </p>
                </div>
                <div className="p-6 bg-slate-50 border border-slate-100 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                    Cached Products
                  </p>
                  <p className="text-3xl font-black text-slate-950 font-mono">
                    {diagStats.inventory >= 0 ? Math.round(diagStats.inventory) : 0}
                  </p>
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  onClick={async () => {
                    try {
                      const allSales = await dexie.sales.toArray();
                      const allProds = await dexie.products.toArray();
                      const exportData = {
                        storeId: profile?.storeId,
                        timestamp: new Date().toISOString(),
                        localSales: allSales,
                        localProducts: allProds
                      };
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
                      const downloadAnchor = document.createElement('a');
                      downloadAnchor.setAttribute("href", dataStr);
                      downloadAnchor.setAttribute("download", `bizseq_backup_${profile?.storeId || 'store'}_${Date.now()}.json`);
                      document.body.appendChild(downloadAnchor);
                      downloadAnchor.click();
                      downloadAnchor.remove();
                    } catch (e: any) {
                      alert(`Backup download halted: ${e.message}`);
                    }
                  }}
                  className="flex-1 py-5 bg-slate-950 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-black transition-all text-center flex items-center justify-center gap-2"
                >
                  Download DB Backup
                </button>
                <button
                  onClick={() => {
                    window.location.reload();
                  }}
                  className="flex-1 py-5 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Force Full Cloud Resync
                </button>
              </div>
            </div>
          </motion.div>
        );
      default:
        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => setActiveModule(null)}
                className="p-3 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all"
              >
                <ChevronLeft className="h-5 w-5 text-slate-600" />
              </button>
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
                {sections.find((s) => s.id === activeModule)?.title}
              </h2>
            </div>
            <div className="p-20 bg-slate-50 rounded-[3rem] border-4 border-dashed border-slate-200 text-center">
              <h3 className="text-2xl font-black text-slate-300 uppercase tracking-tighter mb-4 italic">
                Module Calibrating
              </h3>
              <p className="text-slate-400 font-bold italic max-w-sm mx-auto">
                This diagnostic module is currently being finalized for
                high-density store environments.
              </p>
              <button
                onClick={() => setActiveModule(null)}
                className="mt-8 px-8 py-4 bg-slate-950 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest"
              >
                Return to Dashboard
              </button>
            </div>
          </motion.div>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-12 pb-24">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-slate-950 rounded-lg shadow-lg text-emerald-400">
              <SettingsIcon className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
              System Center
            </span>
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-slate-950 leading-none mb-4">
            Settings
          </h1>
          <p className="text-slate-500 font-bold text-lg italic max-w-lg mb-2">
            Configure operational parameters and system nodes.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Left: Configuration Matrix */}
        <div className="lg:col-span-2">
          {!activeModule ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {sections.map((section, i) => (
                <motion.button
                  key={section.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => selectModule(section.id)}
                  className="flex items-start text-left bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-emerald-500/10 hover:border-emerald-200 transition-all group active:scale-[0.98]"
                >
                  <div className="p-5 rounded-2xl bg-slate-50 text-slate-950 group-hover:bg-slate-950 group-hover:text-white mr-6 transition-all shadow-inner">
                    <section.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-black text-xl text-slate-950 tracking-tighter mb-1 uppercase leading-none">
                      {section.title}
                    </h3>
                    <p className="text-[11px] font-bold text-slate-400 italic group-hover:text-slate-500 transition-colors">
                      {section.desc}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-200 group-hover:text-slate-950 mt-1 transition-colors" />
                </motion.button>
              ))}
            </div>
          ) : (
            renderModule()
          )}
        </div>

        {/* Right: Administrator Profile Status */}
        <div className="space-y-8">
          <div className="vibrant-card p-10 bg-slate-950 text-white relative overflow-hidden shadow-2xl shadow-slate-950/20">
            <div className="relative z-10 mb-10 flex items-center justify-between">
              <div className="p-3 bg-white/10 rounded-xl backdrop-blur-md">
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">
                Terminal Node
              </span>
            </div>
            <div className="relative z-10 space-y-2 mb-10">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 opacity-60 italic">
                Operator
              </p>
              <h2 className="text-3xl font-black tracking-tight leading-none uppercase truncate">
                {profile?.username || "Unknown Staff"}
              </h2>
              <p className="text-xs font-bold text-slate-400 opacity-80">
                {profile?.email}
              </p>
            </div>
            <div className="relative z-10 pt-8 border-t border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-200">
                  System Live
                </span>
              </div>
            </div>
            <Zap className="absolute -right-12 -bottom-12 h-44 w-44 text-white/5 rotate-12" />
          </div>

          <div className="vibrant-card p-10 space-y-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Store Location Name
              </p>
              <p className="text-sm font-black text-slate-950 font-sans tracking-tight bg-slate-50 rounded-lg py-3 px-4 truncate">
                {profile?.store?.name || profile?.storeName || ""}
              </p>
            </div>
            <div className="pt-6 border-t border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">
                Sync Integrity
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs font-black text-slate-900 uppercase tracking-tight">
                    Verified
                  </span>
                </div>
                <span className="text-[11px] font-black font-mono text-emerald-600">
                  Stable
                </span>
              </div>
            </div>
          </div>

          <div className="vibrant-card p-10 bg-slate-50 border border-slate-200 text-slate-950 relative overflow-hidden shadow-sm">
            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Diagnostics Node
            </h4>
            <pre className="text-[10px] font-mono leading-relaxed bg-white p-4 rounded-2xl border border-slate-200 text-slate-800 select-all whitespace-pre-wrap break-all shadow-inner">
SYSTEM DIAGNOSTICS:
{JSON.stringify({
  user: profile?.username || profile?.email || "admin",
  role: profile?.role || "store_admin",
  storeId: profile?.storeId || "N/A",
  stats: {
    daily: diagStats.daily,
    total: diagStats.total,
    inventory: diagStats.inventory
  }
}, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
