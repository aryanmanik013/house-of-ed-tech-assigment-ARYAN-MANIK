import { useEffect, useState, useCallback, useRef } from "react";
import { localDb } from "@/lib/dexie/db";
import { useOnlineStatus } from "./use-online-status";
import { useLiveQuery } from "dexie-react-hooks";
import { api } from "@/lib/axios";
import { getPusherClient } from "@/lib/pusher/client";
import { useSession } from "next-auth/react";

export function useSync(documentId: string) {
  const isOnline = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<number | null>(null);
  const [activeMembers, setActiveMembers] = useState<{ userId: string; name: string; email: string; isOnline: boolean; isTyping: boolean }[]>([]);
  const [pusherConnected, setPusherConnected] = useState(false);

  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  // Keep refs handy to prevent useEffect closures from using stale state
  const isOnlineRef = useRef(isOnline);
  const isSyncingRef = useRef(false);
  
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  // Watch Dexie for unsynced client operations so the UI shows current pending counts
  const pendingOperations = useLiveQuery(
    async () => {
      if (!localDb) return [];
      return await localDb.pendingOperations
        .where("documentId")
        .equals(documentId)
        .sortBy("timestamp");
    },
    [documentId]
  );

  const pendingCount = pendingOperations?.length || 0;

  // Keep track of network transitions (e.g. from offline subway ride to office WiFi online)
  const prevOnlineRef = useRef(isOnline);

  const sync = useCallback(async () => {
    console.log(`[useSync] sync triggered for doc: ${documentId}`, {
      isOnline: isOnlineRef.current,
      isSyncing: isSyncingRef.current
    });
    if (!isOnlineRef.current || isSyncingRef.current || !localDb) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    try {
      // Grab the local IndexedDB state
      const localDoc = await localDb.documents.get(documentId);
      const currentVersion = localDoc ? localDoc.version : 0;

      // Grab all the unsynced ops in chronological order
      const ops = await localDb.pendingOperations
        .where("documentId")
        .equals(documentId)
        .sortBy("timestamp");

      console.log(`[useSync] payload: version ${currentVersion}, pendingOps: ${ops.length}`);

      // Push changes to server
      const response = await api.post("/api/sync", {
        documentId,
        currentVersion,
        operations: ops,
      });

      const data = response.data;
      console.log(`[useSync] response received:`, data);

      if (data.success && data.document) {
        const sDoc = data.document;

        // Atomic write: merge server results into Dexie and clear matching pending queue entries
        await localDb.transaction("rw", [localDb.documents, localDb.pendingOperations, localDb.syncMetadata], async () => {
          // Put the winning server copy in our client cache
          await localDb.documents.put({
            id: documentId,
            title: sDoc.title,
            content: sDoc.content,
            version: sDoc.version,
            lastSyncedVersion: sDoc.lastSyncedVersion,
            lastSyncedAt: new Date(sDoc.lastSyncedAt).getTime(),
            updatedAt: new Date(sDoc.updatedAt).getTime(),
          });

          // Clean up operations that the server successfully acknowledged
          const appliedIds = data.appliedOpIds || [];
          if (appliedIds.length > 0) {
            await localDb.pendingOperations.bulkDelete(appliedIds);
          }

          // Record sync completion time
          await localDb.syncMetadata.put({
            documentId,
            lastSyncedAt: Date.now(),
          });
        });

        setLastSyncedTime(Date.now());
        if (data.activeMembers) {
          setActiveMembers(data.activeMembers);
        }
        console.log(`[useSync] local IndexedDB successfully updated with server state.`);
      }
    } catch (err: any) {
      console.error("[useSync] Sync execution failed:", err);
      let errMsg = "An unknown sync error occurred.";
      if (err.response) {
        if (err.response.status === 413) {
          errMsg = "Payload size exceeds 1MB limit.";
        } else {
          errMsg = err.response.data?.error || errMsg;
        }
      } else {
        errMsg = err.message || errMsg;
      }
      setSyncError(errMsg);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [documentId]);

  // Listen to live Pusher events for real-time multiplayer updates
  useEffect(() => {
    if (!isOnline) {
      setPusherConnected(false);
      return;
    }

    const pusher = getPusherClient();
    if (!pusher) {
      setPusherConnected(false);
      return;
    }

    const handleStateChange = (state: any) => {
      setPusherConnected(state.current === "connected");
    };

    pusher.connection.bind("state_change", handleStateChange);
    setPusherConnected(pusher.connection.state === "connected");

    const channelName = `document-${documentId}`;
    const channel = pusher.subscribe(channelName);

    channel.bind("document-updated", (data: { version?: number; senderId?: string }) => {
      console.log("[useSync] Pusher document-updated event received:", data);
      if (data.senderId !== currentUserId) {
        sync();
      }
    });

    channel.bind("member-typing", (data: { userId: string; name: string; email: string; isTyping: boolean }) => {
      console.log("[useSync] Pusher member-typing event received:", data);
      if (data.userId !== currentUserId) {
        setActiveMembers((prev) => {
          const index = prev.findIndex((m) => m.userId === data.userId);
          if (index > -1) {
            return prev.map((m, i) =>
              i === index ? { ...m, isOnline: true, isTyping: data.isTyping } : m
            );
          } else {
            return [
              ...prev,
              {
                userId: data.userId,
                name: data.name,
                email: data.email,
                isOnline: true,
                isTyping: data.isTyping,
              },
            ];
          }
        });
      }
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(channelName);
      pusher.connection.unbind("state_change", handleStateChange);
    };
  }, [documentId, isOnline, currentUserId, sync]);

  // Network recovery trigger + fallback adaptive polling
  useEffect(() => {
    // Reconnected! Sync immediately instead of waiting for next poll
    if (isOnline && !prevOnlineRef.current) {
      console.log("[useSync] Network restored. Triggering immediate sync.");
      sync();
    }
    prevOnlineRef.current = isOnline;

    if (!isOnline) return;

    // Adaptive polling: poll less if socket is live, more aggressively if offline/fallback mode
    let pollDelay = 30000;
    if (!pusherConnected) {
      const hasCollaborators = activeMembers.length > 1;
      pollDelay = hasCollaborators ? 5000 : 20000;
    }
    
    console.log(`[useSync] Registering background fallback polling (Pusher connected: ${pusherConnected}): ${pollDelay}ms`);

    const interval = setInterval(() => {
      sync();
    }, pollDelay);

    return () => clearInterval(interval);
  }, [isOnline, sync, activeMembers.length, pusherConnected]);

  // Kick off initial sync when the user opens the document
  useEffect(() => {
    if (isOnlineRef.current) {
      console.log("[useSync] Document opened. Triggering initial load sync.");
      sync();
    }
    if (localDb) {
      localDb.syncMetadata.get(documentId).then((meta) => {
        if (meta) {
          setLastSyncedTime(meta.lastSyncedAt);
        }
      });
    }
  }, [documentId, sync]);

  // TODO(aryan): We could optimize this by debouncing typing triggers on the client
  const sendTypingStatus = useCallback(
    async (isTyping: boolean) => {
      if (!isOnlineRef.current) return;
      try {
        await api.post("/api/sync", {
          documentId,
          typing: isTyping,
        });
      } catch (err) {
        console.error("[useSync] Failed to send typing status:", err);
      }
    },
    [documentId]
  );

  return {
    isOnline,
    isSyncing,
    syncError,
    lastSyncedTime,
    pendingCount,
    triggerSync: sync,
    activeMembers,
    sendTypingStatus,
  };
}
