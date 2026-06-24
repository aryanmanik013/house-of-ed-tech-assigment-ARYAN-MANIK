import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { documents, syncOperations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { canEdit } from "@/lib/permissions";
import { shouldApplyClientOperation, ClientOperation } from "@/lib/sync/conflict-resolver";
import crypto from "crypto";
import { updatePresence, getActiveMembers } from "@/lib/sync/presence";
import { pusherServer } from "@/lib/pusher/server";


export async function POST(request: Request) {
  try {
    // Guard against massive payloads to protect against DOS or disk bloat
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 1024 * 1024) {
      return NextResponse.json({ error: "Payload Too Large: Limit is 1MB" }, { status: 413 });
    }

    const bodyText = await request.text();
    if (Buffer.byteLength(bodyText) > 1024 * 1024) {
      return NextResponse.json({ error: "Payload Too Large: Limit is 1MB" }, { status: 413 });
    }

    // Quick auth check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Parse request safely
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const { documentId, operations, typing } = body as {
      documentId: string;
      operations?: ClientOperation[];
      typing?: boolean;
    };

    if (!documentId) {
      return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    }

    // Make sure this client actually has write permission
    const allowed = await canEdit(userId, documentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: Edit permission required to sync" }, { status: 403 });
    }

    // Typing-only requests: update presence and broadcast immediately, skipping database transaction
    if (typing !== undefined && (!operations || operations.length === 0)) {
      updatePresence(
        documentId,
        userId,
        session.user.name || "User",
        session.user.email || "",
        typing
      );

      if (pusherServer) {
        pusherServer
          .trigger(`document-${documentId}`, "member-typing", {
            userId,
            name: session.user.name || "User",
            email: session.user.email || "",
            isTyping: typing,
          })
          .catch((err) => console.error("Pusher trigger typing error:", err));
      }

      const activeMembers = getActiveMembers(documentId);
      return NextResponse.json({
        success: true,
        activeMembers,
      });
    }

    if (!Array.isArray(operations)) {
      return NextResponse.json({ error: "operations array is required" }, { status: 400 });
    }

    // User is sending operations, so they are definitely active/typing
    const isUserTyping = operations.length > 0;
    updatePresence(
      documentId,
      userId,
      session.user.name || "User",
      session.user.email || "",
      isUserTyping
    );

    if (pusherServer) {
      pusherServer
        .trigger(`document-${documentId}`, "member-typing", {
          userId,
          name: session.user.name || "User",
          email: session.user.email || "",
          isTyping: isUserTyping,
        })
        .catch((err) => console.error("Pusher trigger typing error:", err));
    }

    // Fetch DB state to see what we are comparing against
    const docResult = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (docResult.length === 0) {
      return NextResponse.json({ error: "Document not found on server" }, { status: 404 });
    }

    let doc = docResult[0];

    // Process each client operation in the order received
    const appliedOpIds: string[] = [];
    let currentContent = doc.content;
    let currentVersion = doc.version;
    let currentUpdatedAt = doc.updatedAt;
    let currentLastClientId = doc.lastClientId;
    let dirty = false;

    // Sort operations by client timestamp to ensure cron reconciliation order
    const sortedOps = [...operations].sort((a, b) => a.timestamp - b.timestamp);

    for (const op of sortedOps) {
      const serverState = {
        content: currentContent,
        version: currentVersion,
        updatedAt: currentUpdatedAt,
        lastClientId: currentLastClientId,
      };

      const wins = shouldApplyClientOperation(serverState, op);

      if (wins) {
        currentContent = op.content;
        // Bump the document version monotonically
        if (op.version > currentVersion) {
          currentVersion = op.version;
        } else if (op.version === currentVersion) {
          currentVersion = currentVersion + 1;
        }
        currentUpdatedAt = new Date(op.timestamp);
        currentLastClientId = op.clientId;
        dirty = true;

        // Log changes so we can show diff lists or roll back if needed
        await db.insert(syncOperations).values({
          id: crypto.randomUUID(),
          documentId,
          content: op.content,
          version: currentVersion,
          clientId: op.clientId,
          timestamp: new Date(op.timestamp),
          createdAt: new Date(),
        });
      }

      // Acknowledge this operation so the client knows it was processed (won or lost) and can purge it from its local Dexie queue.
      const anyOp = op as any;
      if (anyOp.id) {
        appliedOpIds.push(anyOp.id);
      }
    }

    // Persist new state if the client operations actually modified anything
    if (dirty) {
      const now = new Date();
      await db
        .update(documents)
        .set({
          content: currentContent,
          version: currentVersion,
          lastSyncedVersion: currentVersion,
          lastSyncedAt: now,
          updatedAt: currentUpdatedAt,
          lastClientId: currentLastClientId,
        })
        .where(eq(documents.id, documentId));

      // Reload document state so the client receives the exact server state
      const updatedDoc = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
      if (updatedDoc.length > 0) {
        doc = updatedDoc[0];
      }
    } else {
      // No changes won, but update lastSyncedAt so the client knows it is clean and synced
      await db
        .update(documents)
        .set({
          lastSyncedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      const updatedDoc = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
      if (updatedDoc.length > 0) {
        doc = updatedDoc[0];
      }
    }

    if (dirty && pusherServer) {
      pusherServer
        .trigger(`document-${documentId}`, "document-updated", {
          version: currentVersion,
          senderId: userId,
        })
        .catch((err) => console.error("Pusher trigger update error:", err));
    }

    // Include active workspace presence list in the payload
    const activeMembers = getActiveMembers(documentId);

    return NextResponse.json({
      success: true,
      document: {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        version: doc.version,
        lastSyncedVersion: doc.lastSyncedVersion,
        lastSyncedAt: doc.lastSyncedAt,
        updatedAt: doc.updatedAt,
        lastClientId: doc.lastClientId,
      },
      appliedOpIds,
      activeMembers,
    });
  } catch (error) {
    console.error("POST sync error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
