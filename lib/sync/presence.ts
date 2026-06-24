interface ActiveUser {
  userId: string;
  name: string;
  email: string;
  lastSeen: number;
  isTyping: boolean;
}

// Global presence registry in memory
const presenceMap = new Map<string, ActiveUser>();

export function updatePresence(
  documentId: string,
  userId: string,
  name: string,
  email: string,
  isTyping: boolean
) {
  const key = `${documentId}-${userId}`;
  presenceMap.set(key, {
    userId,
    name,
    email,
    lastSeen: Date.now(),
    isTyping,
  });
}

export function getActiveMembers(documentId: string): { userId: string; name: string; email: string; isOnline: boolean; isTyping: boolean }[] {
  const now = Date.now();
  const active: { userId: string; name: string; email: string; isOnline: boolean; isTyping: boolean }[] = [];

  // Cleanup old entries (older than 10 seconds) to prevent memory growth
  for (const [key, user] of presenceMap.entries()) {
    if (now - user.lastSeen > 10000) {
      presenceMap.delete(key);
    } else if (key.startsWith(`${documentId}-`)) {
      // Consider online if seen within last 5 seconds
      const isOnline = now - user.lastSeen < 5000;
      // Consider typing if marked as typing and seen within last 3 seconds
      const isTyping = user.isTyping && now - user.lastSeen < 3000;

      if (isOnline) {
        active.push({
          userId: user.userId,
          name: user.name,
          email: user.email,
          isOnline,
          isTyping,
        });
      }
    }
  }

  return active;
}
