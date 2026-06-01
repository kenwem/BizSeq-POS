import React, { useState, useEffect } from 'react';
import { ResponsiveContainer } from 'recharts';

interface SafeResponsiveContainerProps {
  children: React.ReactElement;
  height?: number | string;
}

export const SafeResponsiveContainer: React.FC<SafeResponsiveContainerProps> = ({ 
  children, 
  height = '100%' 
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // A 150ms timeout guarantees that the browser has fully calculated the container's layout blocks
    // and eliminates any negative width (-1) or height calculations from Recharts when animating with Framer Motion.
    const timer = setTimeout(() => {
      setMounted(true);
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) {
    return (
      <div 
        style={{ width: '100%', height: typeof height === 'number' ? `${height}px` : height }} 
        className="w-full h-full bg-slate-50/50 rounded-2xl animate-pulse flex items-center justify-center border border-slate-100"
      >
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Loading charts...</span>
      </div>
    );
  }

  // Setting width to 99% ensures Recharts responsive container correctly recalculates 
  // without content overflow on layout shifts, keeping standard React and Flex parent components responsive.
  return (
    <div style={{ width: '100%', height: typeof height === 'number' ? `${height}px` : height }}>
      <ResponsiveContainer width="99%" height="100%" minWidth={0} minHeight={0}>
        {children}
      </ResponsiveContainer>
    </div>
  );
};
