import React, { useState, useEffect } from "react";
import { API_BASE } from "../config";
import {
  X,
  Key,
  Keyboard,
  CheckCircle2,
  AlertCircle,
  Trash,
  ExternalLink,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import toast from "react-hot-toast";

export default function SettingsModal({ isOpen, onClose, initialTab = "keys" }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [providers, setProviders] = useState({
    openrouter: { configured: false },
    gemini: { configured: false },
  });
  const [quota, setQuota] = useState({ used: 0, limit: 30, remaining: 30 });
  const [isLoading, setIsLoading] = useState(true);

  // Form states
  const [openRouterKeyInput, setOpenRouterKeyInput] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // Testing states
  const [testingProvider, setTestingProvider] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [isSaving, setIsSaving] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
    }
  }, [isOpen]);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/keys`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || {});
        setQuota(data.quota || { used: 0, limit: 30, remaining: 30 });
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      toast.error("Failed to load settings.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestKey = async (provider, key) => {
    if (!key || !key.trim()) {
      toast.error("Please enter an API key to test.");
      return;
    }
    setTestingProvider(provider);
    setTestResults((prev) => ({ ...prev, [provider]: null }));

    try {
      const res = await fetch(`${API_BASE}/api/settings/keys/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider, apiKey: key.trim() }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          success: data.valid,
          message: data.message || (data.valid ? "Key verified successfully!" : "Key test failed"),
        },
      }));
      if (data.valid) {
        toast.success(`Valid ${provider === "openrouter" ? "OpenRouter" : "Gemini"} API key!`);
      } else {
        toast.error(data.message || "Invalid API key");
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: { success: false, message: "Connection test failed." },
      }));
      toast.error("Failed to reach provider.");
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSaveKey = async (provider, key) => {
    if (!key || !key.trim()) {
      toast.error("Please enter an API key.");
      return;
    }
    setIsSaving(provider);
    try {
      const res = await fetch(`${API_BASE}/api/settings/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider, apiKey: key.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Saved API key for ${provider === "openrouter" ? "OpenRouter" : "Gemini"}`);
        if (provider === "openrouter") setOpenRouterKeyInput("");
        if (provider === "gemini") setGeminiKeyInput("");
        fetchSettings();
      } else {
        toast.error(data.error || "Failed to save key");
      }
    } catch (err) {
      toast.error("Error saving API key.");
    } finally {
      setIsSaving(null);
    }
  };

  const handleDeleteKey = async (provider) => {
    if (!window.confirm(`Remove custom API key for ${provider}? You will revert to shared free quota.`)) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/settings/keys/${provider}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast.success(`Removed ${provider} custom key.`);
        fetchSettings();
      } else {
        toast.error("Failed to delete key.");
      }
    } catch (err) {
      toast.error("Error deleting API key.");
    }
  };

  if (!isOpen) return null;

  const quotaPercent = Math.min(100, Math.round((quota.used / (quota.limit || 30)) * 100));

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-[#12141a] rounded-xl w-full max-w-xl border border-[#232732] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#232732] flex items-center justify-between bg-[#151821]">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-[#38bdf8]" />
            <span className="text-sm font-semibold text-white">Settings & Keys</span>
          </div>
          <button
            onClick={onClose}
            className="text-[#64748b] hover:text-white p-1 rounded hover:bg-[#1f2430] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#232732] bg-[#12141a] px-5 pt-2">
          <button
            onClick={() => setActiveTab("keys")}
            className={`flex items-center gap-2 py-2 px-3 border-b-2 text-xs font-medium transition-colors ${
              activeTab === "keys"
                ? "border-[#38bdf8] text-[#38bdf8]"
                : "border-transparent text-[#94a3b8] hover:text-white"
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>AI Keys & Quotas</span>
          </button>
          <button
            onClick={() => setActiveTab("shortcuts")}
            className={`flex items-center gap-2 py-2 px-3 border-b-2 text-xs font-medium transition-colors ${
              activeTab === "shortcuts"
                ? "border-[#38bdf8] text-[#38bdf8]"
                : "border-transparent text-[#94a3b8] hover:text-white"
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Shortcuts</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs text-[#94a3b8]">
          {activeTab === "keys" && (
            <>
              {/* Daily Server Quota Meter */}
              <div className="p-3.5 rounded-lg bg-[#181b22] border border-[#262b38] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#38bdf8]" />
                    <span className="font-semibold text-white">Shared Server Free Tier</span>
                  </div>
                  <span className="font-mono text-[11px] text-[#94a3b8]">
                    {quota.used} / {quota.limit} calls today
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-[#101217] h-2 rounded-full overflow-hidden border border-[#232732]">
                  <div
                    className={`h-full transition-all duration-300 ${
                      quotaPercent >= 100
                        ? "bg-rose-500"
                        : quotaPercent > 70
                        ? "bg-amber-500"
                        : "bg-[#38bdf8]"
                    }`}
                    style={{ width: `${quotaPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#64748b]">
                  <span>
                    {quota.remaining > 0
                      ? `${quota.remaining} free AI calls remaining today`
                      : "Daily free quota reached"}
                  </span>
                  <span className="text-[#38bdf8]">Add your own key for unlimited usage</span>
                </div>
              </div>

              {/* Security Callout */}
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/40 text-[11px] text-emerald-300/90">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  Keys are encrypted at rest with <strong>AES-256-GCM</strong> using an isolated server master key. Raw keys are never stored in plaintext or logged.
                </span>
              </div>

              {/* Provider 1: OpenRouter */}
              <div className="p-4 rounded-lg bg-[#161922] border border-[#262b38] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-xs">OpenRouter</span>
                    <span className="text-[10px] text-[#64748b]">(Chat & Document Intelligence)</span>
                  </div>
                  {providers.openrouter?.configured ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Custom Key Active (Unlimited)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1f2430] text-[#94a3b8] border border-[#2e3442]">
                      Using Server Quota
                    </span>
                  )}
                </div>

                {providers.openrouter?.configured && (
                  <div className="flex items-center justify-between p-2 rounded bg-[#101217] border border-[#232732]">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-white">
                      <span>{providers.openrouter.maskedKey}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteKey("openrouter")}
                      className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-950/30 flex items-center gap-1 transition-colors"
                      title="Remove key"
                    >
                      <Trash className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[11px] text-[#64748b] block">
                    {providers.openrouter?.configured ? "Update Key:" : "Enter OpenRouter API Key:"}
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showOpenRouterKey ? "text" : "password"}
                        value={openRouterKeyInput}
                        onChange={(e) => setOpenRouterKeyInput(e.target.value)}
                        placeholder="sk-or-v1-..."
                        className="w-full bg-[#101217] border border-[#2a2f3e] focus:border-[#38bdf8] rounded px-3 py-1.5 text-xs text-white placeholder-[#475569] font-mono outline-none pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-white"
                      >
                        {showOpenRouterKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTestKey("openrouter", openRouterKeyInput)}
                      disabled={testingProvider === "openrouter" || !openRouterKeyInput.trim()}
                      className="px-3 py-1.5 rounded bg-[#1f2430] hover:bg-[#282e3d] text-white border border-[#2e3442] disabled:opacity-50 flex items-center gap-1 transition-colors"
                    >
                      {testingProvider === "openrouter" && <RefreshCw className="w-3 h-3 animate-spin" />}
                      <span>Test</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveKey("openrouter", openRouterKeyInput)}
                      disabled={isSaving === "openrouter" || !openRouterKeyInput.trim()}
                      className="px-3 py-1.5 rounded bg-[#38bdf8] hover:bg-[#7bd0ff] text-[#00354a] font-semibold disabled:opacity-50 flex items-center gap-1 transition-colors"
                    >
                      {isSaving === "openrouter" && <RefreshCw className="w-3 h-3 animate-spin" />}
                      <span>Save</span>
                    </button>
                  </div>
                  {testResults.openrouter && (
                    <div
                      className={`text-[11px] flex items-center gap-1.5 mt-1 ${
                        testResults.openrouter.success ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {testResults.openrouter.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5" />
                      )}
                      <span>{testResults.openrouter.message}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Provider 2: Google Gemini */}
              <div className="p-4 rounded-lg bg-[#161922] border border-[#262b38] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-xs">Google Gemini</span>
                    <span className="text-[10px] text-[#64748b]">(Multimodal & Fallback OCR)</span>
                  </div>
                  {providers.gemini?.configured ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Custom Key Active (Unlimited)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1f2430] text-[#94a3b8] border border-[#2e3442]">
                      Using Server Quota
                    </span>
                  )}
                </div>

                {providers.gemini?.configured && (
                  <div className="flex items-center justify-between p-2 rounded bg-[#101217] border border-[#232732]">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-white">
                      <span>{providers.gemini.maskedKey}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteKey("gemini")}
                      className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-950/30 flex items-center gap-1 transition-colors"
                      title="Remove key"
                    >
                      <Trash className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[11px] text-[#64748b] block">
                    {providers.gemini?.configured ? "Update Key:" : "Enter Google Gemini API Key:"}
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showGeminiKey ? "text" : "password"}
                        value={geminiKeyInput}
                        onChange={(e) => setGeminiKeyInput(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full bg-[#101217] border border-[#2a2f3e] focus:border-[#38bdf8] rounded px-3 py-1.5 text-xs text-white placeholder-[#475569] font-mono outline-none pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-white"
                      >
                        {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTestKey("gemini", geminiKeyInput)}
                      disabled={testingProvider === "gemini" || !geminiKeyInput.trim()}
                      className="px-3 py-1.5 rounded bg-[#1f2430] hover:bg-[#282e3d] text-white border border-[#2e3442] disabled:opacity-50 flex items-center gap-1 transition-colors"
                    >
                      {testingProvider === "gemini" && <RefreshCw className="w-3 h-3 animate-spin" />}
                      <span>Test</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveKey("gemini", geminiKeyInput)}
                      disabled={isSaving === "gemini" || !geminiKeyInput.trim()}
                      className="px-3 py-1.5 rounded bg-[#38bdf8] hover:bg-[#7bd0ff] text-[#00354a] font-semibold disabled:opacity-50 flex items-center gap-1 transition-colors"
                    >
                      {isSaving === "gemini" && <RefreshCw className="w-3 h-3 animate-spin" />}
                      <span>Save</span>
                    </button>
                  </div>
                  {testResults.gemini && (
                    <div
                      className={`text-[11px] flex items-center gap-1.5 mt-1 ${
                        testResults.gemini.success ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {testResults.gemini.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5" />
                      )}
                      <span>{testResults.gemini.message}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === "shortcuts" && (
            <div className="space-y-2">
              {[
                { key: "⌘K or /", desc: "Focus file search bar" },
                { key: "Space", desc: "Quick preview / open in Google Drive" },
                { key: "I", desc: "Toggle right Inspector pane" },
                { key: "Ctrl + Click", desc: "Multi-select documents or folders" },
                { key: "Double Click", desc: "Open folder / View file in Drive" },
                { key: "Esc", desc: "Deselect items / Close open modals" },
              ].map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between py-2 border-b border-[#232732]/60"
                >
                  <span className="text-[#94a3b8]">{s.desc}</span>
                  <kbd className="font-mono text-[11px] bg-[#181b22] px-2.5 py-1 rounded border border-[#2e3442] text-white">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
