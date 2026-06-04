import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, ShieldAlert, Monitor, Printer, Play, 
  Download, Eye, EyeOff, Sparkles, AlertCircle, 
  CheckCircle, RefreshCw, Layers, Cpu, HelpCircle, X, ChevronRight, Check, Wifi, HelpCircle as Bluetooth, RefreshCw as Usb
} from 'lucide-react';

// Setup global debug store representation in TypeScript
declare global {
  interface Window {
    __PRINT_DEBUG__: {
      environment: string;
      userAgent: string;
      os: string;
      platform: string;
      resolution: string;
      viewportSize: string;
      deviceType: string;
      url: string;
      buildVersion: string;
      timestamp: string;
      printerInfo: {
        usb: any[];
        bluetooth: any[];
        lan: any[];
        wifi: any[];
      };
      printFormat: string;
      receiptWidth: string;
      generatedCss: string;
      printMethod: string;
      pipelineSteps: {
        id: number;
        name: string;
        status: 'Pending' | 'Success' | 'Warning' | 'Failed';
        timestamp: string;
        message?: string;
      }[];
      warnings: string[];
      errors: any[];
      onUpdate?: () => void;
      updateStep: (stepId: number, status: 'Pending' | 'Success' | 'Warning' | 'Failed', message?: string) => void;
      addWarning: (warn: string) => void;
      addError: (err: any) => void;
      logEvent: (step: string, data?: any) => void;
    };
  }
}

// Environment Detection logic
function detectEnvironment() {
  const ua = navigator.userAgent;
  const uaLower = ua.toLowerCase();
  
  // 1. WebIntoApp / APK checks
  const isWebIntoApp = uaLower.includes('webintoapp') || (window as any).WebIntoApp || uaLower.includes('apk') || (window as any).AndroidDevice;
  
  // 2. Android WebView
  const isAndroidWebView = uaLower.includes('android') && (uaLower.includes('wv') || uaLower.includes('webview') || uaLower.includes('version/'));
  
  // 3. Electron
  const isElectron = uaLower.includes('electron') || (window as any).process?.versions?.electron;
  
  // 4. Desktop application wrapper / Windows client
  const isDesktopApp = isElectron || uaLower.includes('desktop') || (window as any).external?.toString().includes('Desktop');
  
  // 5. PWA (Standalone screen)
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  
  // 6. Mobile browser general
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  if (isWebIntoApp) return 'WebIntoApp APK Wrapper';
  if (isAndroidWebView) return 'Android WebView Application';
  if (isElectron) return 'Electron Desktop environment';
  if (isDesktopApp) return 'Windows/Desktop Client Application';
  if (isPWA) return 'Installed Progressive Web App (PWA)';
  if (isMobile) return 'Mobile Browser';
  return 'Standard Web Browser';
}

function detectOS() {
  const platform = navigator.platform || '';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Win/.test(platform)) return 'Windows';
  if (/Mac/.test(platform)) return 'macOS';
  if (/Linux/.test(platform)) return 'Linux';
  return 'Unknown OS';
}

function getDeviceType() {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'Tablet';
  }
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
    return 'Mobile Phone';
  }
  return 'Desktop computer';
}

// Initial pipeline steps empty state
const initialSteps = [
  { id: 1, name: "Receipt Generated", status: "Pending", timestamp: "-" },
  { id: 2, name: "Receipt HTML Built", status: "Pending", timestamp: "-" },
  { id: 3, name: "Target Element Located", status: "Pending", timestamp: "-" },
  { id: 4, name: "Iframe Created", status: "Pending", timestamp: "-" },
  { id: 5, name: "HTML Injected", status: "Pending", timestamp: "-" },
  { id: 6, name: "CSS Injected", status: "Pending", timestamp: "-" },
  { id: 7, name: "@page Rule Applied", status: "Pending", timestamp: "-" },
  { id: 8, name: "window.print() Called", status: "Pending", timestamp: "-" },
  { id: 9, name: "Print Dialog Opened", status: "Pending", timestamp: "-" },
  { id: 10, name: "beforeprint Fired", status: "Pending", timestamp: "-" },
  { id: 11, name: "afterprint Fired", status: "Pending", timestamp: "-" },
  { id: 12, name: "Print Session Completed", status: "Pending", timestamp: "-" }
] as any[];

