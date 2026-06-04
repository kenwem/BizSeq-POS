import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../services/firebase';
import { ShieldCheck, Lock, User, AlertCircle, ArrowRight, Zap, Fingerprint, Mail, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  React.useEffect(() => {
    if (user && !authLoading) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  React.useEffect(() => {
    const authError = localStorage.getItem('authError');
    if (authError) {
      setError(authError);
      localStorage.removeItem('authError');
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Pre-check for email format since Firebase Auth requires it
    let loginIdentifier = identifier.trim();
    if (!loginIdentifier.includes('@')) {
      // Auto-append internal domain for username login
      loginIdentifier = `${loginIdentifier.toLowerCase()}@bizseq.internal`;
    }

    console.log("LOGIN START", loginIdentifier);

    try {
      // 1. Perform Login
      const res = await signInWithEmailAndPassword(auth, loginIdentifier, password);
      console.log("LOGIN SUCCESS", { uid: res.user.uid, email: res.user.email });
      navigate('/');
    } catch (err: any) {
      console.error('Login error:', err);
      let errorMsg = err.message;
      
      if (err.code === 'auth/network-request-failed') {
        errorMsg = 'NETWORK ERROR: The Firebase connection was blocked. This is usually caused by an Ad-blocker or strict browser privacy settings. Please disable extensions like uBlock Origin or try a different browser.';
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        errorMsg = 'Identification failed. Check your credentials.';
      } else if (err.code === 'auth/invalid-email') {
        errorMsg = 'The email address is badly formatted.';
      }
      
      setError(errorMsg);
      // Removed noisy alert
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!identifier || !identifier.includes('@')) {
      setError('Please enter your registered email address first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, identifier);
      setResetSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white font-sans text-slate-950 overflow-hidden">
      {/* Branding Side - Split Layout */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative items-center justify-center p-20 overflow-hidden">
         {/* Abstract Immersive Background */}
         <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-br from-emerald-950 to-black z-0" />
         <div className="absolute top-1/4 -right-24 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px] animate-pulse opacity-20" />
         
         {/* Content */}
         <div className="relative z-10 text-center max-w-lg">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.8, type: 'spring' }}
              className="inline-flex p-6 bg-emerald-600 rounded-[2.5rem] shadow-2xl shadow-emerald-500/30 mb-12"
            >
               <ShieldCheck className="h-16 w-16 text-white" />
            </motion.div>
            <motion.h1 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-6xl font-black text-white tracking-tighter mb-6 leading-none"
            >
              BizSeq <span className="text-emerald-500">(Business Secure)</span>
            </motion.h1>
            <motion.p 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-emerald-400 font-bold text-2xl tracking-tight leading-relaxed italic"
            >
              Sales and Inventory Management App
            </motion.p>
            
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-24 pt-12 border-t border-white/10"
            >
               <p className="text-[12px] text-white/50 font-black uppercase tracking-[0.4em]">
                 Powered by <span className="text-emerald-400 font-black">RF TECH SOLUTIONS</span>
               </p>
            </motion.div>
         </div>
      </div>

      {/* Login Side */}
      <div className="flex-1 flex items-center justify-center p-8 md:p-16 lg:p-24 bg-slate-50/30">
        <motion.div 
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md"
        >
          <div className="lg:hidden flex flex-col items-center mb-16">
             <div className="p-4 bg-slate-950 rounded-2xl shadow-xl mb-4">
                <ShieldCheck className="h-8 w-8 text-white" />
             </div>
             <h1 className="text-4xl font-black tracking-tighter text-slate-950">BizSeq</h1>
          </div>

          <div className="mb-12">
            <h2 className="text-5xl font-black text-slate-900 tracking-tighter mb-3">Login Terminal</h2>
            <p className="text-slate-600 font-bold text-lg italic">Access your business database.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-8">
            <div className="group">
              <label className="block text-[11px] font-black text-slate-800 uppercase tracking-[0.3em] mb-3 ml-2 group-focus-within:text-emerald-600 transition-colors">Username / Email</label>
              <div className="relative">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                   <User className="h-5 w-5" />
                </div>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full bg-white border-2 border-slate-200 rounded-[2rem] py-5 pl-16 pr-8 text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white transition-all placeholder:text-slate-600 font-bold shadow-sm"
                  placeholder="kenny or kenny@example.com"
                />
              </div>
            </div>

            <div className="group">
              <div className="flex justify-between items-center mb-3 pr-2">
                <label className="block text-[11px] font-black text-slate-800 uppercase tracking-[0.3em] ml-2 group-focus-within:text-emerald-600 transition-colors">Password</label>
                <button 
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-700 transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                   <Fingerprint className="h-5 w-5" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white border-2 border-slate-200 rounded-[2rem] py-5 pl-16 pr-14 text-slate-900 focus:outline-none focus:border-slate-900 focus:bg-white transition-all placeholder:text-slate-600 font-bold shadow-sm"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 transition-colors p-2"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center space-x-3 text-red-600 text-[11px] bg-red-50 p-5 rounded-2xl border border-red-100"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="font-black uppercase tracking-wider leading-relaxed">{error}</span>
                </motion.div>
              )}
              {resetSent && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center space-x-3 text-emerald-700 text-[11px] bg-emerald-50 p-5 rounded-2xl border border-emerald-100"
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="font-black uppercase tracking-wider leading-relaxed">Password reset link sent to your email.</span>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white font-black py-6 rounded-[2rem] hover:bg-black shadow-2xl shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.25em] text-xs flex items-center justify-center group"
            >
              {loading ? (
                <div className="flex items-center gap-3">
                   <Zap className="h-4 w-4 animate-spin text-emerald-400" />
                   <span>Authenticating...</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                   <span>Sign In</span>
                   <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform text-emerald-400" />
                </div>
              )}
            </button>
          </form>

          <footer className="mt-20 flex flex-col gap-6 items-center px-4">
             <div className="flex justify-between items-center w-full">
                <div className="flex gap-4">
                   <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                   <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                   <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                </div>
                <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Version 1.0</p>
             </div>
          </footer>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
