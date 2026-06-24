import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { documents, documentMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

// GET /api/documents: Get all documents where the current user is owner or member
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 1. Fetch documents where user is the owner
    const ownedDocs = await db.select().from(documents).where(eq(documents.ownerId, userId));

    // 2. Fetch documents where user is a member
    const memberDocs = await db
      .select({
        id: documents.id,
        title: documents.title,
        content: documents.content,
        version: documents.version,
        lastSyncedVersion: documents.lastSyncedVersion,
        lastSyncedAt: documents.lastSyncedAt,
        updatedAt: documents.updatedAt,
        ownerId: documents.ownerId,
      })
      .from(documents)
      .innerJoin(documentMembers, eq(documents.id, documentMembers.documentId))
      .where(eq(documentMembers.userId, userId));

    // Deduplicate documents using a Map
    const docsMap = new Map<string, any>();
    ownedDocs.forEach((doc) => docsMap.set(doc.id, { ...doc, role: "owner" }));
    memberDocs.forEach((doc) => {
      if (!docsMap.has(doc.id)) {
        docsMap.set(doc.id, { ...doc, role: "member" });
      }
    });

    const docList = Array.from(docsMap.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return NextResponse.json(docList);
  } catch (error) {
    console.error("GET documents error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/documents: Create a new document
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { title, content } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const docId = crypto.randomUUID();
    const now = new Date();

    // Create the document
    await db.insert(documents).values({
      id: docId,
      title,
      content: content || "",
      version: 1,
      lastSyncedVersion: 1,
      lastSyncedAt: now,
      updatedAt: now,
      ownerId: userId,
      lastClientId: "server-creation",
    });

    // Automatically make the creator a member with "owner" role
    await db.insert(documentMembers).values({
      id: crypto.randomUUID(),
      documentId: docId,
      userId,
      role: "owner",
      createdAt: now,
    });

    return NextResponse.json({ success: true, documentId: docId });
  } catch (error) {
    console.error("POST document error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
