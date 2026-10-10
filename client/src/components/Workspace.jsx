import React, { useState, useEffect, useRef } from "react";
import { Toaster, toast } from "react-hot-toast";
import Chat from "./Chat";
import { API_BASE } from "../config";
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
  MessageSquare,
  MoreHorizontal,
  SlidersHorizontal,
  Grid,
  List,
  Check,
  Copy,
  Share2,
  Cloud,
  Star,
  Settings,
  ChevronRight,
  ChevronDown,
  Pin,
  Info,
  X,
  FileDown,
  Menu,
  Keyboard,
  RefreshCw,
  Edit3,
  Zap,
  Sparkles,
  AlertCircle
} from "lucide-react";

export default function Workspace({ user, onLogout, isLoggingOut }) {
  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [activeScope, setActiveScope] = useState("All"); // All, PDFs, Notes, Images, Docs
  const [currentFolder, setCurrentFolder] = useState(null);
  const [isFavoritesOnly, setIsFavoritesOnly] = useState(false);
  const [activeTag, setActiveTag] = useState(null);
  const [sortBy, setSortBy] = useState("date"); // date, name, size

  // View & Inspector
  const [viewMode, setViewMode] = useState("list"); // "list" (dense table) or "grid"
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState("inspector"); // "inspector" or "chat"

  // Collapsible Sidebar Sections
  const [isCollectionsOpen, setIsCollectionsOpen] = useState(true);
  const [isChatsOpen, setIsChatsOpen] = useState(true);

  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [processingCount, setProcessingCount] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dismissProcessingBanner, setDismissProcessingBanner] = useState(false);

  // Persistent Upload Manager Queue (Google Drive style widget)
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isUploadWidgetOpen, setIsUploadWidgetOpen] = useState(true);
  const [showUploadWidget, setShowUploadWidget] = useState(false);

  // Data & Selection
  const [files, setFiles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedFolders, setSelectedFolders] = useState([]);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Inline Note Editing in Inspector
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editingNoteText, setEditingNoteText] = useState("");

  // Shortcuts Modal
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Chat History
  const [pastChats, setPastChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);

  // Refs
  const searchInputRef = useRef(null);
  const folderClickTimerRef = useRef(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isExtractingOcr, setIsExtractingOcr] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(new Date());
  const [, setTick] = useState(0);

  // Update relative time display every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const getSyncTimeText = () => {
    if (isSyncing) return "Syncing with Drive...";
    if (!lastSyncedAt) return "Drive Synced";
    const diffSeconds = Math.max(0, Math.floor((new Date() - new Date(lastSyncedAt)) / 1000));
    if (diffSeconds < 60) return "Synced just now";
    const diffMins = Math.floor(diffSeconds / 60);
    if (diffMins < 60) return `Synced ${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `Synced ${diffHours}h ago`;
  };

  // 1. Data Fetching
  const fetchFiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/files`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
        setLastSyncedAt(new Date());
      }
    } catch (error) {
      console.error("Error fetching files:", error);
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    const syncToast = toast.loading("Syncing with Google Drive...");
    try {
      const res = await fetch(`${API_BASE}/api/files/sync`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Sync failed on server");
      const data = await res.json();
      if (data.files) {
        setFiles(data.files);
      }
      setLastSyncedAt(new Date());
      const imported = data.stats?.importedCount || 0;
      const pruned = data.stats?.prunedCount || 0;
      if (imported > 0 || pruned > 0) {
        toast.success(`Synced! +${imported} imported, -${pruned} pruned`, { id: syncToast });
      } else {
        toast.success("Google Drive is fully up to date!", { id: syncToast });
      }
    } catch (err) {
      console.error("Manual sync error:", err);
      toast.error("Could not sync with Google Drive", { id: syncToast });
    } finally {
      setIsSyncing(false);
    }
  };

  const fetchChats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
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

  useEffect(() => {
    fetchFiles();
    fetchChats();
  }, []);

  // 2. Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ⌘K or Ctrl+K or / to focus search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // I key toggles inspector
      if (e.key.toLowerCase() === "i" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        setIsInspectorOpen((prev) => !prev);
        return;
      }
      // Space key opens selected file in Drive
      if (e.key === " " && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        if (selectedIds.length === 1) {
          e.preventDefault();
          const target = files.find((f) => f.id === selectedIds[0]);
          if (target?.drive_file_id) {
            window.open(`https://drive.google.com/file/d/${target.drive_file_id}/view`, "_blank");
          }
        }
      }
      // Escape clears selections or closes modals
      if (e.key === "Escape") {
        if (isUploadModalOpen) {
          setIsUploadModalOpen(false);
          setUploadFiles([]);
          setUploadNote("");
        } else if (showShortcutsModal) {
          setShowShortcutsModal(false);
        } else if (currentFolder) {
          setCurrentFolder(null);
        }
        setSelectedIds([]);
        setSelectedFolders([]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isUploadModalOpen, showShortcutsModal, currentFolder, selectedIds, files]);

  // 3. Popstate handling
  useEffect(() => {
    const isDeep = isUploadModalOpen || currentFolder || inspectorTab === "chat";
    if (isDeep) {
      window.history.pushState({ deep: true }, "");
    }
  }, [isUploadModalOpen, currentFolder, inspectorTab]);

  useEffect(() => {
    const handlePopState = () => {
      if (isUploadModalOpen) {
        setIsUploadModalOpen(false);
        setUploadFiles([]);
        setUploadNote("");
      } else if (currentFolder) {
        setCurrentFolder(null);
      } else if (inspectorTab === "chat") {
        setInspectorTab("inspector");
      }
      setSelectedIds([]);
      setSelectedFolders([]);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isUploadModalOpen, currentFolder, inspectorTab]);

  // 4. Filtering and Sorting
  const filteredFiles = files.filter((file) => {
    // Search query: checks filename, context notes, folder, and full extracted document text!
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      file.original_name.toLowerCase().includes(q) ||
      (file.context_note && file.context_note.toLowerCase().includes(q)) ||
      (file.ai_result_folder && file.ai_result_folder.toLowerCase().includes(q)) ||
      (file.extracted_text && file.extracted_text.toLowerCase().includes(q));

    // Scope filter (All, PDFs, Notes, Images, Docs)
    let matchesScope = true;
    const mime = (file.mime_type || "").toLowerCase();
    const name = (file.original_name || "").toLowerCase();
    if (activeScope === "PDFs") {
      matchesScope = mime.includes("pdf") || name.endsWith(".pdf");
    } else if (activeScope === "Images") {
      matchesScope = mime.includes("image") || name.match(/\.(png|jpg|jpeg|webp|gif|svg)$/);
    } else if (activeScope === "Docs") {
      matchesScope = mime.includes("word") || mime.includes("document") || name.match(/\.(docx|doc|txt)$/);
    } else if (activeScope === "Notes") {
      matchesScope = Boolean(file.context_note);
    }

    // Active Folder filter
    const matchesFolder = currentFolder
      ? file.ai_result_folder?.toLowerCase() === currentFolder.toLowerCase()
      : true;

    // Active Tag filter
    const matchesTag = activeTag
      ? file.context_note?.toLowerCase().includes(activeTag.toLowerCase()) ||
        file.ai_result_folder?.toLowerCase().includes(activeTag.toLowerCase())
      : true;

    // Favorites filter
    const matchesFavorite = isFavoritesOnly ? Boolean(file.is_favorite) : true;

    return matchesSearch && matchesScope && matchesFolder && matchesTag && matchesFavorite;
  });

  // Sort files
  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (sortBy === "name") {
      return a.original_name.localeCompare(b.original_name);
    }
    if (sortBy === "size") {
      return (b.size_bytes || 0) - (a.size_bytes || 0);
    }
    // Default: date added newest first
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  // Unique Folders List (Collections) with item counts
  const folderCounts = files.reduce((acc, f) => {
    if (f.ai_result_folder) {
      acc[f.ai_result_folder] = (acc[f.ai_result_folder] || 0) + 1;
    }
    return acc;
  }, {});

  const uniqueFolders = Object.keys(folderCounts);

  // Storage calculation
  const totalStorageBytes = files.reduce((acc, f) => acc + (Number(f.size_bytes) || 0), 0);

  // Active / Selected file for Inspector
  const selectedFile =
    selectedIds.length > 0
      ? files.find((f) => f.id === selectedIds[0]) || null
      : null;

  // Sync editing text with selected file
  useEffect(() => {
    if (selectedFile) {
      setEditingNoteText(selectedFile.context_note || "");
      setIsEditingNote(false);
    }
  }, [selectedFile?.id]);

  // Helpers
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "Just now";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getFormatBadge = (file) => {
    const name = (file?.original_name || "").toLowerCase();
    const mime = (file?.mime_type || "").toLowerCase();
    if (mime.includes("pdf") || name.endsWith(".pdf")) {
      return { label: "PDF", style: "bg-red-500/15 text-red-400 border-red-500/30" };
    }
    if (mime.includes("image") || name.match(/\.(png|jpg|jpeg|webp|gif|svg)$/)) {
      return { label: "IMG", style: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    }
    if (mime.includes("word") || mime.includes("document") || name.match(/\.(docx|doc)$/)) {
      return { label: "DOCX", style: "bg-sky-500/15 text-sky-400 border-sky-500/30" };
    }
    if (name.endsWith(".txt") || mime.includes("text")) {
      return { label: "TXT", style: "bg-gray-500/15 text-gray-300 border-gray-500/30" };
    }
    return { label: "FILE", style: "bg-purple-500/15 text-purple-400 border-purple-500/30" };
  };

  // Active uploading items in queue
  const activeProcessingCount = uploadQueue.filter((i) => i.status === "uploading").length;

  // 5. Upload Handler
  const handleUpload = async (filesOverride = null) => {
    const rawFiles = filesOverride || uploadFiles;
    if (!rawFiles || rawFiles.length === 0) {
      toast.error("Please select a file to upload.");
      return;
    }

    const filesToUpload = Array.from(rawFiles);
    const noteToUpload = uploadNote;
    const count = filesToUpload.length;

    // Immediately close modal & reset input so user is not blocked
    setIsUploadModalOpen(false);
    setUploadFiles([]);
    setUploadNote("");
    setIsUploading(true);
    setProcessingCount((prev) => prev + count);
    setDismissProcessingBanner(false);

    // Build unique queue items
    const newItems = filesToUpload.map((f, i) => ({
      id: `${f.name}-${f.size}-${Date.now()}-${i}`,
      file: f,
      name: f.name,
      size: f.size,
      status: "uploading", // 'uploading' | 'done' | 'skipped' | 'failed'
      error: null,
      contextNote: noteToUpload,
    }));

    setUploadQueue((prev) => [...newItems, ...prev]);
    setShowUploadWidget(true);
    setIsUploadWidgetOpen(true);

    const formData = new FormData();
    filesToUpload.forEach((file) => {
      formData.append("files", file);
    });
    if (noteToUpload) {
      formData.append("contextNote", noteToUpload);
    }

    try {
      const res = await fetch(`${API_BASE}/api/files/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const serverError = data.error || data.message || `Upload failed (${res.status})`;
        throw new Error(serverError);
      }

      const uploadedNames = new Set((data.files || []).map((f) => f.original_name));
      const skippedMap = new Map((data.skippedFiles || []).map((s) => [s.fileName, s.reason]));
      const failedMap = new Map((data.failedFiles || []).map((f) => [f.fileName, f.error]));

      setUploadQueue((prev) =>
        prev.map((item) => {
          if (!newItems.some((n) => n.id === item.id)) return item;
          if (uploadedNames.has(item.name)) {
            return { ...item, status: "done" };
          }
          if (skippedMap.has(item.name)) {
            return { ...item, status: "skipped", error: skippedMap.get(item.name) };
          }
          if (failedMap.has(item.name)) {
            return { ...item, status: "failed", error: failedMap.get(item.name) };
          }
          return { ...item, status: "done" };
        })
      );

      if (data.files && data.files.length > 0) {
        setFiles((prev) => [...data.files, ...prev]);
      }

      const countUploaded = data.files?.length || 0;
      const countSkipped = data.skippedFiles?.length || 0;
      const countFailed = data.failedFiles?.length || 0;

      if (countSkipped > 0 && countUploaded > 0) {
        toast.success(`${countUploaded} uploaded, ${countSkipped} existing skipped`);
      } else if (countSkipped > 0 && countUploaded === 0) {
        toast(`All ${countSkipped} file(s) already in library (skipped duplicates)`);
      } else if (countUploaded > 0) {
        toast.success(`${countUploaded} file(s) uploaded and categorized!`);
      }
      if (countFailed > 0) {
        toast.error(`${countFailed} file(s) failed. Retry available in Upload Manager.`);
      }
    } catch (error) {
      console.error("Upload Error:", error);
      setUploadQueue((prev) =>
        prev.map((item) => {
          if (!newItems.some((n) => n.id === item.id)) return item;
          return { ...item, status: "failed", error: error.message || "Upload failed" };
        })
      );
      toast.error(error.message || "Failed to upload. Please try again!");
    } finally {
      setIsUploading(false);
      setProcessingCount(0);
    }
  };

  // Retry individual failed file from Upload Manager widget
  const handleRetryUploadItem = async (queueItem) => {
    if (!queueItem.file) {
      toast.error("File reference no longer available. Please re-select the file.");
      return;
    }

    setUploadQueue((prev) =>
      prev.map((item) =>
        item.id === queueItem.id ? { ...item, status: "uploading", error: null } : item
      )
    );

    const formData = new FormData();
    formData.append("files", queueItem.file);
    if (queueItem.contextNote) {
      formData.append("contextNote", queueItem.contextNote);
    }

    try {
      const res = await fetch(`${API_BASE}/api/files/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Retry failed");

      if (data.files && data.files.length > 0) {
        setFiles((prev) => [...data.files, ...prev]);
        setUploadQueue((prev) =>
          prev.map((item) => (item.id === queueItem.id ? { ...item, status: "done" } : item))
        );
        toast.success(`"${queueItem.name}" uploaded successfully!`);
      } else if (data.skippedFiles && data.skippedFiles.length > 0) {
        setUploadQueue((prev) =>
          prev.map((item) => (item.id === queueItem.id ? { ...item, status: "skipped" } : item))
        );
        toast(`"${queueItem.name}" already in library`);
      } else {
        throw new Error(data.failedFiles?.[0]?.error || "Upload failed");
      }
    } catch (err) {
      setUploadQueue((prev) =>
        prev.map((item) =>
          item.id === queueItem.id ? { ...item, status: "failed", error: err.message } : item
        )
      );
      toast.error(`Retry failed: ${err.message}`);
    }
  };

  // 6. Favorite Toggle Handler (Optimistic UI update)
  const handleToggleFavorite = async (fileId, e = null) => {
    if (e) e.stopPropagation();
    // Optimistic local state update
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, is_favorite: !f.is_favorite } : f))
    );

    try {
      const res = await fetch(`${API_BASE}/api/files/${fileId}/favorite`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update favorite status");
      const data = await res.json();
      if (data.file) {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? data.file : f)));
      }
      toast.success(data.message || "Updated favorites");
    } catch (err) {
      console.error("Favorite toggle error:", err);
      // Rollback on network failure
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, is_favorite: !f.is_favorite } : f))
      );
      toast.error("Could not update favorite");
    }
  };

  // 7. Delete Handlers
  const handleFileDelete = async (fileId) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/files/${fileId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      setSelectedIds((prev) => prev.filter((id) => id !== fileId));
      toast.success("File deleted successfully");
    } catch (error) {
      console.error("Error deleting file:", error);
      toast.error("Failed to delete file");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    setIsDeletingBulk(true);
    const successfullyDeletedIds = [];
    const successfullyDeletedFolders = [];

    // Delete selected folders
    for (const folderName of selectedFolders) {
      try {
        const res = await fetch(
          `${API_BASE}/api/files/folder/${encodeURIComponent(folderName)}`,
          {
            method: "DELETE",
            credentials: "include",
          }
        );
        if (res.ok) {
          successfullyDeletedFolders.push(folderName);
        }
      } catch (err) {
        console.error("Error deleting folder:", err);
      }
    }

    // Delete selected files
    for (const id of selectedIds) {
      try {
        const res = await fetch(`${API_BASE}/api/files/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res.ok) {
          successfullyDeletedIds.push(id);
        }
      } catch (err) {
        console.error(err);
      }
    }

    setFiles((prev) =>
      prev.filter(
        (file) =>
          !successfullyDeletedIds.includes(file.id) &&
          !successfullyDeletedFolders.some(
            (f) => f.toLowerCase() === file.ai_result_folder?.toLowerCase()
          )
      )
    );

    if (
      currentFolder &&
      successfullyDeletedFolders.some(
        (f) => f.toLowerCase() === currentFolder.toLowerCase()
      )
    ) {
      setCurrentFolder(null);
    }

    setSelectedIds([]);
    setSelectedFolders([]);
    setIsDeletingBulk(false);
    toast.success("Deleted successfully!");
  };

  // 7. Save Context Note (Inline in Inspector)
  const handleSaveContextNote = async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch(`${API_BASE}/api/files/${selectedFile.id}/note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contextNote: editingNoteText }),
      });
      if (!res.ok) throw new Error("Failed to update note");
      const updated = await res.json();
      setFiles((prev) =>
        prev.map((f) => (f.id === selectedFile.id ? { ...f, context_note: updated.context_note } : f))
      );
      setIsEditingNote(false);
      toast.success("Context note saved!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update note");
    }
  };

  // Handle On-Demand OCR Extraction
  const handleRunOcr = async (fileId, force = false) => {
    if (!fileId) return;
    setIsExtractingOcr(true);
    const ocrToast = toast.loading("Extracting text layer with OCR...");
    try {
      const url = `${API_BASE}/api/files/${fileId}/ocr${force ? "?force=true" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("OCR extraction failed");
      const data = await res.json();
      const extracted = data.extractedText || "";
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, extracted_text: extracted, status: "ready" } : f))
      );
      toast.success(`OCR complete! Extracted ${extracted.length} characters.`, { id: ocrToast });
    } catch (err) {
      console.error("OCR trigger error:", err);
      toast.error("Failed to run OCR on document.", { id: ocrToast });
    } finally {
      setIsExtractingOcr(false);
    }
  };

  // 8. Delete Chat
  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/chat/${chatId}`, {
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

  // 9. Card and Folder Click Handlers
  const toggleFileSelection = (fileId) => {
    setSelectedIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const handleRowClick = (e, file) => {
    if (e.metaKey || e.ctrlKey) {
      toggleFileSelection(file.id);
    } else {
      setSelectedIds([file.id]);
      setSelectedFolders([]);
    }
  };

  const handleFolderClick = (e, folderName) => {
    if (e.metaKey || e.ctrlKey) {
      if (folderClickTimerRef.current) {
        clearTimeout(folderClickTimerRef.current);
        folderClickTimerRef.current = null;
      }
      if (!selectedFolders.includes(folderName)) {
        setSelectedFolders([...selectedFolders, folderName]);
      } else {
        setSelectedFolders(selectedFolders.filter((f) => f !== folderName));
      }
      return;
    }

    if (folderClickTimerRef.current) {
      clearTimeout(folderClickTimerRef.current);
      folderClickTimerRef.current = null;
      setSelectedFolders([]);
      setSelectedIds([]);
      setCurrentFolder(folderName);
    } else {
      folderClickTimerRef.current = setTimeout(() => {
        setSelectedFolders([folderName]);
        setSelectedIds([]);
        folderClickTimerRef.current = null;
      }, 250);
    }
  };

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sortedFiles.map((f) => f.id));
    }
  };

  const allVisibleSelected =
    sortedFiles.length > 0 && sortedFiles.every((f) => selectedIds.includes(f.id));

  return (
    <div className="h-screen flex flex-col bg-[#0d0e11] text-[#e3e2e6] overflow-hidden selection:bg-[#38bdf8] selection:text-[#0d0e11] font-sans antialiased">
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#181b22",
            color: "#e3e2e6",
            border: "1px solid #232732",
            fontSize: "13px",
          },
        }}
      />

      {/* ======================================================== */}
      {/* 1. TOP APP BAR                                          */}
      {/* ======================================================== */}
      <header className="bg-[#12141a] border-b border-[#232732] flex justify-between items-center w-full px-4 h-12 flex-shrink-0 z-30 select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCollectionsOpen((prev) => !prev)}
            className="text-[#94a3b8] hover:text-white p-1 rounded hover:bg-[#181b22] transition-colors"
            title="Toggle Sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white tracking-tight">Personal Library</span>
            <div
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#181b22] text-[#38bdf8] border border-[#232732] flex items-center gap-1.5 select-none"
              title={lastSyncedAt ? `Last synced: ${new Date(lastSyncedAt).toLocaleTimeString()}` : "Drive sync status"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isSyncing ? "bg-[#38bdf8] animate-ping" : "bg-[#14b8a6] animate-pulse"}`}></span>
              <span>{getSyncTimeText()}</span>
            </div>
          </div>
        </div>

        {/* Central Search Bar with ⌘K */}
        <div className="flex-1 max-w-2xl mx-6">
          <div className="relative flex items-center w-full">
            <Search className="absolute left-2.5 text-[#64748b] w-4 h-4 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search files, notes, or keywords (e.g. "CN Unit 3 TCP flow control")...'
              className="w-full h-8 pl-8 pr-16 bg-[#0d0e11] border border-[#232732] rounded text-xs text-[#e3e2e6] placeholder-[#64748b] focus:outline-none focus:border-[#38bdf8] transition-colors"
            />
            <div className="absolute right-2 flex items-center gap-1 pointer-events-none">
              <kbd className="text-[10px] font-mono bg-[#181b22] px-1.5 py-0.5 rounded border border-[#2e3442] text-[#94a3b8]">
                ⌘K
              </kbd>
              <kbd className="text-[10px] font-mono bg-[#181b22] px-1.5 py-0.5 rounded border border-[#2e3442] text-[#94a3b8]">
                /
              </kbd>
            </div>
          </div>
        </div>

        {/* Trailing Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="h-8 px-3 bg-[#f3f4f6] text-[#0d0e11] hover:bg-white font-medium text-xs rounded flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Add Files</span>
          </button>
          <div className="h-4 w-px bg-[#232732] mx-1"></div>
          <button
            onClick={() => setShowShortcutsModal(true)}
            className="p-1.5 text-[#94a3b8] hover:text-white hover:bg-[#181b22] rounded transition-colors"
            title="Keyboard Shortcuts"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className={`p-1.5 rounded transition-colors ${
              isSyncing
                ? "text-[#38bdf8] bg-[#181b22]"
                : "text-[#94a3b8] hover:text-[#38bdf8] hover:bg-[#181b22]"
            }`}
            title="Sync with Google Drive (Two-Way Sync)"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin text-[#38bdf8]" : ""}`} />
          </button>
          <div className="h-4 w-px bg-[#232732] mx-1"></div>
          <button
            onClick={onLogout}
            disabled={isLoggingOut}
            className="p-1.5 text-[#64748b] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ======================================================== */}
      {/* 2. THREE-PANE APPLICATION BODY                          */}
      {/* ======================================================== */}
      <div className="flex flex-1 overflow-hidden">
        {/* ====================================================== */}
        {/* PANE 1: LEFT SIDEBAR (Drive Workspace - 240px)        */}
        {/* ====================================================== */}
        <aside className="w-60 bg-[#12141a] border-r border-[#232732] flex flex-col flex-shrink-0 select-none overflow-y-auto custom-scrollbar">
          {/* Header & Storage */}
          <div className="px-4 pt-3 pb-2.5 border-b border-[#232732]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Drive Workspace
              </span>
              <MoreHorizontal className="w-3.5 h-3.5 text-[#64748b] cursor-pointer hover:text-white" />
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#94a3b8]">
              <span className="w-2 h-2 rounded-full bg-[#14b8a6]"></span>
              <span>Synced • {formatBytes(totalStorageBytes)} used</span>
            </div>
          </div>

          {/* Core Navigation Items */}
          <nav className="py-2 flex flex-col gap-0.5 border-b border-[#232732]">
            {/* All Files */}
            <button
              onClick={() => {
                setCurrentFolder(null);
                setActiveTag(null);
                setIsFavoritesOnly(false);
                setActiveScope("All");
              }}
              className={`flex items-center justify-between px-4 py-1.5 text-xs font-medium transition-colors ${
                !currentFolder && !activeTag && !isFavoritesOnly
                  ? "bg-[#181b22] text-[#38bdf8] border-l-2 border-[#38bdf8]"
                  : "text-[#94a3b8] hover:bg-[#181b22] hover:text-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Folder className="w-4 h-4" />
                <span>All Files</span>
              </div>
              <span className="font-mono text-[10px] bg-[#0d0e11] px-1.5 py-0.5 rounded border border-[#232732] text-[#38bdf8]">
                {files.length}
              </span>
            </button>

            {/* Collections (Folders) Header */}
            <div className="pt-2">
              <button
                onClick={() => setIsCollectionsOpen((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-1 text-xs text-[#94a3b8] hover:text-white"
              >
                <div className="flex items-center gap-2">
                  <Folder className="w-3.5 h-3.5 text-[#64748b]" />
                  <span className="font-semibold text-[11px] uppercase tracking-wider font-mono">Collections</span>
                </div>
                {isCollectionsOpen ? (
                  <ChevronDown className="w-3 h-3 text-[#64748b]" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-[#64748b]" />
                )}
              </button>

              {/* Collections Sub-tree */}
              {isCollectionsOpen && (
                <div className="pl-6 pr-2 flex flex-col gap-0.5 py-1">
                  {uniqueFolders.map((folderName) => {
                    const isSelected = selectedFolders.includes(folderName);
                    const isActive = currentFolder?.toLowerCase() === folderName.toLowerCase();
                    return (
                      <div
                        key={folderName}
                        onClick={(e) => handleFolderClick(e, folderName)}
                        className={`group flex items-center justify-between py-1 px-2 rounded text-xs transition-colors cursor-pointer ${
                          isActive
                            ? "bg-[#1f2430] text-[#38bdf8] font-medium"
                            : isSelected
                            ? "bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/40"
                            : "text-[#94a3b8] hover:bg-[#181b22] hover:text-white"
                        }`}
                      >
                        <span className="truncate">{folderName}</span>
                        <span className="font-mono text-[10px] text-[#64748b] group-hover:text-[#94a3b8]">
                          {folderCounts[folderName]}
                        </span>
                      </div>
                    );
                  })}
                  {uniqueFolders.length === 0 && (
                    <span className="text-[11px] text-[#64748b] italic py-1 px-2">No collections yet</span>
                  )}
                </div>
              )}
            </div>

            {/* Processing Status Tab */}
            <div
              onClick={() => {
                if (uploadQueue.length > 0) {
                  setShowUploadWidget(true);
                  setIsUploadWidgetOpen(true);
                }
              }}
              className="group relative flex items-center justify-between px-4 py-1.5 text-xs text-[#94a3b8] hover:bg-[#181b22] hover:text-white cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <RefreshCw
                  className={`w-3.5 h-3.5 text-[#f59e0b] ${
                    activeProcessingCount > 0 ? "animate-spin" : ""
                  }`}
                />
                <span>Processing Status</span>
              </div>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full border transition-colors ${
                  activeProcessingCount > 0
                    ? "bg-[#f59e0b]/20 text-[#f59e0b] border-[#f59e0b]/30 animate-pulse"
                    : uploadQueue.length > 0
                    ? "bg-[#38bdf8]/15 text-[#38bdf8] border-[#38bdf8]/30"
                    : "bg-[#232732] text-[#64748b] border-[#2b3040]"
                }`}
              >
                {activeProcessingCount > 0 ? activeProcessingCount : uploadQueue.length}
              </span>

              {/* Hover Popover showing live queue */}
              {uploadQueue.length > 0 && (
                <div className="hidden group-hover:block absolute left-full top-0 ml-2 w-64 p-3 bg-[#12141a] border border-[#2b3040] rounded-xl shadow-2xl z-50 pointer-events-none animate-fadeIn">
                  <div className="text-[11px] font-semibold text-white mb-2 flex items-center justify-between border-b border-[#232732] pb-1.5">
                    <span>Processing Pipeline</span>
                    <span className="font-mono text-[10px] text-[#38bdf8]">
                      {activeProcessingCount > 0
                        ? `${activeProcessingCount} in flight`
                        : `${uploadQueue.length} total`}
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-44 overflow-hidden">
                    {uploadQueue.slice(0, 6).map((q) => (
                      <div
                        key={q.id}
                        className="flex items-center justify-between text-[10px] text-[#94a3b8]"
                      >
                        <span className="truncate max-w-[140px] text-gray-200">
                          {q.name}
                        </span>
                        <span
                          className={`capitalize font-mono ${
                            q.status === "done"
                              ? "text-emerald-400"
                              : q.status === "skipped"
                              ? "text-amber-400"
                              : q.status === "failed"
                              ? "text-red-400"
                              : "text-[#38bdf8]"
                          }`}
                        >
                          {q.status}
                        </span>
                      </div>
                    ))}
                    {uploadQueue.length > 6 && (
                      <p className="text-[9px] text-[#64748b] pt-1">
                        +{uploadQueue.length - 6} more files
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </nav>

          {/* Auxiliary Navigation: Favorites */}
          <div className="py-2 flex flex-col gap-0.5 border-b border-[#232732]">
            <button
              onClick={() => {
                setIsFavoritesOnly((prev) => !prev);
                setCurrentFolder(null);
                setActiveTag(null);
              }}
              className={`flex items-center justify-between px-4 py-1.5 text-xs transition-colors ${
                isFavoritesOnly
                  ? "bg-amber-400/10 text-amber-300 font-medium border-l-2 border-amber-400"
                  : "text-[#94a3b8] hover:bg-[#181b22] hover:text-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Star
                  className={`w-3.5 h-3.5 ${
                    isFavoritesOnly ? "text-amber-400 fill-amber-400" : "text-amber-400/80"
                  }`}
                />
                <span>Favorites</span>
              </div>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full border transition-colors ${
                  files.filter((f) => f.is_favorite).length > 0
                    ? "bg-amber-400/20 text-amber-300 border-amber-400/30"
                    : "bg-[#232732] text-[#64748b] border-[#2b3040]"
                }`}
              >
                {files.filter((f) => f.is_favorite).length}
              </span>
            </button>
          </div>

          {/* Chat Sessions Sub-tree */}
          <div className="py-2 flex-1">
            <button
              onClick={() => setIsChatsOpen((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-1 text-xs text-[#94a3b8] hover:text-white"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-[#64748b]" />
                <span className="font-semibold text-[11px] uppercase tracking-wider font-mono">Chat History</span>
              </div>
              {isChatsOpen ? (
                <ChevronDown className="w-3 h-3 text-[#64748b]" />
              ) : (
                <ChevronRight className="w-3 h-3 text-[#64748b]" />
              )}
            </button>

            {isChatsOpen && (
              <div className="pl-6 pr-2 flex flex-col gap-1 py-1">
                {pastChats.map((chat) => (
                  <div
                    key={chat.id}
                    onClick={() => {
                      setActiveChatId(chat.id);
                      setInspectorTab("chat");
                      setIsInspectorOpen(true);
                    }}
                    className={`group relative flex items-center justify-between py-1 px-2 rounded text-xs transition-colors cursor-pointer ${
                      activeChatId === chat.id && inspectorTab === "chat"
                        ? "bg-[#1f2430] text-[#38bdf8] font-medium"
                        : "text-[#94a3b8] hover:bg-[#181b22] hover:text-white"
                    }`}
                  >
                    <span className="truncate pr-4">{chat.title}</span>
                    <button
                      onClick={(e) => handleDeleteChat(e, chat.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[#64748b] hover:text-red-400 rounded transition-opacity"
                      title="Delete Chat"
                    >
                      <Trash className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {pastChats.length === 0 && (
                  <span className="text-[11px] text-[#64748b] italic py-1 px-2">No past chats</span>
                )}
              </div>
            )}
          </div>

          {/* Bottom Settings Button */}
          <div className="mt-auto p-2 border-t border-[#232732]">
            <button
              onClick={() => setShowShortcutsModal(true)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-[#94a3b8] hover:bg-[#181b22] hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" />
                <span>Shortcuts & Settings</span>
              </div>
              <span className="font-mono text-[10px] text-[#64748b]">⌘,</span>
            </button>
          </div>
        </aside>

        {/* ====================================================== */}
        {/* PANE 2: CATALOG WORKSPACE (Center Fluid Area)          */}
        {/* ====================================================== */}
        <main className="flex-1 flex flex-col min-w-[380px] bg-[#0d0e11] overflow-hidden">
          {/* Active Processing Banner (as seen in Stitch screen) */}
          {(isUploading || (!dismissProcessingBanner && processingCount > 0)) && (
            <div className="mx-4 mt-3 p-2.5 bg-[#12141a] border border-[#38bdf8]/30 rounded flex items-center justify-between shadow-sm animate-fadeIn">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded bg-[#38bdf8]/10 border border-[#38bdf8]/30 flex items-center justify-center text-[#38bdf8]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-white">
                    {processingCount > 1 ? `${processingCount} files processing:` : "Processing:"}
                  </span>
                  <span className="font-mono text-[#38bdf8]">
                    {processingCount > 1 ? `${processingCount} items` : "Uploading & indexing"}
                  </span>
                  <span className="text-[#64748b]">•</span>
                  <span className="text-[#94a3b8]">Categorizing & syncing with Google Drive in background...</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Hairline progress bar */}
                <div className="w-24 h-1.5 bg-[#181b22] rounded-full overflow-hidden">
                  <div className="h-full bg-[#38bdf8] rounded-full animate-pulse w-full"></div>
                </div>
                <button
                  onClick={() => setDismissProcessingBanner(true)}
                  className="text-[#64748b] hover:text-white p-0.5 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Action & Filter Header */}
          <div className="px-6 pt-4 pb-2.5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {(currentFolder || isFavoritesOnly) && (
                  <button
                    onClick={() => {
                      setCurrentFolder(null);
                      setIsFavoritesOnly(false);
                    }}
                    className="p-1 hover:bg-[#181b22] rounded text-[#64748b] hover:text-white transition-colors"
                    title="Back to All Files"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  {isFavoritesOnly ? (
                    <>
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                      <span>Favorites</span>
                    </>
                  ) : currentFolder ? (
                    currentFolder
                  ) : (
                    "All Documents"
                  )}
                </h1>
                <span className="text-xs font-mono text-[#64748b]">
                  ({sortedFiles.length} {sortedFiles.length === 1 ? "file" : "files"})
                </span>
                {activeTag && (
                  <span className="text-xs px-2 py-0.5 rounded bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30 flex items-center gap-1 font-mono">
                    {activeTag}
                    <X
                      className="w-3 h-3 cursor-pointer hover:text-white"
                      onClick={() => setActiveTag(null)}
                    />
                  </span>
                )}
              </div>

              {/* Sort Dropdown & View Mode Controls */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-[#94a3b8] bg-[#12141a] px-2.5 py-1 rounded border border-[#232732]">
                  <span className="text-[#64748b]">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-transparent text-white font-medium focus:outline-none cursor-pointer text-xs"
                  >
                    <option value="date" className="bg-[#12141a]">Date Added</option>
                    <option value="name" className="bg-[#12141a]">Title / Name</option>
                    <option value="size" className="bg-[#12141a]">File Size</option>
                  </select>
                </div>

                {/* View Toggles (Dense List vs Grid View) */}
                <div className="flex items-center p-0.5 bg-[#12141a] border border-[#232732] rounded">
                  <button
                    onClick={() => setViewMode("list")}
                    className={`p-1 rounded transition-colors ${
                      viewMode === "list"
                        ? "bg-[#1f2430] text-[#38bdf8] shadow-sm"
                        : "text-[#64748b] hover:text-white"
                    }`}
                    title="Dense List View"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`p-1 rounded transition-colors ${
                      viewMode === "grid"
                        ? "bg-[#1f2430] text-[#38bdf8] shadow-sm"
                        : "text-[#64748b] hover:text-white"
                    }`}
                    title="Grid Card View"
                  >
                    <Grid className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center justify-between border-b border-[#232732] pb-2.5">
              <div className="flex items-center gap-1.5">
                {["All", "PDFs", "Notes", "Images", "Docs"].map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setActiveScope(scope)}
                    className={`px-2.5 py-0.5 rounded text-xs transition-colors font-medium ${
                      activeScope === scope
                        ? "bg-[#f3f4f6] text-[#0d0e11]"
                        : "bg-[#12141a] border border-[#232732] text-[#94a3b8] hover:text-white hover:bg-[#181b22]"
                    }`}
                  >
                    {scope}
                  </button>
                ))}
              </div>
              <button
                onClick={() => toast("Advanced filters coming soon!")}
                className="text-xs text-[#64748b] hover:text-[#e3e2e6] flex items-center gap-1.5 transition-colors"
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Advanced Filters</span>
                <span className="text-[9px] bg-[#232732] text-amber-400/80 px-1.5 py-0.2 rounded border border-[#2b3040]">Coming Soon</span>
              </button>
            </div>
          </div>

          {/* Batch Action Bar */}
          {(selectedIds.length > 0 || selectedFolders.length > 0) && (
            <div className="h-10 px-6 border-b border-[#38bdf8]/30 bg-[#38bdf8]/5 flex items-center justify-between animate-fadeIn">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-5 h-5 rounded bg-[#38bdf8] text-[#0d0e11] text-xs font-bold">
                  {selectedIds.length + selectedFolders.length}
                </div>
                <span className="text-xs font-medium text-[#38bdf8]">
                  {selectedFolders.length > 0 && selectedIds.length === 0
                    ? `${selectedFolders.length} Folder${selectedFolders.length > 1 ? "s" : ""} Selected`
                    : selectedIds.length > 0 && selectedFolders.length === 0
                    ? `${selectedIds.length} File${selectedIds.length > 1 ? "s" : ""} Selected`
                    : `${selectedFolders.length} Folders, ${selectedIds.length} Files Selected`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedIds([]);
                    setSelectedFolders([]);
                  }}
                  className="px-2.5 py-1 rounded hover:bg-[#181b22] text-xs text-[#94a3b8] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={isDeletingBulk}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {isDeletingBulk ? (
                    <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Trash className="w-3.5 h-3.5" />
                  )}
                  <span>{isDeletingBulk ? "Deleting..." : "Delete Selected"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Main Catalog View Area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-4">
            {sortedFiles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#232732] rounded-xl my-4">
                <div className="w-12 h-12 rounded-xl bg-[#12141a] border border-[#232732] flex items-center justify-center text-[#64748b] mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">No documents found</h3>
                <p className="text-xs text-[#94a3b8] max-w-sm mb-4">
                  {searchQuery
                    ? `No files matching "${searchQuery}"`
                    : "Upload PDFs, notes, or images to begin indexing."}
                </p>
                <button
                  onClick={() => setIsUploadModalOpen(true)}
                  className="h-8 px-4 rounded bg-[#181b22] hover:bg-[#232732] border border-[#232732] text-xs font-medium text-white transition-colors"
                >
                  Upload First File
                </button>
              </div>
            ) : viewMode === "list" ? (
              /* ======================================================== */
              /* DENSE DATA TABLE (Exact Stitch Specification)           */
              /* ======================================================== */
              <table className="w-full text-left border-collapse table-fixed select-none">
                <thead>
                  <tr className="h-8 border-b border-[#232732] text-xs text-[#64748b] font-mono">
                    <th className="w-8 pl-2">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={handleSelectAll}
                        className="rounded-sm border-[#2e3442] bg-transparent text-[#38bdf8] focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="w-[34%] font-medium">Title</th>
                    <th className="w-[14%] font-medium">Collection</th>
                    <th className="w-[24%] font-medium">Context Note</th>
                    <th className="w-[10%] font-medium">Status</th>
                    <th className="w-[10%] font-medium">Added</th>
                    <th className="w-[8%] font-medium text-right pr-2">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232732]/60 text-xs font-sans">
                  {sortedFiles.map((file) => {
                    const isSelected = selectedIds.includes(file.id);
                    const badge = getFormatBadge(file);

                    return (
                      <tr
                        key={file.id}
                        onClick={(e) => handleRowClick(e, file)}
                        onDoubleClick={() =>
                          window.open(
                            `https://drive.google.com/file/d/${file.drive_file_id}/view`,
                            "_blank"
                          )
                        }
                        className={`h-9 transition-colors group cursor-pointer ${
                          isSelected
                            ? "bg-[#1f2430] border-l-2 border-[#38bdf8]"
                            : "hover:bg-[#12141a]/80"
                        }`}
                      >
                        <td className="pl-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleFileSelection(file.id)}
                            className="rounded-sm border-[#2e3442] bg-transparent text-[#38bdf8] focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer"
                          />
                        </td>
                        <td className="pr-2 truncate">
                          <div className="flex items-center gap-1.5 truncate">
                            <button
                              onClick={(e) => handleToggleFavorite(file.id, e)}
                              className={`p-0.5 rounded transition-colors shrink-0 ${
                                file.is_favorite
                                  ? "text-amber-400"
                                  : "text-[#475569] hover:text-amber-400 opacity-0 group-hover:opacity-100"
                              }`}
                              title={file.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
                            >
                              <Star className={`w-3.5 h-3.5 ${file.is_favorite ? "fill-amber-400 text-amber-400" : ""}`} />
                            </button>
                            <span
                              className={`text-[9px] font-mono font-semibold px-1 py-0.2 rounded border ${badge.style}`}
                            >
                              {badge.label}
                            </span>
                            <span className="font-medium text-[#e3e2e6] truncate group-hover:text-white">
                              {file.original_name}
                            </span>
                          </div>
                        </td>
                        <td className="pr-2 truncate text-[#94a3b8]">
                          {file.ai_result_folder ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#181b22] border border-[#232732] text-[11px] font-mono text-[#38bdf8] truncate">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] inline-block"></span>
                              {file.ai_result_folder}
                            </span>
                          ) : (
                            <span className="text-[#64748b] text-[11px]">—</span>
                          )}
                        </td>
                        <td className="pr-2 truncate">
                          {file.context_note ? (
                            <span className="inline-flex items-center gap-1 text-[#7bd0ff] bg-[#181b22] px-2 py-0.5 rounded text-[11px] truncate border border-[#232732]">
                              <span>📌 {file.context_note}</span>
                            </span>
                          ) : (
                            <span className="text-[#64748b] text-[11px] italic">No note</span>
                          )}
                        </td>
                        <td className="pr-2">
                          {file.status === "processing" ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#38bdf8] bg-[#38bdf8]/10 border border-[#38bdf8]/30 px-1.5 py-0.5 rounded font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-ping"></span>
                              Processing
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#14b8a6] bg-[#14b8a6]/10 border border-[#14b8a6]/30 px-1.5 py-0.5 rounded font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#14b8a6]"></span>
                              Ready
                            </span>
                          )}
                        </td>
                        <td className="pr-2 text-[#64748b] font-mono text-xs">
                          {formatDate(file.created_at)}
                        </td>
                        <td className="pr-2 text-right text-[#64748b] font-mono text-xs">
                          {formatBytes(file.size_bytes)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* ======================================================== */
              /* GRID CARDS VIEW                                          */
              /* ======================================================== */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
                {/* Folders (only if root) */}
                {!currentFolder &&
                  uniqueFolders.map((folderName) => (
                    <div
                      key={folderName}
                      onClick={(e) => handleFolderClick(e, folderName)}
                      onDoubleClick={() => {
                        if (folderClickTimerRef.current) {
                          clearTimeout(folderClickTimerRef.current);
                          folderClickTimerRef.current = null;
                        }
                        setSelectedFolders([]);
                        setSelectedIds([]);
                        setCurrentFolder(folderName);
                      }}
                      className={`flex flex-col h-24 p-4 rounded-lg border transition-all cursor-pointer group ${
                        selectedFolders.includes(folderName)
                          ? "border-[#38bdf8] bg-[#38bdf8]/10 shadow-md shadow-[#38bdf8]/10"
                          : "bg-[#181b22]/50 border-[#232732] hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/5"
                      }`}
                    >
                      <div className="flex items-center gap-3 h-full">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110 ${
                            selectedFolders.includes(folderName)
                              ? "bg-[#38bdf8] text-[#0d0e11]"
                              : "bg-[#38bdf8]/10 text-[#38bdf8]"
                          }`}
                        >
                          <Folder className="w-5 h-5 fill-current/20" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold truncate text-white group-hover:text-[#38bdf8] transition-colors">
                            {folderName}
                          </h4>
                          <p className="text-[11px] text-[#64748b] mt-0.5 font-mono">
                            {folderCounts[folderName]} items
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                {/* File Cards */}
                {sortedFiles.map((file) => {
                  const isSelected = selectedIds.includes(file.id);
                  return (
                    <div
                      key={file.id}
                      onClick={(e) => handleRowClick(e, file)}
                      onDoubleClick={() =>
                        window.open(
                          `https://drive.google.com/file/d/${file.drive_file_id}/view`,
                          "_blank"
                        )
                      }
                      className={`flex flex-col p-4 rounded-lg bg-[#12141a] border transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#38bdf8] shadow-md shadow-[#38bdf8]/10 bg-[#181b22]"
                          : "border-[#232732] hover:border-[#2e3442] hover:bg-[#181b22]/60"
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
                            {formatBytes(file.size_bytes)} • {formatDate(file.created_at)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => handleToggleFavorite(file.id, e)}
                          className={`p-1 rounded transition-colors ${
                            file.is_favorite ? "text-amber-400" : "text-[#475569] hover:text-amber-400"
                          }`}
                          title={file.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
                        >
                          <Star className={`w-3.5 h-3.5 ${file.is_favorite ? "fill-amber-400 text-amber-400" : ""}`} />
                        </button>
                      </div>

                      {/* Context Note Box */}
                      {file.context_note && (
                        <div className="mt-3 pt-2.5 border-t border-[#232732]">
                          <div className="p-2 rounded bg-[#181b22]/70 border border-[#232732] text-xs">
                            <p className="text-[10px] font-mono uppercase text-[#38bdf8] mb-0.5">
                              Context Note
                            </p>
                            <p className="text-[#e3e2e6] text-[11px] line-clamp-2 italic">
                              {file.context_note}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Persistent Footer Status Bar (Exact Stitch Specification) */}
          <footer className="h-7 border-t border-[#232732] bg-[#12141a] px-4 flex items-center justify-between text-[11px] font-mono text-[#64748b] flex-shrink-0 select-none">
            <div className="flex items-center gap-3">
              <span>
                Selected: <strong className="text-white">{selectedIds.length + selectedFolders.length}</strong> items
              </span>
              <span>•</span>
              <span>
                Semantic Vector Store: <span className="text-[10px] bg-[#181b22] text-amber-400/90 px-1.5 py-0.5 rounded border border-[#232732]">Coming Soon</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span>
                Press <kbd className="bg-[#181b22] px-1 py-0.5 rounded border border-[#2e3442] text-[#e3e2e6]">Space</kbd> to quick-preview
              </span>
              <span>•</span>
              <span>
                Press <kbd className="bg-[#181b22] px-1 py-0.5 rounded border border-[#2e3442] text-[#e3e2e6]">I</kbd> to toggle Inspector
              </span>
            </div>
          </footer>
        </main>

        {/* ====================================================== */}
        {/* PANE 3: CONTEXTUAL INSPECTOR / CHAT (Right 340px)     */}
        {/* ====================================================== */}
        {isInspectorOpen && (
          <aside className={`${inspectorTab === "chat" ? "w-[400px]" : "w-[340px]"} bg-[#12141a] border-l border-[#232732] flex flex-col flex-shrink-0 select-none overflow-y-auto custom-scrollbar animate-slideIn transition-all duration-200`}>
            {/* Dual Mode Switch: Inspector vs Intelligence Chat */}
            <div className="flex items-center p-2 border-b border-[#232732] gap-1 bg-[#0d0e11]/40">
              <button
                onClick={() => setInspectorTab("inspector")}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded transition-colors ${
                  inspectorTab === "inspector"
                    ? "bg-[#232732] text-white"
                    : "text-[#64748b] hover:text-[#94a3b8] hover:bg-[#181b22]"
                }`}
              >
                <Info className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>Inspector</span>
              </button>
              <button
                onClick={() => setInspectorTab("chat")}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded transition-colors ${
                  inspectorTab === "chat"
                    ? "bg-[#38bdf8]/10 text-[#38bdf8]"
                    : "text-[#64748b] hover:text-[#94a3b8] hover:bg-[#181b22]"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>AI Chat</span>
              </button>
            </div>

            {/* TAB 1: INSPECTOR DETAILS */}
            {inspectorTab === "inspector" && (
              <div className="flex-1 flex flex-col">
                {/* Header bar */}
                <div className="h-9 px-4 border-b border-[#232732] flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Info className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>Document Inspector</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (selectedFile) {
                          navigator.clipboard.writeText(selectedFile.id);
                          toast.success("Document ID copied!");
                        }
                      }}
                      className="p-1 text-[#64748b] hover:text-white rounded hover:bg-[#181b22]"
                      title="Copy Document ID"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setIsInspectorOpen(false)}
                      className="p-1 text-[#64748b] hover:text-white rounded hover:bg-[#181b22]"
                      title="Close Inspector"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {selectedFile ? (
                  <div className="p-4 flex flex-col gap-4">
                    {/* Preview Thumbnail & Core Details */}
                    <div className="p-3 bg-[#181b22] border border-[#232732] rounded flex gap-3 items-start">
                      <div className="w-12 h-16 bg-[#232732] border border-[#2e3442] rounded flex flex-col items-center justify-center text-red-400 flex-shrink-0 relative">
                        <FileText className="w-6 h-6" />
                        <span className="font-mono text-[9px] text-[#94a3b8] mt-1 uppercase font-semibold">
                          {selectedFile.original_name?.split('.').pop() || "PDF"}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <h2 className="text-xs font-semibold text-white truncate leading-tight" title={selectedFile.original_name}>
                            {selectedFile.original_name}
                          </h2>
                          <button
                            onClick={() => handleToggleFavorite(selectedFile.id)}
                            className={`p-1 rounded transition-colors shrink-0 ${
                              selectedFile.is_favorite
                                ? "text-amber-400"
                                : "text-[#64748b] hover:text-amber-400"
                            }`}
                            title={selectedFile.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
                          >
                            <Star className={`w-3.5 h-3.5 ${selectedFile.is_favorite ? "fill-amber-400 text-amber-400" : ""}`} />
                          </button>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-[#14b8a6]/10 border border-[#14b8a6]/30 text-[#14b8a6] rounded">
                            Indexed &amp; Searchable
                          </span>
                        </div>
                        <p className="font-mono text-[10px] text-[#64748b] mt-1 truncate">
                          Drive ID: {selectedFile.drive_file_id}
                        </p>
                      </div>
                    </div>

                    {/* First-Class Context & User Notes Box with Edit */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#64748b] flex items-center gap-1">
                          <Pin className="w-3 h-3 text-[#38bdf8]" />
                          <span>Context &amp; User Notes</span>
                        </label>
                        {!isEditingNote ? (
                          <button
                            onClick={() => setIsEditingNote(true)}
                            className="text-[#38bdf8] hover:underline text-xs flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => setIsEditingNote(false)}
                            className="text-[#94a3b8] hover:text-white text-xs"
                          >
                            Cancel
                          </button>
                        )}
                      </div>

                      {isEditingNote ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                            className="w-full h-24 p-2.5 bg-[#0d0e11] border border-[#38bdf8] rounded text-xs text-white focus:outline-none"
                            placeholder="Add your note or self-chat context..."
                          />
                          <button
                            onClick={handleSaveContextNote}
                            className="self-end px-3 py-1 bg-[#38bdf8] text-[#0d0e11] text-xs font-semibold rounded hover:bg-[#7bd0ff]"
                          >
                            Save Note
                          </button>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-[#0d0e11] border border-[#232732] rounded text-xs text-[#e3e2e6] leading-relaxed">
                          {selectedFile.context_note ? (
                            selectedFile.context_note
                          ) : (
                            <span className="text-[#64748b] italic">No attached note for this document.</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Semantic OCR Text Preview Box */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#64748b] flex items-center gap-1">
                          <Search className="w-3 h-3 text-[#14b8a6]" />
                          <span>Extracted Document Text</span>
                        </label>
                        {selectedFile.extracted_text && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] bg-[#14b8a6]/10 text-[#14b8a6] px-1.5 py-0.5 rounded border border-[#14b8a6]/30">
                              {selectedFile.extracted_text.length.toLocaleString()} chars
                            </span>
                            <button
                              onClick={() => handleRunOcr(selectedFile.id, true)}
                              disabled={isExtractingOcr}
                              className="p-1 hover:text-[#38bdf8] text-[#94a3b8] rounded transition-colors disabled:opacity-50"
                              title="Re-run OCR extraction"
                            >
                              <RefreshCw className={`w-3 h-3 ${isExtractingOcr ? "animate-spin text-[#38bdf8]" : ""}`} />
                            </button>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(selectedFile.extracted_text);
                                toast.success("OCR text copied to clipboard!");
                              }}
                              className="p-1 hover:text-white text-[#94a3b8] rounded transition-colors"
                              title="Copy Extracted Text"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {selectedFile.extracted_text ? (
                        <div className="p-2.5 bg-[#0d0e11] border border-[#232732] rounded font-mono text-[11px] text-[#bdc8d1] leading-relaxed max-h-48 overflow-y-auto custom-scrollbar select-text whitespace-pre-wrap">
                          {selectedFile.extracted_text}
                        </div>
                      ) : (
                        <div className="p-4 bg-[#0d0e11] border border-dashed border-[#232732] rounded font-mono text-[11px] text-[#64748b] flex flex-col items-center justify-center gap-2.5 text-center">
                          <span>No extracted text layer detected yet.</span>
                          <button
                            onClick={() => handleRunOcr(selectedFile.id)}
                            disabled={isExtractingOcr}
                            className="px-3 py-1.5 bg-[#181b22] hover:bg-[#232732] border border-[#232732] hover:border-[#38bdf8]/40 text-xs text-[#38bdf8] rounded font-mono flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-sm"
                          >
                            {isExtractingOcr ? (
                              <>
                                <span className="w-3 h-3 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
                                <span>Extracting text...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Extract Text with OCR</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* File Specifications Grid */}
                    <div className="flex flex-col gap-2 border-t border-[#232732] pt-3">
                      <label className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#64748b]">
                        File Specifications
                      </label>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 bg-[#181b22] rounded border border-[#232732]">
                          <span className="text-[#64748b] text-[10px] block mb-0.5 font-mono">Drive Location</span>
                          <span className="font-mono text-[11px] text-white truncate block">
                            /Drive/{selectedFile.ai_result_folder || "Root"}
                          </span>
                        </div>
                        <div className="p-2 bg-[#181b22] rounded border border-[#232732]">
                          <span className="text-[#64748b] text-[10px] block mb-0.5 font-mono">File Size</span>
                          <span className="font-mono text-[11px] text-white block">
                            {formatBytes(selectedFile.size_bytes)}
                          </span>
                        </div>
                        <div className="p-2 bg-[#181b22] rounded border border-[#232732]">
                          <span className="text-[#64748b] text-[10px] block mb-0.5 font-mono">Uploaded</span>
                          <span className="font-mono text-[11px] text-white block">
                            {formatDate(selectedFile.created_at)}
                          </span>
                        </div>
                        <div className="p-2 bg-[#181b22] rounded border border-[#232732]">
                          <span className="text-[#64748b] text-[10px] block mb-0.5 font-mono">Indexing Engine</span>
                          <span className="font-mono text-[11px] text-[#38bdf8] block truncate">
                            Tiered OCR & Search
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Associated Tags */}
                    <div className="flex flex-col gap-1.5 border-t border-[#232732] pt-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#64748b]">
                          Associated Tags
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          `#${selectedFile.ai_result_folder?.toLowerCase() || "academic"}`,
                          "#exam-prep",
                          "#syllabus"
                        ].map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded bg-[#181b22] border border-[#232732] text-[11px] font-mono text-[#94a3b8]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2 pt-2">
                      <button
                        onClick={() =>
                          window.open(
                            `https://drive.google.com/file/d/${selectedFile.drive_file_id}/view`,
                            "_blank"
                          )
                        }
                        className="w-full py-2 bg-[#f3f4f6] text-[#0d0e11] hover:bg-white font-semibold text-xs rounded flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open in Google Drive</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (selectedFile.context_note) {
                              navigator.clipboard.writeText(selectedFile.context_note);
                              toast.success("Context copied to clipboard!");
                            } else {
                              toast("No context note to copy");
                            }
                          }}
                          className="flex-1 py-1.5 bg-[#181b22] hover:bg-[#232732] border border-[#232732] text-xs font-medium text-white rounded flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Copy className="w-3 h-3 text-[#38bdf8]" />
                          <span>Copy Context</span>
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `https://drive.google.com/file/d/${selectedFile.drive_file_id}/view`
                            );
                            toast.success("Drive link copied!");
                          }}
                          className="flex-1 py-1.5 bg-[#181b22] hover:bg-[#232732] border border-[#232732] text-xs font-medium text-white rounded flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Share2 className="w-3 h-3 text-[#14b8a6]" />
                          <span>Share</span>
                        </button>
                      </div>

                      <button
                        onClick={() => handleFileDelete(selectedFile.id)}
                        disabled={isDeleting}
                        className="w-full py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Trash className="w-3.5 h-3.5" />
                        <span>Delete File</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#64748b]">
                    <FileText className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-xs">Select a document to inspect details.</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: AI INTELLIGENCE CHAT */}
            {inspectorTab === "chat" && (
              <div className="flex-1 flex flex-col relative overflow-hidden">
                <Chat
                  user={user}
                  activeChatId={activeChatId}
                  selectedFile={selectedFile}
                  selectedFiles={files.filter((f) => selectedIds.includes(f.id))}
                  allFiles={files}
                  folders={uniqueFolders}
                  activeFolder={currentFolder}
                  onChatCreated={(id) => {
                    setActiveChatId(id);
                    fetchChats();
                  }}
                  onChatUpdated={() => {
                    fetchChats();
                  }}
                  onNewChat={() => {
                    setActiveChatId(null);
                  }}
                  onClose={() => setIsInspectorOpen(false)}
                  onUpdateFileNote={async (fileId, newNote) => {
                    try {
                      const res = await fetch(`${API_BASE}/api/files/${fileId}/note`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ contextNote: newNote }),
                      });
                      if (res.ok) {
                        setFiles((prev) =>
                          prev.map((f) => (f.id === fileId ? { ...f, context_note: newNote } : f))
                        );
                        toast.success("Saved to Context Notes!");
                      } else {
                        toast.error("Failed to update context note");
                      }
                    } catch (err) {
                      console.error(err);
                      toast.error("Failed to update note");
                    }
                  }}
                />
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ======================================================== */}
      {/* 4. MODALS & POPUPS                                      */}
      {/* ======================================================== */}

      {/* Upload Document Modal */}
      {isUploadModalOpen && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-[#12141a] rounded-xl w-[480px] border border-[#232732] shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#232732] flex items-center justify-between bg-[#181b22]/50">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded bg-[#38bdf8]/10 border border-[#38bdf8]/20 flex items-center justify-center text-[#38bdf8]">
                  <Upload className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h2 className="text-white font-semibold text-xs">Upload Document</h2>
                  <p className="text-[11px] text-[#64748b]">
                    Bulk upload with AI folder categorization
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setUploadFiles([]);
                  setUploadNote("");
                }}
                className="text-[#64748b] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              {/* Drag & Drop Area */}
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (e.dataTransfer.files?.length > 0) {
                    setUploadFiles(Array.from(e.dataTransfer.files));
                  }
                }}
                className={`flex flex-col items-center justify-center w-full min-h-[7rem] p-4 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
                  isDragOver || uploadFiles.length > 0
                    ? "border-[#38bdf8] bg-[#38bdf8]/5"
                    : "border-[#232732] bg-[#181b22] hover:bg-[#1f2430]"
                }`}
              >
                <Upload className="w-6 h-6 text-[#38bdf8] mb-1.5" />
                {uploadFiles.length > 0 ? (
                  <p className="text-xs font-semibold text-white">
                    {uploadFiles.length} file(s) selected
                  </p>
                ) : (
                  <>
                    <p className="text-xs font-medium text-white mb-0.5">
                      Drop files here or click to browse
                    </p>
                    <p className="text-[11px] text-[#64748b]">PDF, DOCX, PNG, JPG, TXT</p>
                  </>
                )}
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    if (e.target.files?.length > 0) {
                      setUploadFiles(Array.from(e.target.files));
                    }
                  }}
                  className="hidden"
                />
              </label>

              {/* Context Note Input */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-mono text-[#94a3b8] uppercase">
                  Context Note (Self-chat style)
                </label>
                <textarea
                  value={uploadNote}
                  onChange={(e) => setUploadNote(e.target.value)}
                  placeholder="e.g. 'Midterm notes from Prof. Smith, Chapter 4 derivations'..."
                  className="w-full h-20 p-2.5 bg-[#0d0e11] border border-[#232732] rounded text-xs text-white focus:outline-none focus:border-[#38bdf8]"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#232732]">
                <button
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setUploadFiles([]);
                    setUploadNote("");
                  }}
                  className="px-3 py-1.5 text-xs text-[#94a3b8] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUpload()}
                  disabled={uploadFiles.length === 0}
                  className="px-4 py-1.5 bg-[#38bdf8] hover:bg-[#7bd0ff] text-[#00354a] font-semibold text-xs rounded transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadFiles.length > 0 ? `Upload ${uploadFiles.length} file(s)` : "Upload"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-[#12141a] rounded-xl w-[420px] border border-[#232732] shadow-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#232732] flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Keyboard Shortcuts</span>
              <button onClick={() => setShowShortcutsModal(false)} className="text-[#64748b] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2.5 text-xs">
              {[
                { key: "⌘K or /", desc: "Focus file search" },
                { key: "Space", desc: "Quick preview / open in Google Drive" },
                { key: "I", desc: "Toggle right Inspector pane" },
                { key: "Ctrl + Click", desc: "Multi-select documents or folders" },
                { key: "Double Click", desc: "Open folder / View file in Drive" },
                { key: "Esc", desc: "Deselect items / Close modals" },
              ].map((s) => (
                <div key={s.key} className="flex items-center justify-between py-1 border-b border-[#232732]/40">
                  <span className="text-[#94a3b8]">{s.desc}</span>
                  <kbd className="font-mono text-[11px] bg-[#181b22] px-2 py-0.5 rounded border border-[#2e3442] text-white">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Google Drive Style Upload Manager Widget (Bottom-Right) */}
      {showUploadWidget && uploadQueue.length > 0 && (
        <div className="fixed bottom-5 right-6 z-50 w-88 bg-[#12141a]/95 backdrop-blur-md border border-[#2b3040] rounded-xl shadow-2xl overflow-hidden animate-slideUp">
          {/* Header Bar */}
          <div className="px-3.5 py-2.5 bg-[#181b22] border-b border-[#232732] flex items-center justify-between">
            <div className="flex items-center gap-2">
              {activeProcessingCount > 0 ? (
                <RefreshCw className="w-3.5 h-3.5 text-[#38bdf8] animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span className="text-xs font-medium text-white">
                {activeProcessingCount > 0
                  ? `Uploading ${uploadQueue.length} item(s)...`
                  : `Uploads complete (${uploadQueue.length})`}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsUploadWidgetOpen((prev) => !prev)}
                className="p-1 hover:bg-[#232732] rounded text-[#64748b] hover:text-white transition-colors"
                title={isUploadWidgetOpen ? "Minimize" : "Expand"}
              >
                {isUploadWidgetOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setShowUploadWidget(false)}
                className="p-1 hover:bg-[#232732] rounded text-[#64748b] hover:text-white transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Collapsible Item List */}
          {isUploadWidgetOpen && (
            <div className="max-h-64 overflow-y-auto divide-y divide-[#1e222d] text-xs">
              {uploadQueue.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 flex items-center justify-between hover:bg-[#181b22]/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                    {item.status === "uploading" && (
                      <RefreshCw className="w-3.5 h-3.5 text-[#38bdf8] animate-spin shrink-0" />
                    )}
                    {item.status === "done" && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    {item.status === "skipped" && (
                      <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    {item.status === "failed" && (
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-white font-medium text-[11px]">
                        {item.name}
                      </p>
                      <p className="text-[10px] text-[#64748b]">
                        {formatBytes(item.size)} •{" "}
                        <span
                          className={
                            item.status === "done"
                              ? "text-emerald-400"
                              : item.status === "skipped"
                              ? "text-amber-400 font-medium"
                              : item.status === "failed"
                              ? "text-red-400 font-medium"
                              : "text-[#38bdf8]"
                          }
                        >
                          {item.status === "uploading"
                            ? "Uploading & categorizing..."
                            : item.status === "done"
                            ? "Complete"
                            : item.status === "skipped"
                            ? "Skipped (Duplicate)"
                            : "Failed"}
                        </span>
                      </p>
                    </div>
                  </div>

                  {item.status === "failed" && (
                    <button
                      onClick={() => handleRetryUploadItem(item)}
                      className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 rounded text-[10px] flex items-center gap-1 transition-colors shrink-0"
                      title="Retry upload"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                      Retry
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
