import React, { useState, useEffect} from "react";
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
} from "lucide-react";

export default function Workspace({ user, onLogout }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [files, setFiles] = useState([]);
  
  const fetchFiles = async () => {
    try{
      const res = await fetch("http://localhost:5000/api/files", {
        credentials: "include"
      });

      if(!res.ok){
        throw new Error("Failed to fetch files from backend")
      }

      const data = await res.json();
      setFiles(data);
      
    }
    catch(error){ 
      console.error("Error fetching files:", error);
    }
  } 

  useEffect(() => {
    fetchFiles();
  }, [])

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      alert("Please select a file to upload.");
      return;
    }
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', uploadFile);
    if (uploadNote) {
      formData.append('contextNote', uploadNote);
    }
   
    try {
      const res = await fetch("http://localhost:5000/api/files/upload", {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!res.ok) {
        throw new Error("Upload failed on Backend");
      }
      const data = await res.json();
      console.log("Uploaded Successfully:", data);
      setFiles((prev) => [data.file, ...prev]);
      
      // Reset state on success
      setIsUploading(false);
      setUploadFile(null);
      setUploadNote("");
      setIsUploadModalOpen(false);
    } catch (error) {
      console.error("Error:", error);
      setIsUploading(false);
      alert("Failed to upload.");
    }
  };
  

  return (
    <div className="h-screen flex flex-col bg-[#0d0e11] text-[#e3e2e6] overflow-hidden selection:bg-[#38bdf8] selection:text-[#0d0e11]">
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

        {/* Global Search Bar (⌘K) */}
        <div className="flex-1 max-w-md mx-4">
          <div className="relative">
            <Search className="w-4 h-4 text-[#64748b] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by filename or attached context note..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-9 pr-14 text-xs bg-[#181b22] border border-[#232732] rounded-md text-white placeholder-[#64748b] focus:outline-none focus:border-[#38bdf8] transition-colors"
            />
            <div className="absolute right-2 top-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#12141a] border border-[#2e3442] text-[10px] font-mono text-[#94a3b8]">
              <span>⌘</span>K
            </div>
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
              title="Sign Out"
              className="p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#181b22] transition-colors"
            >
              <LogOut className="w-4 h-4" />
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
                <button className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs font-medium bg-[#181b22] text-[#38bdf8] border border-[#2e3442]/60">
                  <Folder className="w-3.5 h-3.5" />
                  <span>All Documents</span>
                </button>
                <button className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs text-[#94a3b8] hover:text-white hover:bg-[#181b22]/50 transition-colors">
                  <FileText className="w-3.5 h-3.5" />
                  <span>College PDFs & Notes</span>
                </button>
                <button className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-xs text-[#94a3b8] hover:text-white hover:bg-[#181b22]/50 transition-colors">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Screenshots</span>
                </button>
              </nav>
            </div>

            <div>
              <p className="px-2 text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-1.5">
                Storage Target
              </p>
              <div className="px-2.5 py-2 rounded bg-[#181b22]/60 border border-[#232732] text-xs">
                <div className="flex items-center justify-between text-[#94a3b8]">
                  <span>Backend</span>
                  <span className="text-white font-mono text-[11px]">
                    Google Drive
                  </span>
                </div>
                <div className="flex items-center justify-between text-[#94a3b8] mt-1">
                  <span>Scope</span>
                  <span className="text-[#38bdf8] font-mono text-[11px]">
                    drive.file
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 border-t border-[#232732] text-[11px] font-mono text-[#64748b]">
            <p>PostgreSQL • Connected</p>
          </div>
        </aside>

        {/* Center Catalog Workspace (Fluid Width) */}
        <section className="flex-1 flex flex-col bg-[#0d0e11] overflow-y-auto">
          {/* Action Bar */}
          <div className="h-12 px-6 border-b border-[#232732] flex items-center justify-between bg-[#12141a]/40">
            <div>
              <h2 className="text-sm font-semibold text-white">
                All Documents
              </h2>
              <p className="text-[11px] text-[#64748b]">
                Indexed with metadata and attached notes
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
                        className={`relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
                          uploadFile
                            ? "border-[#38bdf8] bg-[#38bdf8]/5"
                            : "border-[#2e3442] bg-[#181b22] hover:bg-[#232732] hover:border-[#64748b]"
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          {uploadFile ? (
                            <>
                              <FileText className="w-8 h-8 text-[#38bdf8] mb-2" />
                              <p className="text-sm font-semibold text-white truncate max-w-[300px]">
                                {uploadFile.name}
                              </p>
                              <p className="text-xs text-[#64748b] mt-1">
                                {formatBytes(uploadFile.size)}
                              </p>
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
                          onChange={(e) => setUploadFile(e.target.files[0])}
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
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="px-6 py-4 bg-[#181b22]/50 border-t border-[#232732] flex justify-end gap-3">
                    <button
                      onClick={() => {
                        setIsUploadModalOpen(false);
                        setUploadFile(null);
                        setUploadNote("");
                      }}
                      className="px-4 py-2 text-xs font-semibold text-[#94a3b8] hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpload}
                      disabled={isUploading || !uploadFile}
                      className="px-6 py-2 bg-[#38bdf8] hover:bg-[#7bd0ff] disabled:opacity-50 disabled:cursor-not-allowed text-[#00354a] font-semibold text-xs rounded-md transition-all shadow-sm flex items-center gap-2"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-[#00354a] border-t-transparent rounded-full animate-spin"></div>
                          Uploading...
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
                {files.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => setSelectedFile(file)}
                    className={`p-4 rounded-lg bg-[#12141a] border transition-all cursor-pointer ${
                      selectedFile?.id === file.id
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
                    {file.context_note && (
                      <div className="mt-3 p-2.5 rounded bg-[#181b22]/70 border border-[#2e3442]/50 text-xs">
                        <p className="text-[10px] font-mono uppercase text-[#38bdf8] mb-0.5">
                          Context Note
                        </p>
                        <p className="text-[#e3e2e6] text-[11px] line-clamp-2 italic">
                          "{file.context_note}"
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Right Contextual Inspector (340px fixed) */}
        <aside className="w-80 border-l border-[#232732] bg-[#12141a] flex flex-col justify-between flex-shrink-0 p-4">
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
              <div className="p-3 rounded-lg bg-[#181b22] border border-[#2e3442]">
                <p className="text-[10px] font-mono uppercase text-[#38bdf8] font-semibold mb-1">
                  Attached Context Note
                </p>
                <p className="text-xs text-[#e3e2e6] italic">
                  "{selectedFile.context_note}"
                </p>
              </div>

              {/* Technical Metadata */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-[#232732]">
                  <span className="text-[#64748b]">Storage Layer</span>
                  <span className="text-white font-mono text-[11px]">
                    Google Drive
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#232732]">
                  <span className="text-[#64748b]">Drive ID</span>
                  <span className="text-white font-mono text-[11px]">
                    {selectedFile.drive_file_id}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#232732]">
                  <span className="text-[#64748b]">File Size</span>
                  <span className="text-white font-mono text-[11px]">
                    {formatBytes(selectedFile.size_bytes)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#232732]">
                  <span className="text-[#64748b]">Uploaded</span>
                  <span className="text-white font-mono text-[11px]">
                    {new Date(selectedFile.created_at).toLocaleDateString()}   
                  </span>
                </div>
              </div>
              {/* Action Button */}
              <div className="pt-4">
                <a
                  href={`https://drive.google.com/file/d/${selectedFile.drive_file_id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-8 flex items-center justify-center gap-2 rounded bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20 border border-[#38bdf8]/30 text-[#38bdf8] text-xs font-semibold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Drive</span>
                </a>
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

          <div className="pt-3 border-t border-[#232732] text-[10px] font-mono text-[#64748b]">
            <span>Tri-Pane Layout • Kinetic Monolith</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
