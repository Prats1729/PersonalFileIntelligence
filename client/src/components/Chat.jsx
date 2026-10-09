import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Send,
  FileText,
  X,
  Plus,
  Share2,
  ChevronDown,
  ChevronUp,
  Database,
  Paperclip,
  Check,
  Copy,
  RotateCcw,
  Pin,
  FolderOpen,
  Zap,
  Download,
  ArrowRight,
  BookOpen,
  Code2
} from "lucide-react";
import toast from "react-hot-toast";
import { API_BASE } from "../config";

const COMMAND_CHIPS = [
  { prefix: "/summary", label: "Summary", icon: Sparkles, desc: "Summarize key concepts & exam takeaways" },
  { prefix: "/quiz", label: "Quiz", icon: BookOpen, desc: "Generate 5 practice exam questions with solutions" },
  { prefix: "/notes", label: "Notes", icon: FileText, desc: "Extract structured revision notes" },
  { prefix: "/formulas", label: "Formulas", icon: Code2, desc: "Extract key formulas, theorems & algorithms" },
  { prefix: "/flashcards", label: "Flashcards", icon: Zap, desc: "Generate 4 flashcard study pairs" },
];

export default function Chat({
  user,
  selectedFile,
  selectedFiles = [],
  allFiles = [],
  folders = [],
  activeFolder = null,
  activeChatId,
  onChatCreated,
  onChatUpdated,
  onNewChat,
  onClose,
  onUpdateFileNote,
}) {
  const [input, setInput] = useState("");
  const [chatId, setChatId] = useState(activeChatId || null);
  const [isLoading, setIsLoading] = useState(false);
  const [scope, setScope] = useState(
    (selectedFiles && selectedFiles.length > 0) || selectedFile ? "document" : "all"
  );
  const [isScopeOpen, setIsScopeOpen] = useState(false);
  const [groundingMode, setGroundingMode] = useState("strict"); // "strict" | "reasoning"
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState({});
  const [activeFlashcard, setActiveFlashcard] = useState(null);

  // Initial welcome message
  const [messages, setMessages] = useState([
    {
      id: "welcome-1",
      role: "assistant",
      content:
        "<thinking>Loaded library graph, semantic embeddings, and user context notes (0.4s)</thinking>\n\nHi! I'm your **Intelligence Assistant**.\n\nSelect a document or collection to begin. I ground my answers directly in your lecture slides, textbooks, and professor context notes.",
      cleanContent:
        "Hi! I'm your **Intelligence Assistant**.\n\nSelect a document or collection to begin. I ground my answers directly in your lecture slides, textbooks, and professor context notes.",
      created_at: new Date().toISOString(),
      thinkingText: "Loaded library graph, semantic embeddings, and user context notes (0.4s)",
      groundingScore: "99.4%",
    },
  ]);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const scopeDropdownRef = useRef(null);
  const addSourceRef = useRef(null);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target)) {
        setIsScopeOpen(false);
      }
      if (addSourceRef.current && !addSourceRef.current.contains(e.target)) {
        setIsAddSourceOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Sync attachedFiles when selectedFiles, selectedFile, or scope changes
  useEffect(() => {
    if (scope === "document") {
      if (selectedFiles && selectedFiles.length > 0) {
        setAttachedFiles(selectedFiles);
      } else if (selectedFile) {
        setAttachedFiles([selectedFile]);
      } else {
        setAttachedFiles([]);
      }
    } else if (scope === "collection") {
      if (activeFolder) {
        const folderDocs = allFiles.filter(
          (f) => (f.ai_result_folder || "").toLowerCase() === activeFolder.toLowerCase()
        );
        setAttachedFiles(folderDocs.slice(0, 5));
      } else {
        setAttachedFiles(allFiles.slice(0, 5));
      }
    } else if (scope === "all") {
      setAttachedFiles(allFiles.slice(0, 8));
    }
  }, [scope, selectedFile, selectedFiles, activeFolder, allFiles]);

  // Load chat history when activeChatId changes
  useEffect(() => {
    if (activeChatId) {
      if (chatId === activeChatId) return;
      setChatId(activeChatId);
      setIsLoading(true);
      fetch(`${API_BASE}/api/chat/${activeChatId}`, {
        credentials: "include",
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && data.length > 0) {
            const formatted = data.map((m) => {
              const parsed = parseMessageContent(m.content);
              return {
                ...m,
                role: m.role === "ai" ? "assistant" : m.role,
                thinkingText: parsed.thinking,
                cleanContent: parsed.body,
                groundingScore: m.role === "ai" ? "Coming Soon" : undefined,
              };
            });
            setMessages(formatted);
          }
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    } else {
      setChatId(null);
      setMessages([
        {
          id: "welcome-1",
          role: "assistant",
          content:
            "<thinking>Loaded library graph, semantic embeddings, and user context notes (0.4s)</thinking>\n\nHi! I'm your **Intelligence Assistant**.\n\nSelect a document or collection to begin. I ground my answers directly in your lecture slides, textbooks, and professor context notes.",
          cleanContent:
            "Hi! I'm your **Intelligence Assistant**.\n\nSelect a document or collection to begin. I ground my answers directly in your lecture slides, textbooks, and professor context notes.",
          created_at: new Date().toISOString(),
          thinkingText: "Loaded library context notes and student workspace files",
          groundingScore: "Coming Soon",
        },
      ]);
    }
  }, [activeChatId]);

  // Helper to parse <thinking>...</thinking> tags from message
  const parseMessageContent = (text = "") => {
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    let thinking = null;
    let body = text;
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
      body = text.replace(/<thinking>[\s\S]*?<\/thinking>/i, "").trim();
    }
    return { thinking, body };
  };


  // Handle Send
  const handleSend = async (messageText = input) => {
    const textToSend = typeof messageText === "string" ? messageText.trim() : input.trim();
    if (!textToSend || isLoading) return;

    setIsLoading(true);
    setInput("");

    // Add user message to UI immediately
    const userMsgObj = {
      id: `usr-${Date.now()}`,
      role: "user",
      content: textToSend,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsgObj]);

    try {
      let currentChatId = chatId;
      let isNewChat = false;

      // 1. Create chat if none exists
      if (!currentChatId) {
        const createRes = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          credentials: "include",
        });
        const chatData = await createRes.json();
        currentChatId = chatData.id;
        setChatId(chatData.id);
        isNewChat = true;
        if (onChatCreated) onChatCreated(chatData.id);
      }

      // 2. Post to /api/chat/:id
      const mentionedFileIds = attachedFiles.map((f) => f.id);
      const res = await fetch(`${API_BASE}/api/chat/${currentChatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: textToSend,
          mentionedFileIds,
          scope,
          groundingMode,
        }),
      });

      if (!res.ok) throw new Error("Failed to get response from AI");

      const data = await res.json();
      const parsed = parseMessageContent(data.content);

      const aiMsgObj = {
        id: data.id || `ai-${Date.now()}`,
        role: "assistant",
        content: data.content,
        cleanContent: parsed.body,
        thinkingText: parsed.thinking || "Reasoned through active document context notes",
        created_at: data.created_at || new Date().toISOString(),
        groundingScore: "Coming Soon",
        attachedContextNotes: data.attachedContextNotes || [],
      };

      setMessages((prev) => [...prev, aiMsgObj]);

      if (isNewChat && onChatUpdated) {
        onChatUpdated();
      }
    } catch (err) {
      console.error("Chat error:", err);
      toast.error("AI service error. Check connection or OpenRouter key.");
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "Encountered an issue communicating with the AI model. Please verify your connection or try again.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Slash Command Chip Click
  const handleCommandClick = (cmdPrefix) => {
    setInput(`${cmdPrefix} `);
    textareaRef.current?.focus();
  };

  // Quick Command or Suggestion pill click
  const handleQuickCommand = (promptText) => {
    setInput(promptText);
    textareaRef.current?.focus();
  };

  // Export Chat to Markdown file
  const handleExportChat = () => {
    if (messages.length <= 1) {
      toast("No conversation history to export yet.");
      return;
    }
    const mdLines = [
      `# Personal Library — Intelligence Chat Export`,
      `**Date:** ${new Date().toLocaleString()}`,
      `**Active Scope:** ${scope.toUpperCase()}`,
      `**Grounding Mode:** ${groundingMode}`,
      `**Sources:** ${attachedFiles.map((f) => f.original_name).join(", ") || "None"}`,
      `\n---\n`,
    ];

    messages.forEach((m) => {
      const parsed = parseMessageContent(m.content);
      if (m.role === "user") {
        mdLines.push(`### 👤 You\n${m.content}\n`);
      } else {
        mdLines.push(`### 🤖 Intelligence Assistant (${m.groundingScore || "Grounded"})\n`);
        if (parsed.thinking) {
          mdLines.push(`> ⚡ *Thinking:* ${parsed.thinking}\n`);
        }
        mdLines.push(`${parsed.body}\n`);
      }
    });

    const blob = new Blob([mdLines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chat-export-${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Chat exported as Markdown!");
  };

  // Save AI answer to Document Context Notes
  const handleSaveToContextNote = async (text) => {
    const targetFile = attachedFiles[0] || selectedFile;
    if (!targetFile) {
      toast.error("No active document selected to attach note.");
      return;
    }

    const snippet = text.slice(0, 300);
    const updatedNote = targetFile.context_note
      ? `${targetFile.context_note}\n\n[AI Summary]: ${snippet}`
      : `[AI Summary]: ${snippet}`;

    if (onUpdateFileNote) {
      await onUpdateFileNote(targetFile.id, updatedNote);
    }
  };

  // Render Rich Assistant Content with Callouts & Code/Formula blocks
  const renderRichAssistantContent = (msg, msgIdx) => {
    const rawText = msg.cleanContent || msg.content || "";

    // Extract pinned note callout if present
    const noteMatch = rawText.match(/> 📌 \*\*Pinned Context Match:\*\* "([\s\S]*?)"/i);
    const displayedText = rawText.replace(/> 📌 \*\*Pinned Context Match:\*\* "[\s\S]*?"/i, "").trim();

    return (
      <div className="space-y-3">
        {/* Pinned Note Banner */}
        {noteMatch && (
          <div className="p-2.5 rounded bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#ffc174] text-[11px] flex items-start gap-2 leading-relaxed">
            <Pin className="w-3.5 h-3.5 text-[#f59e0b] mt-0.5 flex-shrink-0" />
            <div>
              <strong className="font-semibold text-[#f59e0b] block mb-0.5">
                Pinned Context Match:
              </strong>
              <span>"{noteMatch[1]}"</span>
            </div>
          </div>
        )}

        {/* Text Body with Clean Formatting */}
        <div className="text-[13px] text-[#bdc8d1] leading-relaxed space-y-2 whitespace-pre-line font-normal">
          {displayedText}
        </div>

        {/* Action Toolbar for AI message */}
        <div className="flex items-center justify-between pt-2.5 border-t border-[#232732] text-[#64748b] text-[11px]">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleSaveToContextNote(displayedText)}
              className="px-2 py-1 rounded bg-[#181b22] hover:bg-[#232732] hover:text-white text-[#94a3b8] border border-[#232732] flex items-center gap-1 transition-colors"
              title="Pin key insight to document's Context Notes"
            >
              <Pin className="w-3 h-3 text-[#38bdf8]" />
              <span>Pin to Notes</span>
            </button>
            <button
              onClick={() => {
                const firstParagraph = displayedText.split("\n")[0] || "Key concept";
                setActiveFlashcard({
                  front: `Key Concept: ${attachedFiles[0]?.original_name || "Document Topic"}`,
                  back: firstParagraph,
                });
              }}
              className="px-2 py-1 rounded bg-[#181b22] hover:bg-[#232732] hover:text-white text-[#94a3b8] border border-[#232732] flex items-center gap-1 transition-colors"
              title="Generate a study flashcard"
            >
              <BookOpen className="w-3 h-3 text-[#14b8a6]" />
              <span>Flashcard</span>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                navigator.clipboard.writeText(displayedText);
                toast.success("Markdown copied to clipboard!");
              }}
              className="p-1 hover:text-white hover:bg-[#181b22] rounded transition-colors"
              title="Copy Markdown"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRegenerate}
              className="p-1 hover:text-white hover:bg-[#181b22] rounded transition-colors"
              title="Regenerate Response"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Regenerate last AI response without duplicating the user message
  const handleRegenerate = async () => {
    if (isLoading || !chatId) return;
    const previousUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!previousUserMsg) return;

    // Remove the last assistant message from UI
    setMessages((prev) => {
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].role === "assistant") {
        return prev.slice(0, lastIdx);
      }
      return prev;
    });

    setIsLoading(true);
    try {
      const mentionedFileIds = attachedFiles.map((f) => f.id);
      const res = await fetch(`${API_BASE}/api/chat/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: previousUserMsg.content,
          mentionedFileIds,
          scope,
          groundingMode,
          isRegenerate: true,
        }),
      });

      if (!res.ok) throw new Error("Failed to regenerate response");

      const data = await res.json();
      const parsed = parseMessageContent(data.content);

      const aiMsgObj = {
        id: data.id || `ai-${Date.now()}`,
        role: "assistant",
        content: data.content,
        cleanContent: parsed.body,
        thinkingText: parsed.thinking || "Reasoned through active document context notes",
        created_at: data.created_at || new Date().toISOString(),
        groundingScore: "Coming Soon",
        attachedContextNotes: data.attachedContextNotes || [],
      };

      setMessages((prev) => [...prev, aiMsgObj]);
    } catch (err) {
      console.error("Regenerate error:", err);
      toast.error("Failed to regenerate AI response");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#12141a] text-[#e3e2e6] select-none">
      {/* ======================================================== */}
      {/* 1. HEADER & STATUS BAR                                   */}
      {/* ======================================================== */}
      <div className="p-3 border-b border-[#232732] bg-[#12141a] flex flex-col gap-2.5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#38bdf8]/15 border border-[#38bdf8]/30 flex items-center justify-center text-[#38bdf8]">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-semibold text-white leading-none">
                  Intelligence Assistant
                </h2>
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#14b8a6] inline-block animate-pulse"
                  title="Assistant Active"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (onNewChat) onNewChat();
                setChatId(null);
                setMessages([
                  {
                    id: `new-${Date.now()}`,
                    role: "assistant",
                    content:
                      "<thinking>Initialized new session. Library graph active.</thinking>\n\nStarted a **New Chat**. Ask anything or attach documents to explore.",
                    cleanContent:
                      "Started a **New Chat**. Ask anything or attach documents to explore.",
                    created_at: new Date().toISOString(),
                    thinkingText: "Initialized new session. Library graph active.",
                    groundingScore: "99.5%",
                  },
                ]);
                toast.success("New chat session started");
              }}
              className="p-1 text-[#94a3b8] hover:text-white hover:bg-[#181b22] rounded transition-colors"
              title="New Conversation"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={handleExportChat}
              className="p-1 text-[#94a3b8] hover:text-white hover:bg-[#181b22] rounded transition-colors"
              title="Export / Share Chat"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1 text-[#64748b] hover:text-white hover:bg-[#181b22] rounded transition-colors"
              title="Close Panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Scope Selector Row */}
        <div className="pt-1 border-t border-[#232732]/60 relative">
          {/* Scope Dropdown */}
          <div className="relative w-full" ref={scopeDropdownRef}>
            <button
              onClick={() => setIsScopeOpen(!isScopeOpen)}
              className="w-full flex items-center justify-between gap-1 bg-[#0d0e11] border border-[#232732] hover:border-[#3e484f] rounded px-2.5 py-1.5 text-xs text-left transition-colors"
            >
              <div className="flex items-center gap-1.5 truncate">
                <FolderOpen className="w-3.5 h-3.5 text-[#38bdf8] flex-shrink-0" />
                <span className="truncate font-medium text-[11px] text-[#e3e2e6]">
                  {scope === "document"
                    ? attachedFiles.length > 1
                      ? `${attachedFiles.length} Documents Selected`
                      : attachedFiles[0]
                      ? `Document: ${attachedFiles[0].original_name}`
                      : selectedFile
                      ? `Document: ${selectedFile.original_name}`
                      : "No Document Selected"
                    : scope === "collection"
                    ? `Collection: ${activeFolder || "All Folders"}`
                    : `All Documents (${allFiles.length})`}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#64748b] flex-shrink-0" />
            </button>

            {isScopeOpen && (
              <div className="absolute left-0 top-full mt-1 w-full bg-[#181b22] border border-[#2e3442] rounded-lg shadow-2xl py-1 z-50 text-xs">
                <button
                  onClick={() => {
                    setScope("document");
                    setIsScopeOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between hover:bg-[#232732] ${
                    scope === "document" ? "text-[#38bdf8] font-semibold" : "text-[#bdc8d1]"
                  }`}
                >
                  <span className="truncate">
                    {attachedFiles.length > 1
                      ? `Selected Documents (${attachedFiles.length})`
                      : attachedFiles[0]
                      ? `Current Document (${attachedFiles[0].original_name})`
                      : selectedFile
                      ? `Current Document (${selectedFile.original_name})`
                      : "Current Document (None)"}
                  </span>
                  {scope === "document" && <Check className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => {
                    setScope("collection");
                    setIsScopeOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between hover:bg-[#232732] ${
                    scope === "collection" ? "text-[#38bdf8] font-semibold" : "text-[#bdc8d1]"
                  }`}
                >
                  <span className="truncate">
                    Collection ({activeFolder ? activeFolder : "All Folders"})
                  </span>
                  {scope === "collection" && <Check className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => {
                    setScope("all");
                    setIsScopeOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between hover:bg-[#232732] ${
                    scope === "all" ? "text-[#38bdf8] font-semibold" : "text-[#bdc8d1]"
                  }`}
                >
                  <span>All Documents ({allFiles.length})</span>
                  {scope === "all" && <Check className="w-3 h-3" />}
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ======================================================== */}
      {/* 3. MESSAGE STREAM                                        */}
      {/* ======================================================== */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4 bg-[#0d0e11]">
        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";
          return (
            <div key={msg.id || idx} className="flex flex-col gap-1">
              {/* Message Header */}
              <div
                className={`flex items-center gap-1.5 text-[10px] font-mono text-[#64748b] ${
                  isUser ? "justify-end pr-1" : "justify-between pl-1"
                }`}
              >
                {!isUser ? (
                  <div className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-[#38bdf8]" />
                    <span className="text-[#38bdf8] font-semibold">
                      Intelligence Assistant
                    </span>
                  </div>
                ) : (
                  <span>You</span>
                )}
              </div>

              {/* Collapsible Thinking Accordion for Assistant */}
              {!isUser && msg.thinkingText && (
                <div className="border border-[#232732] rounded bg-[#12141a] overflow-hidden">
                  <button
                    onClick={() =>
                      setExpandedThinking((prev) => ({
                        ...prev,
                        [idx]: !prev[idx],
                      }))
                    }
                    className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-mono text-[#94a3b8] hover:bg-[#181b22] transition-colors"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <Zap className="w-3 h-3 text-[#f59e0b] flex-shrink-0 animate-pulse" />
                      <span className="truncate">{msg.thinkingText}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[#64748b]">
                      {expandedThinking[idx] ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                  </button>

                  {expandedThinking[idx] && (
                    <div className="p-2 border-t border-[#232732] bg-[#0d0e11] text-[10px] font-mono text-[#64748b] space-y-1">
                      <div>• Scanned attached documents & context notes</div>
                      <div>• Applied grounding constraints ({groundingMode} mode)</div>
                    </div>
                  )}
                </div>
              )}

              {/* Message Body Box */}
              <div
                className={`p-3 rounded-lg shadow-sm ${
                  isUser
                    ? "bg-[#181b22] border border-[#232732] text-white self-end max-w-[90%]"
                    : "bg-[#12141a] border border-[#232732] text-[#e3e2e6]"
                }`}
              >
                {isUser ? (
                  <p className="text-xs leading-relaxed">{msg.content}</p>
                ) : (
                  renderRichAssistantContent(msg, idx)
                )}
              </div>
            </div>
          );
        })}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1 text-[10px] font-mono text-[#38bdf8] pl-1">
              <Sparkles className="w-3 h-3 animate-spin" />
              <span>Reasoning through document vectors...</span>
            </div>
            <div className="p-3 bg-[#12141a] border border-[#232732] rounded-lg text-xs text-[#94a3b8] flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-[#38bdf8] rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-[#38bdf8] rounded-full animate-bounce delay-100" />
              <div className="w-1.5 h-1.5 bg-[#38bdf8] rounded-full animate-bounce delay-200" />
              <span className="font-mono text-[11px] text-[#64748b] ml-1">
                Searching text tokens &amp; notes...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ======================================================== */}
      {/* 4. PROFESSIONAL INPUT AREA                               */}
      {/* ======================================================== */}
      <div className="p-3 border-t border-[#232732] bg-[#12141a] flex flex-col gap-2 flex-shrink-0">
        {/* Command Chips Row */}
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
          <span className="text-[10px] font-mono text-[#64748b] flex-shrink-0 uppercase tracking-wider">
            Commands:
          </span>
          {COMMAND_CHIPS.map((cmd) => (
            <button
              key={cmd.prefix}
              onClick={() => handleCommandClick(cmd.prefix)}
              className="px-2 py-0.5 rounded-full bg-[#181b22] hover:bg-[#232732] border border-[#232732] hover:border-[#38bdf8]/40 text-[#94a3b8] hover:text-[#38bdf8] flex items-center gap-1 transition-colors flex-shrink-0 font-mono text-[11px]"
              title={cmd.desc}
            >
              <cmd.icon className="w-3 h-3 text-[#38bdf8]" />
              <span>{cmd.prefix}</span>
            </button>
          ))}
        </div>

        {/* Input Box Container */}
        <div className="relative flex flex-col rounded bg-[#0d0e11] border border-[#232732] focus-within:border-[#38bdf8] transition-colors shadow-inner">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isLoading}
            placeholder="Ask a question or type /summary, /quiz..."
            className="w-full p-2.5 bg-transparent text-xs text-white placeholder-[#64748b] focus:outline-none resize-none leading-relaxed"
          />

          {/* Bottom Toolbelt inside input box */}
          <div className="flex items-center justify-between px-2 pb-2 pt-1 border-t border-[#232732]/40 text-xs text-[#64748b]">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsAddSourceOpen(true)}
                className="p-1 hover:text-white rounded transition-colors"
                title="Attach Source Document"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-[#64748b] hidden sm:inline">
                ⌘Enter to run
              </span>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="h-6 px-2.5 bg-[#f3f4f6] text-[#0d0e11] hover:bg-white disabled:opacity-30 disabled:hover:bg-[#f3f4f6] font-semibold text-xs rounded flex items-center gap-1 transition-colors"
              >
                <span>Ask</span>
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 5. FLASHCARD MODAL                                       */}
      {/* ======================================================== */}
      {activeFlashcard && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-[#12141a] rounded-xl w-[460px] border border-[#232732] shadow-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-[#232732] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#14b8a6]" />
                <span className="text-xs font-semibold text-white">
                  Study Flashcard Generator
                </span>
              </div>
              <button
                onClick={() => setActiveFlashcard(null)}
                className="text-[#64748b] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div className="p-3 bg-[#181b22] border border-[#232732] rounded-lg">
                <span className="text-[10px] font-mono text-[#38bdf8] uppercase tracking-wider block mb-1">
                  Card Front (Concept):
                </span>
                <p className="font-semibold text-white">{activeFlashcard.front}</p>
              </div>

              <div className="p-3 bg-[#0d0e11] border border-[#232732] rounded-lg">
                <span className="text-[10px] font-mono text-[#14b8a6] uppercase tracking-wider block mb-1">
                  Card Back (Explanation / Formula):
                </span>
                <p className="text-[#bdc8d1] leading-relaxed">{activeFlashcard.back}</p>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-[#232732] bg-[#0d0e11] flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `FRONT: ${activeFlashcard.front}\nBACK: ${activeFlashcard.back}`
                  );
                  toast.success("Flashcard copied to clipboard!");
                }}
                className="px-3 py-1.5 bg-[#181b22] hover:bg-[#232732] border border-[#232732] text-white text-xs rounded transition-colors"
              >
                Copy to Anki / Notes
              </button>
              <button
                onClick={() => setActiveFlashcard(null)}
                className="px-3 py-1.5 bg-[#38bdf8] text-[#0d0e11] font-semibold text-xs rounded hover:bg-[#7bd0ff] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
