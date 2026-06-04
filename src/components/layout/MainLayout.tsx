import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  History, 
  Users, 
  Settings, 
  LogOut,
  Menu,
  X,
  ShieldCheck,
  Building2,
  ArrowLeft,
  ArrowRight,
  BarChart3
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const MainLayout: React.FC = () => {
  const { profile, signOut, reconnecting } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  React.useEffect(() => {
    if (profile) {
    }
  }, [profile]);

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'POS System', path: '/pos', icon: ShoppingCart, external: true },
    { name: 'Inventory', path: '/inventory', icon: Package },
    { name: 'Sales History', path: '/sales', icon: History },
    { name: 'Customers', path: '/customers', icon: Users },
    { name: 'Suppliers', path: '/suppliers', icon: Building2 },
    { name: 'Staff Management', path: '/staff', icon: Users, adminOnly: true },
    { name: 'Reports', path: '/reports', icon: BarChart3, reportsOnly: true },
    { name: 'Super Admin', path: '/super-admin', icon: Building2, superAdminOnly: true },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  const filteredNavItems = navItems.filter(item => {
    if (item.superAdminOnly) return profile?.role === 'super_admin';
    if (item.adminOnly) return profile?.role === 'store_admin' || profile?.role === 'super_admin';
    
    // Explicit role restrictions
    const role = profile?.role;

    if (item.reportsOnly) {
      return role === 'store_admin' || role === 'manager' || role === 'super_admin';
    }
    
    // Cashier: POS Only
    if (role === 'cashier') {
      return item.path === '/pos' || item.path === '/'; // Dashboard allowed for basic overview
    }
    
    // Staff: POS + View Inventory (but Dashboard, History, etc allowed)
    if (role === 'staff') {
      return item.path !== '/staff' && item.path !== '/reports'; // Can't manage staff or reports
    }
    
    // Manager: POS + Manage Inventory
    if (role === 'manager') {
      return item.path !== '/staff'; // Can't manage staff
    }
    
    return true;
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-80 bg-white border-r border-slate-200 transition-all duration-500 lg:relative lg:translate-x-0 shadow-xl",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-full flex-col">
          {/* Logo Section */}
          <div className="flex h-28 items-center px-10">
            <Link to="/" className="flex items-center gap-3 group cursor-pointer">
              <div className="p-3 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20 group-hover:rotate-12 transition-transform duration-500">
                <ShieldCheck className="h-7 w-7 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-black tracking-tighter text-slate-900 leading-none">BizSeq</span>
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-600 mt-1">System Hub</span>
              </div>
            </Link>
          </div>

          {/* User Profile Badge - SLEEK */}
          <div className="px-8 py-4">
            <Link 
              to="/settings"
              className="block bg-slate-50 hover:bg-slate-100 rounded-[2.5rem] p-6 border border-slate-200 relative overflow-hidden group transition-all"
            >
              <div className="flex items-center gap-4 relative z-10">
                <div className="h-14 w-14 rounded-2xl bg-slate-900 flex items-center justify-center text-white font-black text-2xl shadow-lg group-hover:scale-105 transition-transform">
                  {profile?.username?.charAt(0).toUpperCase() || profile?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-black truncate text-slate-900">{profile?.username || profile?.email?.split('@')[0] || 'User'}</p>
                  <p className="text-[10px] uppercase tracking-[0.25em] font-black text-emerald-600 mt-1">
                    {profile?.role === 'super_admin' ? '💎 Global Admin' : 
                     (profile?.role === 'store_admin' ? '🏬 Store Admin' : 
                      (profile?.role === 'manager' ? '📋 Manager' : 
                       (profile?.role === 'staff' ? '👤 Staff' : '👤 Cashier')))}
                  </p>
                </div>
              </div>
              
              <div className="mt-5 px-4 py-2.5 bg-white border border-slate-200 text-slate-900 rounded-2xl text-[10px] font-black uppercase tracking-widest text-center shadow-sm relative z-10">
                {profile?.role === 'super_admin' ? 'Admin Mode' : 'Store Dashboard'}
              </div>

              {/* Decorative background for the badge */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl group-hover:bg-emerald-500/10 transition-colors" />
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-8 py-10 space-y-3 overflow-y-auto custom-scrollbar">
            {filteredNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  onClick={() => setIsSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-4 px-6 py-5 rounded-2xl text-[13px] font-black transition-all group relative overflow-hidden",
                    isActive 
                      ? "bg-slate-900 text-white shadow-xl shadow-slate-900/10" 
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive ? "text-emerald-400" : "group-hover:scale-110 transition-transform")} />
                  <span className="relative z-10">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div className="p-6">
            <button
              onClick={handleSignOut}
              className="flex w-full items-center justify-center rounded-2xl py-4 text-[10px] font-black uppercase tracking-[0.25em] text-red-500 hover:bg-red-50 hover:text-red-600 transition-all border-2 border-transparent hover:border-red-100 group"
            >
              <LogOut className="mr-3 h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 overflow-hidden relative">
        {/* Sleek Header */}
        <header className="flex h-24 items-center justify-between px-10 bg-white/50 backdrop-blur-xl border-b border-mint-100/50 sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="rounded-2xl p-3 text-mint-950 bg-white border border-mint-100 shadow-sm lg:hidden hover:scale-105 active:scale-95 transition-all"
            >
              <Menu className="h-6 w-6" />
            </button>
            
            <div className="hidden sm:flex items-center gap-2">
               <button 
                onClick={() => navigate(-1)}
                className="p-3 bg-white border border-mint-100 rounded-2xl text-mint-950 hover:bg-mint-50 transition-all shadow-sm group"
                title="Go Back"
               >
                  <ArrowLeft className="h-5 w-5 group-active:-translate-x-1 transition-transform" />
               </button>
               <button 
                onClick={() => navigate(1)}
                className="p-3 bg-white border border-mint-100 rounded-2xl text-mint-950 hover:bg-mint-50 transition-all shadow-sm group"
                title="Go Forward"
               >
                  <ArrowRight className="h-5 w-5 group-active:translate-x-1 transition-transform" />
               </button>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em] mb-1">
                {reconnecting ? 'Offline Mode Active' : 'Connection Status'}
              </span>
              <div className="flex items-center gap-2">
                 <div className={cn("w-2 h-2 rounded-full animate-pulse", reconnecting ? "bg-amber-500" : "bg-emerald-500")} />
                 <span className="text-xs font-black text-slate-950 tracking-tight">
                    {reconnecting 
                      ? 'Reconnecting (Cached Profile)' 
                      : (profile?.role === 'super_admin' ? 'Global Access' : (profile?.store?.name || profile?.storeName || 'Store'))
                    }
                 </span>
              </div>
            </div>
            <button 
              onClick={() => navigate('/')}
              className="h-12 w-12 rounded-2xl bg-white border border-mint-100 shadow-sm flex items-center justify-center relative hover:bg-mint-50 transition-colors cursor-pointer group"
            >
               <LayoutDashboard className="h-5 w-5 text-mint-950 group-hover:scale-110 transition-transform" />
            </button>
          </div>
        </header>

        {/* Dynamic Content */}
        <main className="flex-1 overflow-y-auto p-10 lg:p-16 custom-scrollbar bg-white/30">
          <Outlet />
        </main>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-mint-950/40 backdrop-blur-md lg:hidden"
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default MainLayout;
