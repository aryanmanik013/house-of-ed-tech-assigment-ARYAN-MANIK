import Dexie, { type Table } from "dexie";

export interface LocalDocument {
  id: string;
  title: string;
  content: string;
  version: number;
  lastSyncedVersion: number;
  lastSyncedAt: number; // timestamp
  updatedAt: number; // timestamp
}

export interface PendingOperation {
  id: string;
  documentId: string;
  content: string;
  version: number;
  timestamp: number; // timestamp
  clientId: string;
}

export interface SyncMetadata {
  documentId: string;
  lastSyncedAt: number;
}

export class LocalSyncDexie extends Dexie {
  documents!: Table<LocalDocument>;
  pendingOperations!: Table<PendingOperation>;
  syncMetadata!: Table<SyncMetadata>;

  constructor() {
    super("LocalSyncDatabase");
    this.version(1).stores({
      documents: "id, updatedAt",
      pendingOperations: "id, documentId, timestamp",
      syncMetadata: "documentId",
    });
  }
}

export const localDb = typeof window !== "undefined" ? new LocalSyncDexie() : null as unknown as LocalSyncDexie;
