import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Cache the connection pool in dev to prevent hot reloads from draining PostgreSQL connections
const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

let pool: Pool;

const connectionString = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production") {
  pool = new Pool({
    connectionString,
    // Enable SSL for Neon DB connections
    ssl: connectionString?.includes("neon.tech") ? { rejectUnauthorized: false } : false,
  });
} else {
  if (!globalForDb.pool) {
    globalForDb.pool = new Pool({
      connectionString: connectionString || "postgresql://postgres:postgres@localhost:5432/localsync",
      ssl: connectionString?.includes("neon.tech") ? { rejectUnauthorized: false } : false,
    });
  }
  pool = globalForDb.pool;
}

export const db = drizzle(pool, { schema });
