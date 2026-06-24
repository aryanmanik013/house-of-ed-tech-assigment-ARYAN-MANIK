import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { documentVersions, documents, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { canView, canEdit, checkPermission } from "@/lib/permissions";
import crypto from "crypto";

// GET /api/documents/[id]/versions: Retrieve the version history timeline
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const { id: documentId } = params;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Verify view permission
    const allowed = await canView(userId, documentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch versions joined with creator user details
    const versions = await db
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        content: documentVersions.content,
        createdAt: documentVersions.createdAt,
        creatorEmail: users.email,
        creatorName: users.name,
      })
      .from(documentVersions)
      .leftJoin(users, eq(documentVersions.createdBy, users.id))
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version));

    return NextResponse.json(versions);
  } catch (error) {
    console.error("GET versions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/documents/[id]/versions: Create a new version snapshot OR restore an older snapshot
export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const { id: documentId } = params;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { action, versionId } = body; // action: 'create' | 'restore'

    if (action === "restore") {
      // 1. Restore snapshot (Owner only)
      const isOwner = await checkPermission(userId, documentId, "owner");
      if (!isOwner) {
        return NextResponse.json(
          { error: "Forbidden: Only owners can restore versions" },
          { status: 403 }
        );
      }

      if (!versionId) {
        return NextResponse.json({ error: "versionId is required for restore" }, { status: 400 });
      }

      // Fetch target snapshot
      const snapshotResult = await db
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, documentId)
          )
        )
        .limit(1);

      if (snapshotResult.length === 0) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }

      const snapshot = snapshotResult[0];

      // Fetch main document
      const docResult = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);

      if (docResult.length === 0) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }

      const doc = docResult[0];
      const nextVersion = doc.version + 1;
      const now = new Date();

      // Update main document state to restored content and increment version
      await db
        .update(documents)
        .set({
          content: snapshot.content,
          version: nextVersion,
          updatedAt: now,
          lastClientId: "restored-version",
        })
        .where(eq(documents.id, documentId));

      // Save a new version snapshot for this restore event to preserve history
      const newSnapshotId = crypto.randomUUID();
      await db.insert(documentVersions).values({
        id: newSnapshotId,
        documentId,
        content: snapshot.content,
        version: nextVersion,
        createdBy: userId,
        createdAt: now,
      });

      return NextResponse.json({
        success: true,
        message: "Version restored successfully",
        version: nextVersion,
      });
    } else {
      // 2. Create manual snapshot (Editor or Owner)
      const isEditor = await canEdit(userId, documentId);
      if (!isEditor) {
        return NextResponse.json(
          { error: "Forbidden: Edit access required to create snapshots" },
          { status: 403 }
        );
      }

      // Fetch main document
      const docResult = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);

      if (docResult.length === 0) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }

      const doc = docResult[0];

      // Check if snapshot for this exact version already exists
      const existingSnapshot = await db
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.version, doc.version)
          )
        )
        .limit(1);

      if (existingSnapshot.length > 0) {
        return NextResponse.json(
          { error: `A snapshot for version ${doc.version} already exists` },
          { status: 400 }
        );
      }

      // Create new snapshot
      const snapshotId = crypto.randomUUID();
      await db.insert(documentVersions).values({
        id: snapshotId,
        documentId,
        content: doc.content,
        version: doc.version,
        createdBy: userId,
        createdAt: new Date(),
      });

      return NextResponse.json({ success: true, versionId: snapshotId });
    }
  } catch (error) {
    console.error("POST versions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
