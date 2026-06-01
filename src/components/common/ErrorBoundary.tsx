import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-screen flex items-center justify-center bg-white p-12">
            <div className="max-w-xl w-full bg-rose-50 border-4 border-rose-100 p-12 rounded-[3.5rem] text-center shadow-2xl">
              <h2 className="text-4xl font-black text-rose-950 uppercase tracking-tighter mb-4 italic">System Crash Error</h2>
              <p className="text-rose-600 font-bold mb-8 italic">The interface encountered a fatal exception. Our diagnostics sub-system has logged the event.</p>
              <div className="bg-white/50 p-6 rounded-2xl mb-8 text-left overflow-auto max-h-40">
                <pre className="text-[10px] font-mono text-rose-900 leading-tight">
                  {this.state.error?.message}
                  {"\n\n"}
                  {this.state.error?.stack}
                </pre>
              </div>
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-5 bg-rose-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl hover:bg-rose-700 transition-all"
              >
                Attempt Core Restart
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