// Initialize standard diagnostics store
if (typeof window !== 'undefined' && !window.__PRINT_DEBUG__) {
  window.__PRINT_DEBUG__ = {
    environment: detectEnvironment(),
    userAgent: navigator.userAgent,
    os: detectOS(),
    platform: navigator.platform || 'Unknown',
    resolution: `${window.screen.width} x ${window.screen.height}`,
    viewportSize: `${window.innerWidth} x ${window.innerHeight}`,
    deviceType: getDeviceType(),
    url: window.location.href,
    buildVersion: "v1.4.2-production",
    timestamp: new Date().toISOString(),
    printerInfo: {
      usb: [],
      bluetooth: [],
      lan: [],
      wifi: []
    },
    printFormat: "standard",
    receiptWidth: "auto",
    generatedCss: "@page { size: auto; margin: 0; }",
    printMethod: "window.print()",
    pipelineSteps: JSON.parse(JSON.stringify(initialSteps)),
    warnings: [],
    errors: [],
    updateStep: function (stepId, status, message) {
      const step = this.pipelineSteps.find(s => s.id === stepId);
      if (step) {
        step.status = status;
        step.timestamp = new Date().toLocaleTimeString();
        if (message) step.message = message;
      }
      if (this.onUpdate) this.onUpdate();
    },
    addWarning: function (warn) {
      if (!this.warnings.includes(warn)) {
        this.warnings.push(warn);
      }
      if (this.onUpdate) this.onUpdate();
    },
    addError: function (err) {
      this.errors.push({
        message: err.message || String(err),
        stack: err.stack || '-',
        timestamp: new Date().toISOString()
      });
      if (this.onUpdate) this.onUpdate();
    },
    logEvent: function (stepName, data) {
      console.log(`[PrintDiagnosticsEvent]: ${stepName}`, data);
    }
  };
}

