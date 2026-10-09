import pg from "pg";
import dotenv from "dotenv";
import dns from "node:dns";

// Ensure IPv4 lookup precedence and fallback DNS servers on Windows
dns.setDefaultResultOrder("ipv4first");
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {}

dotenv.config();

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";
const isCloudDb =
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL.includes("sslmode=require");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction || isCloudDb ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

// Prevent unhandled errors on idle clients from crashing process
pool.on("error", (err) => {
  console.error("⚠️ Unexpected error on idle database client:", err.message);
});

// Helper query function with auto-retry for serverless Neon DB wakeups
export const query = async (text, params) => {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const isConnectionError =
      err.code === "ECONNRESET" ||
      err.code === "57P01" ||
      err.message?.includes("Connection terminated") ||
      err.message?.includes("timeout") ||
      err.message?.includes("closed");

    if (isConnectionError) {
      console.warn("⚠️ Database connection suspended or dropped. Retrying query...", err.message);
      await new Promise((r) => setTimeout(r, 1000));
      return await pool.query(text, params);
    }
    throw err;
  }
};

