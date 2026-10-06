import React, { useState, useEffect } from "react";
import { MessageSquare, Folder, LogOut } from "lucide-react";
import AuthScreen from "./components/AuthScreen";
import Workspace from "./components/Workspace";
import { API_BASE } from "./config";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check if a session exists on initial load and keep DB awake
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include", // Sends our HTTP-only session cookie
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Not authenticated");
      })
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    // Keep Neon DB awake by pinging the health endpoint every 4 minutes
    const keepAliveInterval = setInterval(() => {
      fetch(`${API_BASE}/api/health`).catch(console.error);
    }, 4 * 60 * 1000); // 4 minutes

    return () => clearInterval(keepAliveInterval);
  }, []);

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
    } catch (err) {
      console.error("Failed to logout:", err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-[#0d0e11] text-[#94a3b8] flex flex-col items-center justify-center font-mono text-xs">
        <div className="w-6 h-6 border-2 border-[#232732] border-t-[#38bdf8] rounded-full animate-spin mb-3"></div>
        <span>Verifying Personal Library Session...</span>
      </div>
    );
  }

  return user ? (
    <Workspace user={user} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
  ) : (
    <AuthScreen />
  );
}
