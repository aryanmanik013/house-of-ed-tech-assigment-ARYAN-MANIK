import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { documentMembers, users, documents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { canView, canManageMembers } from "@/lib/permissions";
import crypto from "crypto";

// GET /api/documents/[id]/members: Get all members of a document
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

    // Retrieve members and user details
    const membersList = await db
      .select({
        id: documentMembers.id,
        role: documentMembers.role,
        userId: users.id,
        email: users.email,
        name: users.name,
      })
      .from(documentMembers)
      .innerJoin(users, eq(documentMembers.userId, users.id))
      .where(eq(documentMembers.documentId, documentId));

    return NextResponse.json(membersList);
  } catch (error) {
    console.error("GET members error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/documents/[id]/members: Invite, update, or remove a member
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

    // Verify manage permission (Owner only)
    const allowed = await canManageMembers(userId, documentId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden: Only owners can manage members" }, { status: 403 });
    }

    const body = await request.json();
    const { email, role } = body; // role: 'editor' | 'viewer' | 'remove'

    if (!email || !role) {
      return NextResponse.json({ error: "Email and role are required" }, { status: 400 });
    }

    // Find the user by email
    const userResult = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (userResult.length === 0) {
      return NextResponse.json({ error: "No registered user found with this email" }, { status: 404 });
    }

    const targetUser = userResult[0];

    // Check if the document exists
    const docResult = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (docResult.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const doc = docResult[0];

    // Check if target user is the owner
    if (doc.ownerId === targetUser.id) {
      return NextResponse.json({ error: "Cannot modify permissions of the document owner" }, { status: 400 });
    }

    if (role === "remove") {
      // Remove member
      await db
        .delete(documentMembers)
        .where(
          and(
            eq(documentMembers.documentId, documentId),
            eq(documentMembers.userId, targetUser.id)
          )
        );
      return NextResponse.json({ success: true, message: "Member removed successfully" });
    }

    if (role !== "editor" && role !== "viewer") {
      return NextResponse.json({ error: "Invalid role value" }, { status: 400 });
    }

    // Check if already a member
    const existingMember = await db
      .select()
      .from(documentMembers)
      .where(
        and(
          eq(documentMembers.documentId, documentId),
          eq(documentMembers.userId, targetUser.id)
        )
      )
      .limit(1);

    if (existingMember.length > 0) {
      // Update role
      await db
        .update(documentMembers)
        .set({ role })
        .where(
          and(
            eq(documentMembers.documentId, documentId),
            eq(documentMembers.userId, targetUser.id)
          )
        );
    } else {
      // Add member
      await db.insert(documentMembers).values({
        id: crypto.randomUUID(),
        documentId,
        userId: targetUser.id,
        role,
        createdAt: new Date(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST members error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
