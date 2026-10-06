import React, { useState, useEffect } from "react";
import { Send, FileText, X } from "lucide-react";

export default function Chat({ user, selectedFiles, onRemoveContext, onClearAllContext, activeChatId, onChatCreated, onChatUpdated }) {
  const [input, setInput] = useState("");
  const [chatId, setChatId] = useState(activeChatId || null); // Track the current DB chat session
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your Personal Intelligence. Select a file or just start asking me questions!" }
  ]);

  // Load history when a user clicks a past chat
  useEffect(() => {
    if (activeChatId) {
      // Prevent race condition: if we just created this chat, we already have the state!
      if (chatId === activeChatId) return;
      
      setChatId(activeChatId);
      setIsLoading(true);
      fetch(`http://localhost:5000/api/chat/${activeChatId}`, {
        credentials: "include"
      })
      .then(res => res.json())
      .then(data => {
        if(data && data.length > 0) {
           // Replace 'ai' with 'assistant' just for our UI
           const formatted = data.map(m => ({ ...m, role: m.role === 'ai' ? 'assistant' : m.role }));
           setMessages(formatted);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
    } else {
      setChatId(null);
      setMessages([
        { role: "assistant", content: "Hi! I'm your Personal Intelligence. Select a file or just start asking me questions!" }
      ]);
    }
  }, [activeChatId]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setIsLoading(true);
    
    // 1. Add user's message to UI immediately
    const newMessages = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);
    setInput("");

    try {
      // 2. If we don't have a chat session yet, create one!
      let currentChatId = chatId;
      let isNewChat = false;
      if (!currentChatId) {
        const createRes = await fetch("http://localhost:5000/api/chat", {
          method: "POST",
          credentials: "include",
        });
        const chatData = await createRes.json();
        currentChatId = chatData.id;
        setChatId(chatData.id);
        isNewChat = true;
        
        // Let the Workspace know so it can refresh the sidebar!
        if(onChatCreated) onChatCreated(chatData.id);
      }

      // 3. Send the message and the selected files to your RAG backend
      const response = await fetch(`http://localhost:5000/api/chat/${currentChatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          mentionedFileIds: selectedFiles ? selectedFiles.map(f => f.id) : []
        }),
      });

      if (!response.ok) throw new Error("Failed to get response");
      
      const data = await response.json();
      
      // 4. Append the AI's response to our UI (the db returns { content: "..." })
      setMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
      
      // 5. Clear the selected files so they don't get re-sent on the next message!
      if (onClearAllContext) onClearAllContext();

      // If this was the first message, tell Workspace to fetch the new LLM title
      if (isNewChat && onChatUpdated) {
        onChatUpdated();
      }
      
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Is the server running?" }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#12141a]">
      {/* Header */}
      <div className="p-4 border-b border-[#232732] flex-shrink-0">
        <h3 className="text-sm font-semibold text-white">Intelligence Chat</h3>
        <p className="text-[11px] text-[#64748b]">
          Ask questions about your library
        </p>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl p-3 text-sm ${
                msg.role === "user"
                  ? "bg-[#38bdf8] text-gray-900 rounded-br-sm"
                  : "bg-[#181b22] border border-[#232732] text-gray-200 rounded-bl-sm"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl p-3 text-sm bg-[#181b22] border border-[#232732] text-gray-400 rounded-bl-sm flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce delay-100"></div>
              <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce delay-200"></div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-[#232732] bg-[#0d0e11] flex-shrink-0">
        {/* Active Context Pill (For your Alt+Click feature!) */}
        {/* Active Context Pills (Scrollable) */}
        {selectedFiles && selectedFiles.length > 0 && (
          <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-[#232732] scrollbar-track-transparent">
            {selectedFiles.map((file) => (
              <div
                key={file.id}
                className="flex-shrink-0 inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#38bdf8]/10 border border-[#38bdf8]/20"
              >
                <FileText className="w-3 h-3 text-[#38bdf8]" />
                <span className="text-[10px] text-[#38bdf8] font-mono truncate max-w-[150px]">
                  {file.original_name}
                </span>
                <button
                  onClick={() => onRemoveContext(file.id)}
                  className="text-[#38bdf8] hover:text-white transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder={isLoading ? "Thinking..." : "Ask anything..."}
            className="w-full h-10 pl-4 pr-10 rounded-lg bg-[#181b22] border border-[#2e3442] text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-[#38bdf8] transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-1.5 rounded text-[#38bdf8] hover:bg-[#38bdf8]/10 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
