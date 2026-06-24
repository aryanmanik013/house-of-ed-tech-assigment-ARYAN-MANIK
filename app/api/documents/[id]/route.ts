import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { canView, canEdit, canDelete } from "@/lib/permissions";
import { pusherServer } from "@/lib/pusher/server";

// GET /api/documents/[id]: Fetch details of a single document
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

    // Check read permission
    const allowed = await canView(userId, documentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: Access denied" }, { status: 403 });
    }

    const docList = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (docList.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json(docList[0]);
  } catch (error) {
    console.error("GET document detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/documents/[id]: Update title (or other metadata) of a document
export async function PATCH(
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

    // Check edit permission
    const allowed = await canEdit(userId, documentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: Edit access denied" }, { status: 403 });
    }

    const body = await request.json();
    const { title } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Update document title and updatedAt
    await db
      .update(documents)
      .set({
        title,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    if (pusherServer) {
      pusherServer
        .trigger(`document-${documentId}`, "document-updated", {
          titleUpdated: true,
          senderId: userId,
        })
        .catch((err) => console.error("Pusher trigger title update error:", err));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH document error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/documents/[id]: Delete a document (Owner only)
export async function DELETE(
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

    // Check delete permission (owner only)
    const allowed = await canDelete(userId, documentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: Only owners can delete documents" }, { status: 403 });
    }

    // Delete the document
    await db.delete(documents).where(eq(documents.id, documentId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE document error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