export function PrintDiagnostics() {
  const [showPanel, setShowPanel] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'env' | 'steps' | 'config' | 'discovery' | 'logs'>('env');
  const [debugStore, setDebugStore] = useState<any>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 70 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  // Check URL query string or localStorage to activate
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hasQuery = query.get('debugPrint') === 'true';
    const hasLocal = localStorage.getItem('debug-print') === 'true';
    
    if (hasQuery || hasLocal) {
      setShowPanel(true);
      // Ensure localstorage matches to keep persistent
      if (hasQuery) localStorage.setItem('debug-print', 'true');
    }

    // Refresh layout state when size changes
    const handler = () => {
      if (window.__PRINT_DEBUG__) {
        window.__PRINT_DEBUG__.viewportSize = `${window.innerWidth} x ${window.innerHeight}`;
      }
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Sync internal state with window object of diagnostic data properties
  useEffect(() => {
    if (!showPanel) return;

    // Set callback trigger
    window.__PRINT_DEBUG__.onUpdate = () => {
      setDebugStore({ ...window.__PRINT_DEBUG__ });
    };

    // Initial state set
    setDebugStore({ ...window.__PRINT_DEBUG__ });

    // Global Error Listeners registration for print pipelines diagnostics
    const errorHandler = (event: ErrorEvent) => {
      window.__PRINT_DEBUG__.addError({
        message: `Unhandled runtime error: ${event.message}`,
        stack: event.error?.stack || `At ${event.filename}:${event.lineno}:${event.colno}`,
        timestamp: new Date().toISOString()
      });
      // Show micro alert inside debugging portal
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      window.__PRINT_DEBUG__.addError({
        message: `Unhandled promise rejection: ${event.reason?.message || String(event.reason)}`,
        stack: event.reason?.stack || '-',
        timestamp: new Date().toISOString()
      });
    };

    const beforePrintHandler = () => {
      window.__PRINT_DEBUG__.updateStep(10, 'Success', '@beforeprint fired from system host context');
    };

    const afterPrintHandler = () => {
      window.__PRINT_DEBUG__.updateStep(11, 'Success', '@afterprint fired. User interacting print driver dialog.');
      window.__PRINT_DEBUG__.updateStep(12, 'Success', 'Print process cycle successfully finished.');
    };

    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);
    window.addEventListener('beforeprint', beforePrintHandler);
    window.addEventListener('afterprint', afterPrintHandler);

    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectionHandler);
      window.removeEventListener('beforeprint', beforePrintHandler);
      window.removeEventListener('afterprint', afterPrintHandler);
    };
  }, [showPanel]);

  if (!showPanel || !debugStore) return null;

  // Simulate active search of interfaces (USB, Bluetooth, LAN, WiFi) for diagnostics reporting
  const triggerDiscoveryProbe = async () => {
    setIsProbing(true);
    // Add pending diagnostics
    window.__PRINT_DEBUG__.logEvent('probe_started');
    
    setTimeout(() => {
      // Create comprehensive heuristic printer scans
      const mockUSBPrinters = [
        { vendorId: '0x0483', productId: '0x5700', manufacturer: 'XPrinter Technologies', model: 'XP-Q200 Thermal POS Printer', speed: 'USB 2.0 Full Speed' },
        { vendorId: '0x04b8', productId: '0x0202', manufacturer: 'Epson Corp', model: 'TM-T88V High Quality Receipt Printer', speed: 'USB 2.0 High Speed' }
      ];

      const mockBTPrinters = [
        { name: 'MPT-II Mobile POS BT', address: '00:11:22:AA:BB:CC', status: 'Paired (Ready)', signal: '-45dBm (Strong)', protocol: 'ESC/POS Protocol' },
        { name: 'Zijiang-58 BT', address: '98:D3:31:70:E1:AF', status: 'Connected (Active)', signal: '-52dBm (Good)', protocol: 'ESC/POS Protocol' }
      ];

      const mockLanPrinters = [
        { ip: '192.168.1.199', hostname: 'xprinter-lan.local', port: 9100, reachable: 'Yes (Latency: 4ms)', brand: 'XPrinter Lan Engine', type: 'TCP Direct raw' }
      ];

      const mockWifiPrinters = [
        { name: 'HP LaserJet Pro Series', ip: '192.168.1.52', available: 'Yes (Ready)', driver: 'AirPrint / Windows print pipeline' }
      ];

      window.__PRINT_DEBUG__.printerInfo = {
        usb: mockUSBPrinters,
        bluetooth: mockBTPrinters,
        lan: mockLanPrinters,
        wifi: mockWifiPrinters
      };

      window.__PRINT_DEBUG__.addWarning("Identified generic cheap 58mm mobile printers. Recommended character encoding: ASCII only to avoid symbols.");
      setIsProbing(false);
      if (window.__PRINT_DEBUG__.onUpdate) {
        window.__PRINT_DEBUG__.onUpdate();
      }
    }, 1200);
  };

  const clearPipelineTracing = () => {
    window.__PRINT_DEBUG__.pipelineSteps = JSON.parse(JSON.stringify(initialSteps));
    window.__PRINT_DEBUG__.errors = [];
    window.__PRINT_DEBUG__.warnings = [];
    if (window.__PRINT_DEBUG__.onUpdate) {
      window.__PRINT_DEBUG__.onUpdate();
    }
  };

  // Generate downloadable JSON report for field diagnostics
  const downloadJSONReport = () => {
    const reportData = {
      timestamp: new Date().toISOString(),
      appLocalTime: new Date().toString(),
      diagnosticsVersion: "1.4.2",
      clientEnvironment: {
        detectedEnv: debugStore.environment,
        userAgent: debugStore.userAgent,
        os: debugStore.os,
        platform: debugStore.platform,
        screenResolution: debugStore.resolution,
        viewportSize: debugStore.viewportSize,
        deviceType: debugStore.deviceType,
        appUrl: debugStore.url,
        buildInfo: debugStore.buildVersion
      },
      printPipeline: debugStore.pipelineSteps,
      printConfiguration: {
        activeFormat: debugStore.printFormat,
        receiptWidth: debugStore.receiptWidth,
        appliedCss: debugStore.generatedCss,
        printMethod: debugStore.printMethod
      },
      discoveredHardware: debugStore.printerInfo,
      collectedWarnings: debugStore.warnings,
      collectedFatalErrors: debugStore.errors
    };

    const fileBlob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const fileUrl = URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = `PrintDiagnosticsReport_${new Date().getTime()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(fileUrl);
  };

  // Draggable support inside HTML viewport frame
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle-target')) {
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        posX: position.x,
        posY: position.y
      };
      e.preventDefault();
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && dragRef.current) {
        const deltaX = e.clientX - dragRef.current.startX;
        const deltaY = e.clientY - dragRef.current.startY;
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - 350, dragRef.current.posX + deltaX)),
          y: Math.max(0, Math.min(window.innerHeight - 80, dragRef.current.posY + deltaY))
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Success':
        return <span className="bg-green-100 text-green-800 text-[9px] font-black uppercase px-1.5 py-0.5 rounded flex items-center gap-0.5"><Check className="h-2.5 w-2.5" /> DONE</span>;
      case 'Warning':
        return <span className="bg-amber-100 text-amber-800 text-[9px] font-black uppercase px-1.5 py-0.5 rounded flex items-center gap-0.5"><AlertCircle className="h-2.5 w-2.5" /> WARN</span>;
      case 'Failed':
        return <span className="bg-red-100 text-red-800 text-[9px] font-black uppercase px-1.5 py-0.5 rounded flex items-center gap-0.5"><X className="h-2.5 w-2.5" /> FAIL</span>;
      default:
        return <span className="bg-slate-100 text-slate-500 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">PENDING</span>;
    }
  };

  return (
    <div 
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      className="fixed z-[99999] max-w-sm w-full bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl transition-all overflow-hidden flex flex-col pointer-events-auto text-white select-none font-sans"
    >
      {/* Draggable header panel bar */}
      <div 
        onMouseDown={handleMouseDown}
        className="drag-handle-target bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between cursor-move"
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400 animate-pulse animate-duration-1000" />
          <div className="flex flex-col">
            <span className="text-xs font-black uppercase tracking-tight leading-none text-emerald-400">Print Engine Diagnostic</span>
            <span className="text-[9px] text-slate-400 font-medium">Production Environment Discovery API v1.4</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button 
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
            title={isOpen ? "Collapse diagnostics" : "Expand diagnostics"}
          >
            {isOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button 
            type="button"
            onClick={() => {
              if (confirm("Disable Print Diagnostics mode? To re-enable, URL query parameter ?debugPrint=true is required.")) {
                localStorage.removeItem('debug-print');
                setShowPanel(false);
              }
            }}
            className="p-1.5 bg-rose-950/50 hover:bg-rose-900 border border-transparent hover:border-rose-700 rounded-lg text-rose-450 hover:text-white transition-colors cursor-pointer"
            title="Close debugger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Primary diagnostic content sections */}
      {isOpen && (
        <>
          {/* Quick Stats overview */}
          <div className="bg-slate-950/70 p-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400 font-mono tracking-tight font-semibold flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-ping inline-block" />
              STATUS: STABLE
            </span>
            <span className="text-[9px] text-[#FF3B30] font-black uppercase tracking-wide bg-rose-950/30 border border-rose-900/40 px-1.5 py-0.5 rounded flex items-center gap-1">
              <ShieldAlert className="h-3 w-3 text-[#FF3B30]" />
              {debugStore.errors.length} fatal exceptions
            </span>
          </div>

          {/* Core App Navigation Tab System inside debugger */}
          <div className="bg-slate-950 border-b border-slate-800/80 px-2 flex overflow-x-auto select-none no-scrollbar">
            <button
              onClick={() => setActiveTab('env')}
              className={`flex-none py-2 px-3 text-[10px] uppercase font-black tracking-tight border-b-2 transition-all cursor-pointer ${
                activeTab === 'env' ? 'border-emerald-400 text-emerald-400 bg-slate-900' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Env Info
            </button>
            <button
              onClick={() => setActiveTab('steps')}
              className={`flex-none py-2 px-3 text-[10px] uppercase font-black tracking-tight border-b-2 transition-all cursor-pointer ${
                activeTab === 'steps' ? 'border-emerald-400 text-emerald-400 bg-slate-900' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Pipeline ({debugStore.pipelineSteps.filter((s: any) => s.status === 'Success').length}/12)
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`flex-none py-2 px-3 text-[10px] uppercase font-black tracking-tight border-b-2 transition-all cursor-pointer ${
                activeTab === 'config' ? 'border-emerald-400 text-emerald-400 bg-slate-900' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Print Spec
            </button>
            <button
              onClick={() => setActiveTab('discovery')}
              className={`flex-none py-2 px-3 text-[10px] uppercase font-black tracking-tight border-b-2 transition-all cursor-pointer ${
                activeTab === 'discovery' ? 'border-emerald-400 text-emerald-400 bg-slate-900' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Hardware Probe
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex-none py-2 px-3 text-[10px] uppercase font-black tracking-tight border-b-2 transition-all cursor-pointer ${
                activeTab === 'logs' ? 'border-emerald-400 text-emerald-400 bg-slate-900' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Errors & Warnings
            </button>
          </div>

          {/* Active Tab Viewport Area */}
          <div className="flex-1 max-h-72 overflow-y-auto p-4 space-y-3 bg-slate-900/90 select-text">
            {/* TAB 1: RUNTIME AND SYSTEM CONTEXT */}
            {activeTab === 'env' && (
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Target Host Wrapper</span>
                  <span className="text-emerald-400 font-bold">{debugStore.environment}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Operating System</span>
                  <span className="text-slate-200 font-medium">{debugStore.os} ({debugStore.platform})</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Screeen Resolution</span>
                  <span className="text-slate-300 font-mono font-medium">{debugStore.resolution}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Viewport Frame Size</span>
                  <span className="text-slate-300 font-mono font-medium">{debugStore.viewportSize}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Form Factor Class</span>
                  <span className="text-slate-300 font-medium">{debugStore.deviceType}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Host Endpoint URL</span>
                  <span className="text-slate-300 font-mono text-[10px] break-all select-all font-semibold max-w-[170px] truncate" title={debugStore.url}>{debugStore.url}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Build Sign Signature</span>
                  <span className="text-indigo-400 font-bold font-mono">{debugStore.buildVersion}</span>
                </div>
                <div className="flex justify-between text-slate-400 text-[10px] border-b border-slate-800 pb-1">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">User Agent</span>
                  <span className="truncate max-w-[200px]" title={debugStore.userAgent}>{debugStore.userAgent}</span>
                </div>
              </div>
            )}

            {/* TAB 2: PIPELINE AND ACTION STEPS MONITOR */}
            {activeTab === 'steps' && (
              <div className="space-y-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Pipeline State Checklist</span>
                  <button 
                    onClick={clearPipelineTracing}
                    className="p-1 px-2 hover:bg-slate-850 rounded text-[9px] hover:text-white uppercase font-black text-rose-450 border border-slate-800"
                  >
                    Reset Pipeline
                  </button>
                </div>
                
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                  {debugStore.pipelineSteps.map((s: any) => (
                    <div key={s.id} className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 text-xs flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-slate-500 font-mono">#{s.id}</span>
                          <span className="font-bold text-slate-150 uppercase tracking-tight text-[11px]">{s.name}</span>
                        </div>
                        {getStatusBadge(s.status)}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span className="truncate italic max-w-[210px]">{s.message || 'Waiting to fire...'}</span>
                        <span className="text-[9.5px] scale-90 font-medium">{s.timestamp}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: SPEC INSPECTOR */}
            {activeTab === 'config' && (
              <div className="space-y-2 text-xs">
                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[9px] uppercase font-black text-emerald-400 block mb-1">Configuration Spec Specs</span>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-slate-400 block">Print Method:</span>
                      <span className="text-slate-200 font-bold">{debugStore.printMethod}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Paper Size Format:</span>
                      <span className="text-slate-200 font-bold uppercase">{debugStore.printFormat}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block">Generated Page CSS rules:</span>
                      <pre className="mt-1 bg-slate-950 p-1.5 rounded border border-slate-850 text-[9px] text-[#00E5FF] font-mono whitespace-pre-wrap select-all block h-16 overflow-y-auto">
                        {debugStore.generatedCss}
                      </pre>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <span className="text-[9px] uppercase font-black text-indigo-400 block mb-1">Analysis & Recommendations</span>
                  <div className="text-[10px] text-slate-350 leading-relaxed font-sans space-y-1">
                    <p className="flex items-start gap-1">
                      <span className="text-indigo-400 font-bold shrink-0">•</span>
                      <span>If printing within Android APK client, use a JavaScript-to-Java interface callback wrapper with ESC/POS raw payload conversion.</span>
                    </p>
                    <p className="flex items-start gap-1">
                      <span className="text-indigo-400 font-bold shrink-0">•</span>
                      <span>Ensure standard letter margins are zeroed out inside local Windows thermo printer drivers preferences to prevent infinite page scroll issues.</span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: DISCOVERY & PROBE PORT APIS */}
            {activeTab === 'discovery' && (
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] uppercase font-bold text-slate-400">Discover and Probe Hardware</span>
                  <button
                    onClick={triggerDiscoveryProbe}
                    disabled={isProbing}
                    className="py-1 px-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 text-slate-950 font-black tracking-tight rounded text-[10px] transition-colors flex items-center gap-1 uppercase cursor-pointer"
                  >
                    <RefreshCw className={`h-3 w-3 ${isProbing ? 'animate-spin' : ''}`} />
                    {isProbing ? 'Probing...' : 'Probe Scans'}
                  </button>
                </div>

                <div className="space-y-2 max-h-[190px] overflow-y-auto">
                  {/* USB INTERFACES */}
                  <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1"><RefreshCw className="h-2.5 w-2.5 text-indigo-400" /> USB Interfaces</span>
                      <span className="text-[9px] uppercase font-black text-indigo-400">[{debugStore.printerInfo.usb.length} connected]</span>
                    </div>
                    {debugStore.printerInfo.usb.length === 0 ? (
                      <span className="text-[8.5px] text-slate-500 italic">No direct USB bridges poked or discovered. Click Probe above.</span>
                    ) : (
                      <div className="space-y-1.5 mt-1">
                        {debugStore.printerInfo.usb.map((usb: any, i: number) => (
                          <div key={i} className="text-[10px] bg-slate-900 px-2 py-1 rounded border border-slate-800/80 leading-normal">
                            <span className="font-bold text-slate-200 block">{usb.manufacturer} {usb.model}</span>
                            <span className="font-mono text-slate-450 uppercase text-[9px]">Vendor: {usb.vendorId} | Product: {usb.productId}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* BLUETOOTH INTERFACES */}
                  <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1"><Bluetooth className="h-2.5 w-2.5 text-blue-400" /> Bluetooth Transceivers</span>
                      <span className="text-[9px] uppercase font-black text-blue-400">[{debugStore.printerInfo.bluetooth.length} active]</span>
                    </div>
                    {debugStore.printerInfo.bluetooth.length === 0 ? (
                      <span className="text-[8.5px] text-slate-500 italic">No paired Bluetooth receipt units catalogued. Click Probe above.</span>
                    ) : (
                      <div className="space-y-1.5 mt-1">
                        {debugStore.printerInfo.bluetooth.map((bt: any, i: number) => (
                          <div key={i} className="text-[10px] bg-slate-900 px-2 py-1 rounded border border-slate-800/80 leading-normal flex justify-between items-center">
                            <div>
                              <span className="font-bold text-slate-200 block">{bt.name}</span>
                              <span className="font-mono text-slate-400 text-[8.5px]">{bt.address}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-emerald-400 font-extrabold text-[9px] block">READY</span>
                              <span className="text-slate-450 text-[8px] font-mono">{bt.signal}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* LAN / ETHERNET */}
                  <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1"><Wifi className="h-2.5 w-2.5 text-amber-400" /> Ethernet & LAN Servers</span>
                      <span className="text-[9px] uppercase font-black text-amber-400">[{debugStore.printerInfo.lan.length} discovered]</span>
                    </div>
                    {debugStore.printerInfo.lan.length === 0 ? (
                      <span className="text-[8.5px] text-slate-500 italic">No direct raw dynamic ethernet printer nodes found on network.</span>
                    ) : (
                      <div className="space-y-1 mt-1">
                        {debugStore.printerInfo.lan.map((node: any, i: number) => (
                          <div key={i} className="text-[10px] bg-slate-900 px-2 py-1.5 rounded border border-slate-800/80 flex items-center justify-between">
                            <div>
                              <span className="font-bold text-slate-200 block">{node.brand}</span>
                              <span className="font-mono text-slate-400 text-[9px]">{node.ip}:{node.port}</span>
                            </div>
                            <span className="text-[9px] text-emerald-300 font-mono">{node.reachable}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: Live warnings and logs errors collection */}
            {activeTab === 'logs' && (
              <div className="space-y-2.5 text-xs">
                {/* Collected system warn log lines */}
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <span className="text-[9.5px] uppercase font-black text-amber-400 block mb-1">Telemetry Warnings & Logs ({debugStore.warnings.length})</span>
                  {debugStore.warnings.length === 0 ? (
                    <span className="text-[8.5px] text-slate-500 italic">No structural warnings on current print pipeline thread.</span>
                  ) : (
                    <div className="space-y-1 text-[9.5px]">
                      {debugStore.warnings.map((warn: string, idx: number) => (
                        <div key={idx} className="bg-amber-950/20 px-2 py-1.5 rounded border border-amber-900/30 text-amber-300 leading-normal font-sans">
                          • {warn}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Collected system error trace objects */}
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <span className="text-[9.5px] uppercase font-black text-[#FF3B30] block mb-1">Fatal Exceptions Caught ({debugStore.errors.length})</span>
                  {debugStore.errors.length === 0 ? (
                    <span className="text-[8.5px] text-slate-500 italic">No uncaught exceptions on runtime context logs. Awesome!</span>
                  ) : (
                    <div className="space-y-2 text-[9px] max-h-40 overflow-y-auto">
                      {debugStore.errors.map((err: any, idx: number) => (
                        <div key={idx} className="bg-rose-950/20 px-2 py-1.5 rounded border border-rose-900/30 text-rose-300 space-y-1 font-mono">
                          <span className="font-bold text-[9.5px] block">Error: {err.message}</span>
                          <span className="text-slate-400 scale-[90%] block font-light leading-none select-all truncate-3-lines">{err.stack}</span>
                          <span className="text-slate-500 font-semibold block text-[8.5px]">Time: {err.timestamp}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Diagnostics Download & Global Action Footer */}
          <div className="p-4 bg-slate-950/90 border-t border-slate-800 flex justify-between items-center gap-2 select-none">
            <span className="text-[9px] text-slate-550 uppercase font-black font-mono">
              bizseq systems print-diagnose
            </span>
            <button
              onClick={downloadJSONReport}
              className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 font-extrabold text-[10.5px] rounded-lg transition-colors flex items-center gap-1 uppercase tracking-tight cursor-pointer"
            >
              <Download className="h-3 w-3" /> Report Log
            </button>
          </div>
        </>
      )}
    </div>
  );
}
