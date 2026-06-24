export interface ServerDocumentState {
  content: string;
  version: number;
  updatedAt: Date | number;
  lastClientId: string;
}

export interface ClientOperation {
  content: string;
  version: number;
  timestamp: number; // ms timestamp
  clientId: string;
}

/**
 * Deterministic Last Write Wins (LWW) conflict resolver.
 * Priority:
 * 1. Higher version wins.
 * 2. Newer timestamp (updatedAt) wins.
 * 3. Client ID (alphabetical tie-breaker) wins.
 * 
 * Returns true if the client operation wins and should be applied, false otherwise.
 */
export function shouldApplyClientOperation(
  serverState: ServerDocumentState,
  clientOp: ClientOperation
): boolean {
  // Check versions first. Higher version is the ultimate winner.
  if (clientOp.version > serverState.version) {
    return true;
  }
  if (clientOp.version < serverState.version) {
    return false;
  }

  // If versions are equal, fallback to LWW timestamp comparison.
  const serverTime = serverState.updatedAt instanceof Date 
    ? serverState.updatedAt.getTime() 
    : serverState.updatedAt;
    
  if (clientOp.timestamp > serverTime) {
    return true;
  }
  if (clientOp.timestamp < serverTime) {
    return false;
  }

  // Absolute fallback: alphabetical client ID comparison to ensure deterministic results.
  return clientOp.clientId.localeCompare(serverState.lastClientId) > 0;
}
