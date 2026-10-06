import React, { useState, useEffect} from "react";
import { Toaster, toast } from "react-hot-toast";
import Chat from "./Chat"; // NEW: Import our Chat component!
import {
  HardDrive,
  Search,
  LogOut,
  Upload,
  FileText,
  Image as ImageIcon,
  Folder,
  Tag,
  Clock,
  ExternalLink,
  Plus,
  CheckCircle2,
  FileCode,
  Trash,
  ArrowLeft,
  MessageSquare
} from "lucide-react";

export default function Workspace({ user, onLogout, isLoggingOut }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [files, setFiles] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedFile =
    selectedIds.length > 0
      ? files.find((f) => f.id === selectedIds[0])
      : null;
  const selectedFiles = files.filter((f) => selectedIds.includes(f.id));

  const [activeScope, setActiveScope] = useState("All files");
  const [currentFolder, setCurrentFolder] = useState(null);
  const [sidebarMode, setSidebarMode] = useState("details"); // Toggle between 'details' and 'chat'
  
  // Chat History State
  const [pastChats, setPastChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // This runs every time the component renders (like when the user types a letter)
  const filteredFiles = files.filter((file) => {
    // 1. Check if it matches the Search Query (check both original_name and context_note)
    const matchesSearch =
      file.original_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (file.context_note &&
        file.context_note.toLowerCase().includes(searchQuery.toLowerCase()));

    // 2. Check if it matches the Active Scope
    let matchesScope = true;
    if (activeScope === "Documents") {
      // Check if file.mime_type includes 'pdf' or 'document' (like word docs)
      matchesScope =
        file.mime_type?.includes("pdf") ||
        file.mime_type?.includes("document") ||
        file.mime_type?.includes("text");
    } else if (activeScope === "Images") {
      // Check if file.mime_type includes 'image'
      matchesScope = file.mime_type?.includes("image");
    }

    return matchesSearch && matchesScope;
  });

  // Calculate Folders and Files to display based on current selection
  const uniqueFolders = Array.from(
    new Set(filteredFiles.map((f) => f.ai_result_folder).filter(Boolean)),
  );

  const displayedFiles = currentFolder
    ? filteredFiles.filter((f) => f.ai_result_folder === currentFolder)
    : filteredFiles.filter((f) => !f.ai_result_folder);

  const fetchFiles = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/files", {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to fetch files from backend");
      }

      const data = await res.json();
      setFiles(data);
    } catch (error) {
      console.error("Error fetching files:", error);
    }
  };

  const fetchChats = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/chat", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setPastChats(data);
      }
    } catch (error) {
      console.error("Error fetching chats:", error);
    }
  };

  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation(); // Prevent the chat button click from firing
    try {
      const res = await fetch(`http://localhost:5000/api/chat/${chatId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        if (activeChatId === chatId) {
          setActiveChatId(null);
        }
        fetchChats();
        toast.success("Chat deleted");
      }
    } catch (error) {
      console.error("Error deleting chat:", error);
      toast.error("Failed to delete chat");
    }
  };

  useEffect(() => {
    fetchFiles();
    fetchChats();
  }, []);

  // Close upload modal on Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        // If the modal is open, close it
        if (isUploadModalOpen) {
          setIsUploadModalOpen(false);
          setUploadFiles([]);
          setUploadNote("");
        }

        // Always clear the multi-selection if Escape is pressed
        setSelectedIds([]);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isUploadModalOpen, selectedIds]);

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) {
      toast.error("Please select a file to upload.");
      return;
    }
    setIsUploading(true);
    const formData = new FormData();
    uploadFiles.forEach((file) => {
      formData.append("files", file);
    });
    if (uploadNote) {
      formData.append("contextNote", uploadNote);
    }

    try {
      const res = await fetch("http://localhost:5000/api/files/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        throw new Error("Upload failed on Backend");
      }
      const data = await res.json();
      console.log("Uploaded Successfully:", data);
      setFiles((prev) => [...data.files, ...prev]);

      // Reset state on success
      setIsUploading(false);
      setUploadFiles([]);
      setUploadNote("");
      setIsUploadModalOpen(false);
    } catch (error) {
      console.error("Error:", error);
      setIsUploading(false);
      toast.error("Failed to upload. Please try again!");
    }
  };

  const handleFileDelete = async (fileId) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`http://localhost:5000/api/files/${fileId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Delete failed on Backend");
      }

      // Remove file from state
      setFiles((prev) => prev.filter((f) => f.id !== fileId));

      // Clear selection if the deleted file was selected
      if (selectedFile?.id === fileId) {
        setSelectedFile(null);
      }

      toast.success("Deleted Successfully");
    } catch (error) {
      console.error("Error deleting file:", error);
      toast.error("Failed to delete file. Please try again!");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    setIsDeletingBulk(true);
    // keeping track of all the that were succesfully deleted
    const successfullyDeletedIds = [];

    // 2. Loop through all selected IDs
    for (const id of selectedIds) {
      // 3. Put a try/catch INSIDE the loop so one failure doesn't stop the rest!
      try {
        const res = await fetch(`http://localhost:5000/api/files/${id}`, {
          method: "DELETE",
          credentials: "include",
        });

        if (!res.ok) {
          throw new Error(`Failed to delete file ${id}`);
        }

        // If we make it here, it succeeded! Add it to our tracking array
        successfullyDeletedIds.push(id);
      } catch (err) {
        // This only catches the error for THIS specific file.
        // The loop will automatically continue to the next file!
        console.error(err);
      }
    }
    // 4. Now, only remove the files from the UI that actually succeeded
    setFiles((prev) =>
      prev.filter((file) => !successfullyDeletedIds.includes(file.id)),
    );
    // 5. Clean up the UI selection
    setSelectedIds([]);

    if (successfullyDeletedIds.length < selectedIds.length) {
      toast.error("Some files could not be deleted. Please try again!");
    } else {
      toast.success("Files deleted successfully!");
    }
    setIsDeletingBulk(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setUploadFiles(Array.from(files));
    }
  };

  const handleCardClick = (e, file) => {
    if (e.metaKey || e.ctrlKey) {
      if (!selectedIds.includes(file.id)) {
        setSelectedIds([...selectedIds, file.id]);
      } else {
        setSelectedIds(selectedIds.filter((id) => id !== file.id));
      }
    } else {
      setSelectedIds([file.id]);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#0d0e11] text-[#e3e2e6] overflow-hidden selection:bg-[#38bdf8] selection:text-[#0d0e11]">
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#181b22",
            color: "#e3e2e6",
            border: "1px solid #232732",
            fontSize: "14px",
          },
        }}
      />
      {/* Top App Bar */}
      <header className="h-12 border-b border-[#232732] bg-[#12141a] px-4 flex items-center justify-between flex-shrink-0 z-20">
        {/* Brand */}
        <div className="flex items-center gap-3 w-64">
          <div className="w-7 h-7 rounded bg-[#181b22] border border-[#2e3442] flex items-center justify-center text-[#38bdf8]">
            <HardDrive className="w-4 h-4" />
          </div>
          <span className="font-semibold text-xs tracking-tight text-white font-mono">
            PersonalFile<span className="text-[#38bdf8]">Intelligence</span>
          </span>
        </div>

        {/* Global Search Bar */}
        <div className="flex-1 max-w-md mx-4">
          <div className="relative">
            <Search className="w-4 h-4 text-[#64748b] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by filename or attached context note..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-9 pr-4 text-xs bg-[#181b22] border border-[#232732] rounded-md text-white placeholder-[#64748b] focus:outline-none focus:border-[#38bdf8] transition-colors"
            />
          </div>
        </div>

        {/* Right Controls (Sync & User Profile) */}
        <div className="flex items-center gap-3">
          {/* Sync Status Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#14b8a6]/10 border border-[#14b8a6]/30 text-[11px] font-mono text-[#14b8a6]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#14b8a6]"></span>
            <span>Drive Synced</span>
          </div>

          {/* User Profile */}
          <div className="flex items-center gap-2 pl-2 border-l border-[#232732]">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.name}
                className="w-7 h-7 rounded-full border border-[#2e3442]"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#181b22] border border-[#2e3442] flex items-center justify-center text-xs font-semibold">
                {user?.name?.[0] || "U"}
              </div>
            )}
            <span className="text-xs font-medium text-white max-w-[120px] truncate hidden md:inline">
              {user?.name}
            </span>

            {/* Logout Button */}
            <button
              onClick={onLogout}
              disabled={isLoggingOut}
              title="Sign Out"
              className="p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#181b22] transition-colors disabled:opacity-50 flex items-center justify-center"
            >
              {isLoggingOut ? (
                <div className="w-4 h-4 border-2 border-[#94a3b8] border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <LogOut className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Tri-Pane Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Navigation & Collections (240px fixed) */}
        <aside className="w-60 border-r border-[#232732] bg-[#12141a] flex flex-col justify-between flex-shrink-0">
          <div className="p-3 space-y-4">
            <div>
              <p className="px-2 text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-1.5">
                Library Scopes
              </p>
              <nav className="space-y-0.5">
                <button
                  onClick={() => setActiveScope("All files")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                    activeScope === "All files"
                      ? "font-medium bg-[#181b22] text-[#38bdf8] border border-[#2e3442]/60"
                      : "text-[#94a3b8] hover:text-white hover:bg-[#181b22]/50 border border-transparent"
                  }`}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>All Files</span>
                </button>

                <button
                  onClick={() => setActiveScope("Documents")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                    activeScope === "Documents"
                      ? "font-medium bg-[#181b22] text-[#38bdf8] border border-[#2e3442]/60"
                      : "text-[#94a3b8] hover:text-white hover:bg-[#181b22]/50 border border-transparent"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Documents</span>
                </button>

                <button
                  onClick={() => setActiveScope("Images")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                    activeScope === "Images"
                      ? "font-medium bg-[#181b22] text-[#38bdf8] border border-[#2e3442]/60"
                      : "text-[#94a3b8] hover:text-white hover:bg-[#181b22]/50 border border-transparent"
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Images</span>
                </button>
              </nav>
            </div>

            {/* Recent Chats Section */}
            <div className="pt-2 border-t border-[#232732]">
              <div className="flex items-center justify-between px-2 mb-1.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#64748b]">
                  Recent Chats
                </p>
                <button
                  onClick={() => {
                    setActiveChatId(null);
                    setSidebarMode("chat");
                  }}
                  className="p-1 hover:bg-[#232732] rounded text-[#64748b] hover:text-[#38bdf8] transition-colors"
                  title="New Chat"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <nav className="space-y-0.5 max-h-48 overflow-y-auto">
                {pastChats.length === 0 ? (
                  <p className="text-xs text-[#64748b] px-2 italic py-1">No past chats.</p>
                ) : (
                  pastChats.map((chat) => (
                    <div key={chat.id} className="relative group flex items-center">
                      <button
                        onClick={() => {
                          setActiveChatId(chat.id);
                          setSidebarMode("chat");
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs transition-colors text-left truncate pr-8 ${
                          activeChatId === chat.id && sidebarMode === "chat"
                            ? "font-medium bg-[#181b22] text-[#38bdf8] border border-[#2e3442]/60"
                            : "text-[#94a3b8] hover:text-white hover:bg-[#181b22]/50 border border-transparent"
                        }`}
                      >
                        <MessageSquare className="w-3 h-3 shrink-0" />
                        <span className="truncate">{chat.title}</span>
                      </button>
                      <button
                        onClick={(e) => handleDeleteChat(e, chat.id)}
                        className="absolute right-1 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-[#64748b] hover:text-red-400 rounded transition-all"
                        title="Delete Chat"
                      >
                        <Trash className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </nav>
            </div>
          </div>
        </aside>
        {/* Center Catalog Workspace (Fluid Width) */}
        <section className="flex-1 flex flex-col bg-[#0d0e11] overflow-y-auto">
          {/* Action Bar */}
          <div className="h-12 px-6 border-b border-[#232732] flex items-center justify-between bg-[#12141a]/40">
            <div>
              <div className="flex items-center gap-2">
                {currentFolder && (
                  <button
                    onClick={() => setCurrentFolder(null)}
                    className="p-1 hover:bg-[#232732] rounded text-[#64748b] hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <h2 className="text-sm font-semibold text-white">
                  {currentFolder ? currentFolder : "All Documents"}
                </h2>
              </div>
              <p className="text-[11px] text-[#64748b]">
                {currentFolder
                  ? "Files in this category"
                  : "Indexed with metadata and attached notes"}
              </p>
            </div>

            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="h-8 px-3 rounded-md bg-[#38bdf8] hover:bg-[#7bd0ff] text-[#00354a] font-semibold text-xs flex items-center gap-1.5 transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Upload Document</span>
            </button>

            {isUploadModalOpen && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-[#12141a] rounded-2xl w-[480px] border border-[#232732] shadow-2xl flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="px-6 py-4 border-b border-[#232732] flex items-center gap-3 bg-[#181b22]/50">
                    <div className="w-8 h-8 rounded bg-[#38bdf8]/10 border border-[#38bdf8]/20 flex items-center justify-center text-[#38bdf8]">
                      <Upload className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-white font-semibold text-sm">
                        Upload Document
                      </h2>
                      <p className="text-[11px] text-[#64748b]">
                        Add a file to your personal intelligence catalog
                      </p>
                    </div>
                  </div>

                  <div className="p-6 flex flex-col gap-5">
                    {/* File Input (Drag & Drop Zone style) */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-[#94a3b8] font-medium uppercase tracking-wider font-mono">
                        Source File
                      </label>
                      <label
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`relative flex flex-col items-center justify-center w-full min-h-[8rem] h-auto p-4 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
                          isDragOver || uploadFiles.length > 0
                            ? "border-[#38bdf8] bg-[#38bdf8]/5"
                            : "border-[#2e3442] bg-[#181b22] hover:bg-[#232732] hover:border-[#64748b]"
                        }
                        `}
                      >
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          {uploadFiles.length > 0 ? (
                            <>
                              <FileText className="w-8 h-8 text-[#38bdf8] mb-2" />
                              <p className="text-sm font-semibold text-white truncate max-w-[300px]">
                                {uploadFiles.length > 1 ? (
                                  <span>
                                    {uploadFiles.length} files selected
                                  </span>
                                ) : (
                                  uploadFiles[0].name
                                )}
                              </p>
                              {uploadFiles.map((file) => (
                                <p
                                  key={file.name}
                                  className="text-xs text-[#64748b] mt-1"
                                >
                                  {file.name + " - " + formatBytes(file.size)}
                                </p>
                              ))}
                            </>
                          ) : (
                            <>
                              <Upload className="w-8 h-8 text-[#64748b] mb-2" />
                              <p className="mb-1 text-sm text-[#94a3b8]">
                                <span className="font-semibold text-white">
                                  Click to upload
                                </span>{" "}
                                or drag and drop
                              </p>
                              <p className="text-xs text-[#64748b]">
                                PDF, Images, or Text files
                              </p>
                            </>
                          )}
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          onChange={(e) =>
                            setUploadFiles(Array.from(e.target.files))
                          }
                        />
                      </label>
                    </div>

                    {/* Context Note Input */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-[#94a3b8] font-medium uppercase tracking-wider font-mono">
                        Context Note (Optional)
                      </label>
                      <textarea
                        placeholder="Why are you saving this? What should you remember about it?"
                        value={uploadNote}
                        onChange={(e) => setUploadNote(e.target.value)}
                        className="w-full h-24 p-3 text-sm bg-[#181b22] border border-[#2e3442] rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8] transition-all resize-none shadow-inner"
                      ></textarea>
                      <p className="text-[10px] text-[#64748b] italic mt-1 text-center">
                        * Note: If the database is asleep, the first upload
                        attempt might fail. Just try again!
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="px-6 py-4 bg-[#181b22]/50 border-t border-[#232732] flex justify-end gap-3">
                    <button
                      onClick={() => {
                        setIsUploadModalOpen(false);
                        setUploadFiles([]);
                        setUploadNote("");
                      }}
                      className="px-4 py-2 text-xs font-semibold text-[#94a3b8] hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpload}
                      disabled={isUploading || uploadFiles.length === 0}
                      className="px-6 py-2 bg-[#38bdf8] hover:bg-[#7bd0ff] disabled:opacity-50 disabled:cursor-not-allowed text-[#00354a] font-semibold text-xs rounded-md transition-all shadow-sm flex items-center gap-2"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-[#00354a] border-t-transparent rounded-full animate-spin"></div>
                          Uploading & Categorizing...
                        </>
                      ) : (
                        "Confirm Upload"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Batch Action Bar */}
          {selectedIds.length > 0 && (
            <div className="h-12 px-6 border-b border-[#38bdf8]/30 bg-[#38bdf8]/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-5 h-5 rounded bg-[#38bdf8] text-[#0d0e11] text-xs font-bold">
                  {selectedIds.length}
                </div>
                <span className="text-xs font-medium text-[#38bdf8]">
                  Files Selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedIds([])}
                  className="px-3 py-1.5 rounded hover:bg-[#181b22] text-xs text-[#94a3b8] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={isDeletingBulk}
                  className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeletingBulk ? (
                    <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Trash className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isDeletingBulk ? "Deleting..." : "Delete Selected"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Catalog Content Area */}
          <div className="p-6 flex-1">
            {files.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#232732] rounded-xl">
                <div className="w-12 h-12 rounded-xl bg-[#181b22] border border-[#2e3442] flex items-center justify-center text-[#64748b] mb-4">
                  <Upload className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  No documents uploaded yet
                </h3>
                <p className="text-xs text-[#94a3b8] max-w-sm mb-4">
                  Upload a PDF, screenshot, or document and attach your personal
                  context note (just like a self-chat message).
                </p>
                <button className="h-8 px-4 rounded bg-[#181b22] hover:bg-[#232732] border border-[#2e3442] text-xs font-medium text-white transition-colors">
                  Upload First File
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* 1. Render Folders (only if we are at the root) */}
                {!currentFolder &&
                  uniqueFolders.map((folderName) => (
                    <div
                      key={folderName}
                      onDoubleClick={() => setCurrentFolder(folderName)}
                      className="flex flex-col h-24 p-4 rounded-lg bg-[#181b22]/50 border border-[#232732] hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/5 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 h-full">
                        <div className="w-10 h-10 rounded-lg bg-[#38bdf8]/10 flex items-center justify-center text-[#38bdf8] group-hover:scale-110 transition-transform">
                          <Folder className="w-5 h-5 fill-[#38bdf8]/20" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-white truncate group-hover:text-[#38bdf8] transition-colors">
                            {folderName}
                          </h4>
                          <p className="text-[11px] text-[#64748b] mt-0.5 font-mono">
                            {
                              filteredFiles.filter(
                                (f) => f.ai_result_folder === folderName,
                              ).length
                            }{" "}
                            items
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                {/* 2. Render Files */}
                {displayedFiles.map((file) => (
                  <div
                    key={file.id}
                    onClick={(e) => handleCardClick(e, file)}
                    className={`flex flex-col h-full p-4 rounded-lg bg-[#12141a] border transition-all cursor-pointer ${
                      selectedIds.includes(file.id)
                        ? "border-[#38bdf8] shadow-md shadow-[#38bdf8]/10"
                        : "border-[#232732] hover:border-[#2e3442] hover:bg-[#181b22]/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded bg-[#181b22] border border-[#2e3442] flex items-center justify-center text-[#38bdf8] flex-shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-medium text-white truncate">
                          {file.original_name}
                        </h4>
                        <p className="text-[11px] font-mono text-[#64748b] mt-0.5">
                          {formatBytes(file.size_bytes)} • PDF
                        </p>
                      </div>
                    </div>

                    {/* The Context Note Feature Card */}
                    {file.context_note ? (
                      <div className="mt-auto pt-3">
                        <div className="p-2.5 rounded bg-[#181b22]/70 border border-[#2e3442]/50 text-xs h-full">
                          <p className="text-[10px] font-mono uppercase text-[#38bdf8] mb-0.5">
                            Context Note
                          </p>
                          <p className="text-[#e3e2e6] text-[11px] line-clamp-2 italic">
                            {file.context_note}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-auto pt-3">
                        <div className="p-2.5 rounded border border-dashed border-[#232732] text-xs h-full flex items-center justify-center">
                          <p className="text-[#64748b] italic text-[11px]">
                            No context provided
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>{" "}
        {/* Right Contextual Inspector & Chat (Dual Mode) */}
        <aside
          className={`border-l border-[#232732] bg-[#12141a] flex flex-col flex-shrink-0 transition-all duration-300 ${sidebarMode === "chat" ? "w-[450px]" : "w-80"}`}
        >
          {/* Dual Mode Toggle */}
          <div className="flex items-center p-2 border-b border-[#232732] gap-1">
            <button
              onClick={() => setSidebarMode("details")}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded transition-colors ${sidebarMode === "details" ? "bg-[#232732] text-white" : "text-[#64748b] hover:text-[#94a3b8] hover:bg-[#181b22]"}`}
            >
              <FileCode className="w-3.5 h-3.5" />
              Details
            </button>
            <button
              onClick={() => setSidebarMode("chat")}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded transition-colors ${sidebarMode === "chat" ? "bg-[#38bdf8]/10 text-[#38bdf8]" : "text-[#64748b] hover:text-[#94a3b8] hover:bg-[#181b22]"}`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Intelligence Chat
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto relative">
            {/* CHAT MODE */}
            <div className={`absolute inset-0 ${sidebarMode === "chat" ? "block" : "hidden"}`}>
              <Chat
                user={user}
                activeChatId={activeChatId}
                selectedFiles={selectedFiles}
                onRemoveContext={(fileIdToRemove) => {
                  setSelectedIds(
                    selectedIds.filter((id) => id !== fileIdToRemove),
                  );
                }}
                onClearAllContext={() => setSelectedIds([])}
                onChatCreated={(newChatId) => {
                  setActiveChatId(newChatId);
                  fetchChats();
                  // Re-fetch a few seconds later to catch the LLM-generated title!
                  setTimeout(fetchChats, 4000);
                }}
              />
            </div>

            {/* DETAILS MODE */}
            <div className={`absolute inset-0 ${sidebarMode === "details" ? "block" : "hidden"}`}>
              <div className="p-4 flex flex-col h-full overflow-y-auto">
                {selectedFile ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-[#64748b]">
                        Document Inspector
                      </p>
                      <h3 className="text-sm font-semibold text-white mt-1 break-words">
                        {selectedFile.original_name}
                      </h3>
                    </div>

                    {/* Attached Context Note Section */}
                    {selectedFile.context_note ? (
                      <div className="p-3 rounded-lg bg-[#181b22] border border-[#2e3442]">
                        <p className="text-[10px] font-mono uppercase text-[#38bdf8] font-semibold mb-1">
                          Attached Context Note
                        </p>
                        <p className="text-xs text-[#e3e2e6] italic">
                          {selectedFile.context_note}
                        </p>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg border border-dashed border-[#232732]">
                        <p className="text-xs text-[#64748b] italic text-center">
                          No context note provided
                        </p>
                      </div>
                    )}

                    {/* Technical Metadata */}
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-[#232732]">
                        <span className="text-[#64748b]">File Size</span>
                        <span className="text-white font-mono text-[11px]">
                          {formatBytes(selectedFile.size_bytes)}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[#232732]">
                        <span className="text-[#64748b]">Uploaded</span>
                        <span className="text-white font-mono text-[11px]">
                          {new Date(
                            selectedFile.created_at,
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-4 flex flex-col gap-2">
                      <a
                        href={`https://drive.google.com/file/d/${selectedFile.drive_file_id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full h-8 flex items-center justify-center gap-2 rounded bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20 border border-[#38bdf8]/30 text-[#38bdf8] text-xs font-semibold transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open in Drive</span>
                      </a>

                      <button
                        onClick={() => handleFileDelete(selectedFile.id)}
                        disabled={isDeleting}
                        className="w-full h-8 flex items-center justify-center gap-2 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isDeleting ? (
                          <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Trash className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isDeleting ? "Deleting..." : "Delete File"}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-[#64748b]">
                    <FileCode className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-xs">
                      Select a document to inspect attached context and Drive
                      metadata.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
