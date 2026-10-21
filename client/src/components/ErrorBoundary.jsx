import React from "react";
import { AlertTriangle, RefreshCw, LogOut } from "lucide-react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("UI Uncaught Crash caught by ErrorBoundary:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d0e11] text-[#e3e2e6] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#12141a] border border-[#2b3040] rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h1 className="text-lg font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-xs text-[#94a3b8] mb-6 leading-relaxed">
              An unexpected interface error occurred. You can safely reload the page or reset your view state.
            </p>

            {this.state.error && (
              <div className="w-full bg-[#0d0e11] border border-[#232732] rounded-lg p-3 text-[11px] font-mono text-left text-red-400/90 mb-6 overflow-x-auto max-h-32">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex items-center gap-3 w-full">
              <button
                onClick={this.handleReload}
                className="flex-1 py-2 px-3 bg-[#38bdf8] hover:bg-[#7bd0ff] text-[#00354a] font-semibold text-xs rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload Application
              </button>
              <button
                onClick={this.handleReset}
                className="py-2 px-3 bg-[#181b22] hover:bg-[#232732] text-[#94a3b8] hover:text-white text-xs rounded-lg flex items-center justify-center gap-1.5 border border-[#2e3442] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
