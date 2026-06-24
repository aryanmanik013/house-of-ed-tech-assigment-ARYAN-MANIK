import { db } from "@/lib/db";
import { documentMembers, documents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type UserRole = "owner" | "editor" | "viewer";

export const ROLE_LEVELS: Record<UserRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export async function getUserRole(userId: string, documentId: string): Promise<UserRole | null> {
  try {
    // Direct owners always bypass membership checks
    const doc = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (doc.length > 0 && doc[0].ownerId === userId) {
      return "owner";
    }

    // Check permissions assigned via document sharing
    const member = await db
      .select()
      .from(documentMembers)
      .where(and(eq(documentMembers.documentId, documentId), eq(documentMembers.userId, userId)))
      .limit(1);

    if (member.length > 0) {
      return member[0].role as UserRole;
    }

    return null;
  } catch (error) {
    console.error("Error in getUserRole:", error);
    return null;
  }
}

export async function checkPermission(
  userId: string,
  documentId: string,
  minRole: UserRole
): Promise<boolean> {
  const role = await getUserRole(userId, documentId);
  if (!role) return false;

  return ROLE_LEVELS[role] >= ROLE_LEVELS[minRole];
}

export async function canView(userId: string, documentId: string): Promise<boolean> {
  return checkPermission(userId, documentId, "viewer");
}

export async function canEdit(userId: string, documentId: string): Promise<boolean> {
  return checkPermission(userId, documentId, "editor");
}

export async function canDelete(userId: string, documentId: string): Promise<boolean> {
  return checkPermission(userId, documentId, "owner");
}

export async function canManageMembers(userId: string, documentId: string): Promise<boolean> {
  return checkPermission(userId, documentId, "owner");
}
