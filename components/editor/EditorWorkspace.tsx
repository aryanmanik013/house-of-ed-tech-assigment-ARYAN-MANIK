"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "@/lib/dexie/db";
import { useSync } from "@/hooks/use-sync";
import { api } from "@/lib/axios";
import {
  FileText,
  Wifi,
  WifiOff,
  Loader2,
  Share2,
  History,
  Sparkles,
  ArrowLeft,
  UserPlus,
  RefreshCw,
  Clock,
  Check,
  ChevronRight,
  User,
  Trash2,
} from "lucide-react";
import Link from "next/link";

interface EditorWorkspaceProps {
  documentId: string;
}

export default function EditorWorkspace({ documentId }: EditorWorkspaceProps) {
  const router = useRouter();
  const { data: session, status } = useSession();

  // Local React Editor State
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [version, setVersion] = useState(1);
  const [lastSyncedContent, setLastSyncedContent] = useState("");
  const [userRole, setUserRole] = useState<"owner" | "editor" | "viewer">("viewer");

  // Panel & UI state
  const [members, setMembers] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // AI Toolbar state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiAction, setAiAction] = useState<string | null>(null);

  // Sync state hook
  const {
    isOnline,
    isSyncing,
    syncError,
    lastSyncedTime,
    pendingCount,
    triggerSync,
    activeMembers,
    sendTypingStatus,
  } = useSync(documentId);

  // Reference to track debounced sync timer
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // References to track client typing status
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const registerTyping = () => {
    if (userRole === "viewer") return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendTypingStatus(true);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      sendTypingStatus(false);
    }, 1500);
  };

  // Stable Client ID for LWW deterministic resolving
  const [myClientId] = useState(() => {
    if (typeof window !== "undefined") {
      let cid = localStorage.getItem("localsync_client_id");
      if (!cid) {
        cid = "client-" + Math.random().toString(36).slice(2, 9);
        localStorage.setItem("localsync_client_id", cid);
      }
      return cid;
    }
    return "client-ssr";
  });

  // Query Dexie reactive document
  const dexieDoc = useLiveQuery(
    async () => {
      if (!localDb) return null;
      return await localDb.documents.get(documentId);
    },
    [documentId]
  );

  // Fetch initial document details, members, versions & evaluate role
  const fetchMetadata = async () => {
    if (status !== "authenticated" || !session?.user?.id) return;
    try {
      // 1. Fetch members list to check role & collaboration using Axios
      const mRes = await api.get(`/api/documents/${documentId}/members`);
      const mList = mRes.data;
      setMembers(mList);

      // Determine current user's role
      const currentMember = mList.find((m: any) => m.userId === session.user.id);
      if (currentMember) {
        setUserRole(currentMember.role);
      }

      // 2. Fetch versions timeline using Axios
      const vRes = await api.get(`/api/documents/${documentId}/versions`);
      const vList = vRes.data;
      setVersions(vList);

      // 3. Fetch current server document directly to verify using Axios
      const docRes = await api.get(`/api/documents/${documentId}`);
      const docInfo = docRes.data;
      if (session.user.id === docInfo.ownerId) {
        setUserRole("owner");
      }

      // If local Dexie doesn't have it yet, populate it
      if (localDb) {
        const lDoc = await localDb.documents.get(documentId);
        if (!lDoc || docInfo.version > lDoc.version) {
          await localDb.documents.put({
            id: documentId,
            title: docInfo.title,
            content: docInfo.content,
            version: docInfo.version,
            lastSyncedVersion: docInfo.lastSyncedVersion,
            lastSyncedAt: new Date(docInfo.lastSyncedAt).getTime(),
            updatedAt: new Date(docInfo.updatedAt).getTime(),
          });
          setLastSyncedContent(docInfo.content);
        }
      }
    } catch (err) {
      console.error("Error loading document metadata:", err);
    }
  };

  // Sync React state from local Dexie doc
  useEffect(() => {
    if (!dexieDoc) {
      console.log("[EditorWorkspace] dexieDoc is not yet loaded");
      return;
    }

    const hasUnsavedChanges = syncTimeoutRef.current !== null;
    console.log("[EditorWorkspace] evaluating state sync from Dexie:", {
      dexieVersion: dexieDoc.version,
      localVersion: version,
      titleIsEmpty: title === "",
      hasUnsavedChanges
    });

    // Update react state only if not actively typing and version changes or initial load
    if (!hasUnsavedChanges && (dexieDoc.version !== version || title === "")) {
      console.log("[EditorWorkspace] updating React state to match Dexie content:", {
        title: dexieDoc.title,
        version: dexieDoc.version
      });
      setTitle(dexieDoc.title);
      setContent(dexieDoc.content);
      setVersion(dexieDoc.version);
      if (dexieDoc.lastSyncedVersion > 0) {
        setLastSyncedContent(dexieDoc.content);
      }
    }
  }, [dexieDoc, version, title]);

  // Handle initialization on session load
  useEffect(() => {
    if (status === "authenticated") {
      fetchMetadata();
    }
  }, [status, documentId]);

  // Immediate write to Dexie and operation logging
  const saveToDexie = async (newTitle: string, newContent: string) => {
    if (!localDb || userRole === "viewer") return;

    try {
      const lDoc = await localDb.documents.get(documentId);
      const currentVer = lDoc ? lDoc.version : 1;
      const nextVer = currentVer + 1;
      const now = Date.now();

      // Write updated doc to local Dexie immediately
      await localDb.documents.put({
        id: documentId,
        title: newTitle,
        content: newContent,
        version: nextVer,
        lastSyncedVersion: lDoc ? lDoc.lastSyncedVersion : 1,
        lastSyncedAt: lDoc ? lDoc.lastSyncedAt : now,
        updatedAt: now,
      });

      // Log pending operation immediately
      await localDb.pendingOperations.put({
        id: crypto.randomUUID(),
        documentId,
        content: newContent,
        version: nextVer,
        timestamp: now,
        clientId: myClientId,
      });

      setVersion(nextVer);
    } catch (err) {
      console.error("Error writing local Dexie save:", err);
    }
  };

  const handleTitleChange = (val: string) => {
    if (userRole === "viewer") return;
    setTitle(val);

    // Save to Dexie immediately
    saveToDexie(val, content);

    // Track typing status
    registerTyping();

    // Debounce the remote sync trigger
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      if (isOnline) {
        triggerSync();
        // Also notify server of title update via PATCH using Axios
        api.patch(`/api/documents/${documentId}`, { title: val }).then(() => fetchMetadata());
      }
    }, 400);
  };

  const handleContentChange = (val: string) => {
    if (userRole === "viewer") return;
    setContent(val);

    // Save to Dexie immediately
    saveToDexie(title, val);

    // Track typing status
    registerTyping();

    // Debounce the remote sync trigger
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      if (isOnline) {
        triggerSync();
      }
    }, 400);
  };

  // Member Management (POST /api/documents/[id]/members) using Axios
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== "owner") return;
    setInviteLoading(true);
    setInviteError(null);

    try {
      const response = await api.post(`/api/documents/${documentId}/members`, {
        email: inviteEmail,
        role: inviteRole,
      });

      setInviteEmail("");
      fetchMetadata(); // Refresh members list
    } catch (err: any) {
      setInviteError(err.response?.data?.error || err.message || "Failed to invite user");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleUpdateRole = async (email: string, role: string) => {
    if (userRole !== "owner") return;
    try {
      await api.post(`/api/documents/${documentId}/members`, { email, role });
      fetchMetadata();
    } catch (err) {
      console.error("Update role failed:", err);
    }
  };

  // Version Snapshots (POST /api/documents/[id]/versions) using Axios
  const handleCreateSnapshot = async () => {
    if (userRole === "viewer") return;
    setAiLoading(true);
    try {
      await api.post(`/api/documents/${documentId}/versions`, { action: "create" });
      fetchMetadata();
    } catch (err: any) {
      console.error("Create snapshot error:", err);
      alert(err.response?.data?.error || "Snapshot failed");
    } finally {
      setAiLoading(false);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (userRole !== "owner") return;
    if (!confirm("Are you sure you want to restore this version? This will create a new version active snapshot.")) return;
    
    setAiLoading(true);
    try {
      const response = await api.post(`/api/documents/${documentId}/versions`, {
        action: "restore",
        versionId,
      });
      const data = response.data;

      // Update local Dexie with restored content immediately
      if (localDb) {
        const now = Date.now();
        await localDb.documents.put({
          id: documentId,
          title,
          content: content, // The page will pull updated dexie reactive values
          version: data.version,
          lastSyncedVersion: data.version,
          lastSyncedAt: now,
          updatedAt: now,
        });
      }
      await fetchMetadata();
      alert("Version restored successfully!");
    } catch (err) {
      console.error("Restore version error:", err);
    } finally {
      setAiLoading(false);
    }
  };

  // AI Actions dispatcher (POST /api/ai) using Axios
  const handleAIAction = async (action: string) => {
    setAiLoading(true);
    setAiResult(null);
    setAiAction(action);

    try {
      const payload: any = { action };
      if (action === "change-summary") {
        payload.oldContent = lastSyncedContent;
        payload.newContent = content;
      } else {
        payload.content = content;
      }

      const response = await api.post("/api/ai", payload);
      const data = response.data;

      setAiResult(data.result);
    } catch (err: any) {
      setAiResult(`AI Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAITitle = (suggested: string) => {
    if (!suggested || suggested.startsWith("AI Error")) return;
    handleTitleChange(suggested);
    setAiResult(null);
  };

  const handleApplyAIContent = (suggested: string) => {
    if (!suggested || suggested.startsWith("AI Error")) return;
    // Strip mock headers if exists
    let cleanVal = suggested;
    if (suggested.includes("[Mock AI Improved Writing]")) {
      cleanVal = suggested.split("---")[0].trim();
    }
    handleContentChange(cleanVal);
    setAiResult(null);
  };

  // format sync relative time
  const getSyncTimeStr = () => {
    if (!lastSyncedTime) return "never";
    const secAgo = Math.floor((Date.now() - lastSyncedTime) / 1000);
    if (secAgo < 10) return "just now";
    if (secAgo < 60) return `${secAgo} seconds ago`;
    const minAgo = Math.floor(secAgo / 60);
    return `${minAgo} minute${minAgo > 1 ? "s" : ""} ago`;
  };

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 font-sans overflow-hidden">
      {/* Workspace Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-150 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm font-semibold tracking-tight">Workspace</span>
        </div>

        {/* Sync Status UX Indicator */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {isOnline ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-amber-500" />
            )}
            <span className="font-medium">{isOnline ? "Online" : "Offline"}</span>
            <span>•</span>
            <span>
              {pendingCount > 0 ? `${pendingCount} Pending Changes` : "Synced"}
            </span>
            <span>•</span>
            <span className="text-xs text-zinc-400">
              Last synced: {getSyncTimeStr()}
            </span>
            {isSyncing && (
              <RefreshCw className="h-3 w-3 animate-spin text-zinc-400 ml-1" />
            )}
          </div>

          <span className="rounded-full px-2 py-0.5 text-xs uppercase font-semibold border bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
            Role: {userRole}
          </span>
        </div>
      </header>

      {/* Editor & Sidebars Container */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* LEFT PANEL: AI Toolbar */}
        <aside className="w-80 shrink-0 border-r border-zinc-150 bg-zinc-50/50 p-6 overflow-y-auto dark:border-zinc-800 dark:bg-zinc-900/10 flex flex-col gap-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-4 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-purple-500" />
              AI Assistant
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleAIAction("summarize")}
                disabled={aiLoading || !content}
                className="rounded-lg border border-zinc-200 bg-white p-2.5 text-center text-xs font-medium text-zinc-700 hover:text-white hover:bg-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-950 dark:hover:bg-zinc-100 cursor-pointer transition-colors duration-200"
              >
                Summarize
              </button>
              <button
                onClick={() => handleAIAction("improve")}
                disabled={aiLoading || !content || userRole === "viewer"}
                className="rounded-lg border border-zinc-200 bg-white p-2.5 text-center text-xs font-medium text-zinc-700 hover:text-white hover:bg-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-950 dark:hover:bg-zinc-100 cursor-pointer transition-colors duration-200"
              >
                Improve Style
              </button>
              <button
                onClick={() => handleAIAction("title")}
                disabled={aiLoading || !content || userRole === "viewer"}
                className="rounded-lg border border-zinc-200 bg-white p-2.5 text-center text-xs font-medium text-zinc-700 hover:text-white hover:bg-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-950 dark:hover:bg-zinc-100 cursor-pointer transition-colors duration-200"
              >
                Gen Title
              </button>
              <button
                onClick={() => handleAIAction("change-summary")}
                disabled={aiLoading}
                className="rounded-lg border border-zinc-200 bg-white p-2.5 text-center text-xs font-medium text-zinc-700 hover:text-white hover:bg-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-950 dark:hover:bg-zinc-100 cursor-pointer transition-colors duration-200"
                title="Explain Changes between current editor state and last synced server copy"
              >
                Explain Sync
              </button>
            </div>
          </div>

          {/* AI Result Card */}
          {(aiLoading || aiResult) && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3 border-b border-zinc-100 pb-2 dark:border-zinc-800">
                <span className="text-xs font-semibold text-zinc-500">
                  {aiAction === "summarize" && "Summary"}
                  {aiAction === "improve" && "Grammar Improvement"}
                  {aiAction === "title" && "Suggested Title"}
                  {aiAction === "change-summary" && "Explain Sync Changes"}
                </span>
                {aiLoading && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
              </div>

              <div className="flex-1 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {aiResult || "Analyzing content and generating response..."}
              </div>

              {aiResult && !aiLoading && (
                <div className="mt-4 flex gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  {aiAction === "title" && (
                    <button
                      onClick={() => handleApplyAITitle(aiResult)}
                      className="w-full rounded-md bg-zinc-950 py-1.5 text-center text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
                    >
                      Apply Title
                    </button>
                  )}
                  {aiAction === "improve" && (
                    <button
                      onClick={() => handleApplyAIContent(aiResult)}
                      className="w-full rounded-md bg-zinc-950 py-1.5 text-center text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
                    >
                      Insert in Document
                    </button>
                  )}
                  <button
                    onClick={() => setAiResult(null)}
                    className="w-full rounded-md border border-zinc-200 bg-white py-1.5 text-center text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* MIDDLE: Textarea Editor & Credits Footer */}
        <main className="flex-1 flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-16 py-12 flex flex-col gap-6">
            <input
              type="text"
              value={title}
              disabled={userRole === "viewer"}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Untitled Document"
              className="text-4xl font-semibold tracking-tight border-none outline-none focus:ring-0 placeholder-zinc-200 bg-transparent text-zinc-900 dark:text-zinc-50 w-full"
            />

            {(() => {
              const typingUser = activeMembers.find(
                (m) => m.userId !== session?.user?.id && m.isTyping
              );
              return typingUser ? (
                <div className="text-sm text-purple-500 font-medium italic animate-pulse -mt-4">
                  {typingUser.name || typingUser.email} is typing...
                </div>
              ) : null;
            })()}

            <textarea
              value={content}
              disabled={userRole === "viewer"}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={userRole === "viewer" ? "You only have read-only access to this document." : "Start typing offline or online..."}
              className="flex-1 w-full border-none outline-none resize-none focus:ring-0 placeholder-zinc-300 bg-transparent text-sm leading-relaxed text-zinc-850 dark:text-zinc-200 min-h-[400px]"
            />
          </div>

          {/* Credits Assignment Footer */}
          <footer className="h-10 shrink-0 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between px-8 text-xs text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/10">
            <div>
              Developed by <span className="font-semibold text-zinc-600 dark:text-zinc-300">Aryan Manik</span>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/aryanmanik013"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-600 dark:hover:text-zinc-300 underline"
              >
                GitHub
              </a>
              <a
                href="https://linkedin.com/in/aryanmanik"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-600 dark:hover:text-zinc-300 underline"
              >
                LinkedIn
              </a>
            </div>
          </footer>
        </main>

        {/* RIGHT PANEL: Collaboration & Version Timeline */}
        <aside className="w-96 shrink-0 border-l border-zinc-150 bg-zinc-50/50 p-6 overflow-y-auto dark:border-zinc-800 dark:bg-zinc-900/10 flex flex-col gap-8">
          {/* Section: Sharing and Collaboration */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-4 flex items-center gap-1.5">
              <Share2 className="h-3.5 w-3.5" />
              Collaboration
            </h3>

            {/* Invite Form (Owner only) */}
            {userRole === "owner" && (
              <form onSubmit={handleInvite} className="mb-4 space-y-2">
                <input
                  type="email"
                  required
                  placeholder="collaborator@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs placeholder-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
                />
                <div className="flex gap-2">
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="submit"
                    disabled={inviteLoading}
                    className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 cursor-pointer"
                  >
                    Invite
                  </button>
                </div>
                {inviteError && <p className="text-xs text-red-500 mt-1">{inviteError}</p>}
              </form>
            )}

            {/* Members list */}
            <div className="space-y-3 max-h-56 overflow-y-auto">
              {members.map((member) => {
                const active = activeMembers.find((m) => m.userId === member.userId);
                const isUserOnline = active?.isOnline || member.userId === session?.user?.id;
                const isUserTyping = active?.isTyping;

                return (
                  <div key={member.id} className="flex flex-col gap-2 bg-white dark:bg-zinc-900 p-3 rounded-lg border border-zinc-150 dark:border-zinc-800 text-xs">
                    <div className="flex items-center justify-between w-full min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-zinc-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-900 dark:text-zinc-50 truncate flex items-center gap-1.5">
                            {member.name || member.email}
                            {isUserOnline && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Online" />
                            )}
                          </p>
                        </div>
                      </div>

                      {userRole === "owner" && member.role !== "owner" ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <select
                            value={member.role}
                            onChange={(e) => handleUpdateRole(member.email, e.target.value)}
                            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                          <button
                            onClick={() => handleUpdateRole(member.email, "remove")}
                            className="rounded p-0.5 text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
                            title="Remove user"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs capitalize text-zinc-400 px-2 py-0.5 bg-zinc-50 dark:bg-zinc-950 rounded-full border border-zinc-100 dark:border-zinc-850">
                          {member.role}
                        </span>
                      )}
                    </div>

                    {/* Email/Typing status on the second line */}
                    <div className="pl-10 text-xs text-zinc-400 truncate">
                      {isUserTyping ? (
                        <span className="text-purple-500 font-medium animate-pulse">Typing...</span>
                      ) : (
                        member.email
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section: Version History timeline */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                History Timeline
              </h3>
              {userRole !== "viewer" && (
                <button
                  onClick={handleCreateSnapshot}
                  className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:underline cursor-pointer"
                >
                  Create Snapshot
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {versions.length === 0 ? (
                <p className="text-xs text-zinc-400 italic">No snapshots saved yet.</p>
              ) : (
                versions.map((ver) => {
                  const vDate = new Date(ver.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <div key={ver.id} className="relative bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-lg p-3 text-xs flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                          Version {ver.version}
                        </span>
                        <span className="text-xs text-zinc-400">{vDate}</span>
                      </div>
                      <p className="text-xs text-zinc-500 truncate italic">
                        "{ver.content.slice(0, 80) || "Empty document content..."}"
                      </p>
                      <div className="flex flex-col gap-1.5 mt-1 text-xs text-zinc-400 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                        <span className="truncate">By: {ver.creatorName || ver.creatorEmail}</span>
                        {userRole === "owner" && (
                          <div className="flex justify-end mt-1">
                            <button
                              onClick={() => handleRestoreVersion(ver.id)}
                              className="font-bold text-zinc-700 dark:text-zinc-200 hover:underline cursor-pointer"
                            >
                              Restore Version
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
