"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "@/lib/dexie/db";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { FileText, Plus, LogOut, Wifi, WifiOff, Loader2 } from "lucide-react";
import { api } from "@/lib/axios";

interface DashboardClientProps {
  session: {
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
    };
  };
}

export default function DashboardClient({ session }: DashboardClientProps) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [isCreating, setIsCreating] = useState(false);
  const [serverDocsLoading, setServerDocsLoading] = useState(false);

  // Query local documents from Dexie reactively
  const localDocs = useLiveQuery(
    async () => {
      if (!localDb) return [];
      return await localDb.documents.toArray();
    },
    []
  );

  // Sync documents list from server on mount / online status
  useEffect(() => {
    if (!isOnline || !session) return;

    const fetchServerDocs = async () => {
      setServerDocsLoading(true);
      try {
        const response = await api.get("/api/documents");
        const serverDocs = response.data;
        // Merge server docs into local Dexie cache
        if (localDb && Array.isArray(serverDocs)) {
          await localDb.transaction("rw", localDb.documents, async () => {
            for (const sDoc of serverDocs) {
              const localDoc = await localDb.documents.get(sDoc.id);
              // If local doc doesn't exist or server has higher version, update local
              if (!localDoc || sDoc.version > localDoc.version) {
                await localDb.documents.put({
                  id: sDoc.id,
                  title: sDoc.title,
                  content: sDoc.content,
                  version: sDoc.version,
                  lastSyncedVersion: sDoc.lastSyncedVersion,
                  lastSyncedAt: new Date(sDoc.lastSyncedAt).getTime(),
                  updatedAt: new Date(sDoc.updatedAt).getTime(),
                });
              }
            }
          });
        }
      } catch (err) {
        console.error("Error fetching server documents:", err);
      } finally {
        setServerDocsLoading(false);
      }
    };

    fetchServerDocs();
  }, [isOnline, session]);

  const handleCreateDocument = async () => {
    if (isCreating) return;
    setIsCreating(true);

    const title = "Untitled Document";
    const now = Date.now();

    if (isOnline) {
      // 1. Online: create on server first, then redirect
      try {
        const response = await api.post("/api/documents", { title, content: "" });
        const data = response.data;
        // Write to local Dexie immediately
        if (localDb) {
          await localDb.documents.put({
            id: data.documentId,
            title,
            content: "",
            version: 1,
            lastSyncedVersion: 1,
            lastSyncedAt: now,
            updatedAt: now,
          });
          router.push(`/documents/${data.documentId}`);
        }
      } catch (err) {
        console.error("Online creation failed, falling back to offline creation:", err);
        createOffline();
      }
    } else {
      // 2. Offline: create locally in Dexie, queue pending operation, and redirect
      createOffline();
    }
  };

  const createOffline = async () => {
    if (!localDb) return;
    const offlineId = crypto.randomUUID();
    const now = Date.now();

    try {
      // Put document in Dexie
      await localDb.documents.put({
        id: offlineId,
        title: "Untitled Document (Offline)",
        content: "",
        version: 1,
        lastSyncedVersion: 0, // 0 indicates never synced
        lastSyncedAt: 0,
        updatedAt: now,
      });

      // Queue pending operation
      await localDb.pendingOperations.put({
        id: crypto.randomUUID(),
        documentId: offlineId,
        content: "",
        version: 1,
        timestamp: now,
        clientId: "offline-client-" + Math.random().toString(36).slice(2, 9),
      });

      router.push(`/documents/${offlineId}`);
    } catch (err) {
      console.error("Offline creation failed:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const documentsList = localDocs || [];

  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-100 bg-white/85 px-8 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight">LocalSync Docs</span>
          <div className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {isOnline ? (
              <>
                <Wifi className="h-3 w-3 text-emerald-500" />
                <span>Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-amber-500" />
                <span>Offline mode</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
            <p className="font-medium text-zinc-800 dark:text-zinc-200">{session.user?.name || "User"}</p>
            <p className="text-xs">{session.user?.email}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 transition-colors cursor-pointer"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-8 py-12 max-w-4xl mx-auto w-full">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Your Documents</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Create and manage local-first collaborative documents
            </p>
          </div>

          <button
            onClick={handleCreateDocument}
            disabled={isCreating}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New Document
          </button>
        </div>

        {/* Documents Grid / List */}
        {documentsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10">
            <FileText className="h-10 w-10 text-zinc-300 dark:text-zinc-700 mb-4" />
            <p className="font-medium text-zinc-700 dark:text-zinc-300">No documents yet</p>
            <p className="text-xs text-zinc-500 mt-1 mb-4">Create your first document to get started</p>
            <button
              onClick={handleCreateDocument}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Create Document
            </button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900">
            {documentsList.map((doc) => {
              const formattedDate = new Date(doc.updatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={doc.id}
                  onClick={() => router.push(`/documents/${doc.id}`)}
                  className="group flex items-center justify-between px-6 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-2 text-zinc-500 group-hover:border-zinc-300 group-hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:group-hover:border-zinc-700 dark:group-hover:text-zinc-50 transition-colors">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-medium text-zinc-900 dark:text-zinc-50 group-hover:underline decoration-zinc-400">
                        {doc.title}
                      </h2>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>Version {doc.version}</span>
                        <span>•</span>
                        <span>Last updated {formattedDate}</span>
                        {doc.lastSyncedVersion === 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-500 text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/30">Unsynced</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right text-xs text-zinc-400">
                    <span className="rounded-full border border-zinc-150 px-2.5 py-0.5 text-xs font-medium bg-zinc-50 group-hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 transition-colors">
                      Open
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
