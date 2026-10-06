import React from "react";
import { Shield, HardDrive, Database, Sparkles, Terminal, ArrowRight, CheckCircle2 } from "lucide-react";
import { API_BASE } from "../config";

export default function AuthScreen() {
  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE}/api/auth/google`;
  };

  return (
    <div className="min-h-screen bg-[#0d0e11] text-[#e3e2e6] flex flex-col justify-between selection:bg-[#38bdf8] selection:text-[#0d0e11]">
      {/* Top Bar */}
      <header className="h-14 border-b border-[#232732] bg-[#12141a]/80 backdrop-blur-md px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#181b22] border border-[#2e3442] flex items-center justify-center text-[#38bdf8]">
            <HardDrive className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-white font-mono">
            PersonalFile<span className="text-[#38bdf8]">Intelligence</span>
          </span>
          <span className="text-[10px] font-mono uppercase bg-[#181b22] text-[#94a3b8] px-2 py-0.5 rounded border border-[#232732]">
            v1.0.0
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-[#94a3b8]">
          <span className="w-2 h-2 rounded-full bg-[#14b8a6] animate-pulse"></span>
          <span>Google Drive Gateway: Operational</span>
        </div>
      </header>

      {/* Main Hero & Auth Card */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          {/* Philosophy Banner */}
          <div className="mb-6 p-4 rounded-lg bg-[#12141a] border border-[#232732] flex items-center gap-3">
            <div className="w-2 h-8 rounded-full bg-[#38bdf8]"></div>
            <div>
              <p className="text-xs text-[#94a3b8] uppercase font-mono tracking-wider">Core Principle</p>
              <p className="text-sm font-medium text-white italic">
                "Storage is a dependency. Intelligence and retrieval are the product."
              </p>
            </div>
          </div>

          {/* Central Auth Box */}
          <div className="bg-[#12141a] border border-[#2e3442] rounded-xl p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#38bdf8] to-transparent"></div>

            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
                Personal Digital Library
              </h1>
              <p className="text-sm text-[#94a3b8]">
                Stop losing PDFs and screenshots in self-chats. Connect your Google Drive to preserve context and retrieve files with speed.
              </p>
            </div>

            {/* Google Login Button */}
            <button
              onClick={handleGoogleLogin}
              className="w-full h-12 rounded-lg bg-white hover:bg-[#e5e7eb] text-[#0d0e11] font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-3 shadow-lg hover:shadow-white/10 active:scale-[0.99] group"
            >
              {/* Google G Logo */}
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.15z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.99 0 12s.45 3.85 1.24 5.42l4.04-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Continue with Google Drive</span>
              <ArrowRight className="w-4 h-4 text-[#64748b] group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* Scope Security Badge */}
            <div className="mt-6 pt-6 border-t border-[#232732] flex items-start gap-2 text-xs text-[#94a3b8]">
              <Shield className="w-4 h-4 text-[#14b8a6] flex-shrink-0 mt-0.5" />
              <p>
                <strong className="text-white">Strict Sandbox (<code className="text-[#38bdf8] font-mono">drive.file</code>):</strong> We can only access files created or opened by this app. Your personal tax docs and photos remain completely private.
              </p>
            </div>
          </div>

          {/* Three Architecture Highlights */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="p-3 rounded-lg bg-[#12141a] border border-[#232732]">
              <div className="text-[#38bdf8] mb-1.5">
                <HardDrive className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-white">Google Drive</h3>
              <p className="text-[11px] text-[#94a3b8] mt-0.5">Zero storage lock-in. Files stay in your Drive.</p>
            </div>

            <div className="p-3 rounded-lg bg-[#12141a] border border-[#232732]">
              <div className="text-[#14b8a6] mb-1.5">
                <Database className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-white">Context First</h3>
              <p className="text-[11px] text-[#94a3b8] mt-0.5">Attach human notes ("Unit 3 syllabus") to any file.</p>
            </div>

            <div className="p-3 rounded-lg bg-[#12141a] border border-[#232732]">
              <div className="text-[#f59e0b] mb-1.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-white">PostgreSQL</h3>
              <p className="text-[11px] text-[#94a3b8] mt-0.5">Structured metadata indexed for instant search.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Diagnostics */}
      <footer className="h-10 border-t border-[#232732] bg-[#12141a] px-6 flex items-center justify-between text-[11px] font-mono text-[#64748b]">
        <div className="flex items-center gap-4">
          <span>PostgreSQL: Connected</span>
          <span>•</span>
          <span>OAuth Scope: drive.file</span>
          <span>•</span>
          <span>Design: Kinetic Monolith</span>
        </div>
        <div>
          <span>Press ⌘K to Focus Search</span>
        </div>
      </footer>
    </div>
  );
}
