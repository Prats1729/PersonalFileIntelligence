import pg from "pg";
import dns from "node:dns";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// Ensure IPv4 lookup precedence on Windows / container runtimes
dns.setDefaultResultOrder("ipv4first");

const { Pool } = pg;

const isCloudDb =
  env.DATABASE_URL && env.DATABASE_URL.includes("sslmode=require");

let activeSchema = null;

/**
 * Sets the active schema for query isolation (e.g. during test runs).
 */
export function setActiveSchema(schemaName) {
  activeSchema = schemaName;
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.isProduction || isCloudDb ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
  allowExitOnIdle: true,
  statement_timeout: 30000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected error on idle database pool client");
});

/**
 * Query helper with auto-retry specifically tuned for Neon serverless resume
 * and schema isolation support.
 */
export const query = async (text, params) => {
  const execute = async () => {
    if (activeSchema) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${activeSchema}, public;`);
        return await client.query(text, params);
      } finally {
        client.release();
      }
    }
    return await pool.query(text, params);
  };

  try {
    return await execute();
  } catch (err) {
    const isConnectionError =
      err.code === "ECONNRESET" ||
      err.code === "ENOTFOUND" ||
      err.code === "57P01" ||
      err.message?.includes("getaddrinfo") ||
      err.message?.includes("Connection terminated") ||
      err.message?.includes("timeout") ||
      err.message?.includes("closed");

    if (isConnectionError) {
      logger.warn(
        { err: err.message },
        "Database connection dropped or Neon asleep. Retrying query..."
      );
      await new Promise((r) => setTimeout(r, 1000));
      return await execute();
    }
    throw err;
  }
};

/**
 * Probes the database to confirm health and active connectivity.
 */
export async function checkDbHealth() {
  const result = await pool.query("SELECT 1 AS healthy");
  return result.rows[0]?.healthy === 1;
}

/**
 * Closes the connection pool gracefully on server shutdown.
 */
export async function closePool() {
  logger.info("Closing database connection pool...");
  await pool.end();
  logger.info("Database connection pool closed.");
}
