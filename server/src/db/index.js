import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";
const isCloudDb =
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL.includes("sslmode=require");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction || isCloudDb ? { rejectUnauthorized: false } : false,
});

// Helper query function for convenience
export const query = (text, params) => pool.query(text, params);
