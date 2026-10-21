import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query, closePool } from "./index.js";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/**
 * Executes all pending SQL migration files in deterministic sequence.
 */
export async function runMigrations(targetSchema = "public") {
  logger.info({ schema: targetSchema }, "Checking database migrations...");

  if (targetSchema !== "public") {
    await query(`CREATE SCHEMA IF NOT EXISTS ${targetSchema};`);
  }

  // Ensure tracking table exists in target schema
  await query(`
    CREATE TABLE IF NOT EXISTS ${targetSchema}.schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const { rows: appliedRows } = await query(
    `SELECT name FROM ${targetSchema}.schema_migrations ORDER BY id ASC;`
  );
  const appliedSet = new Set(appliedRows.map((r) => r.name));

  const allFiles = await fs.readdir(MIGRATIONS_DIR);
  const migrationFiles = allFiles
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let executedCount = 0;

  for (const file of migrationFiles) {
    if (appliedSet.has(file)) {
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await fs.readFile(filePath, "utf-8");

    logger.info({ migration: file }, `Applying migration: ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      await client.query(`SET LOCAL search_path TO ${targetSchema};`);
      await client.query(sql);
      await client.query(
        `INSERT INTO ${targetSchema}.schema_migrations (name) VALUES ($1);`,
        [file]
      );
      await client.query("COMMIT;");
      logger.info({ migration: file }, `Successfully applied: ${file}`);
      executedCount++;
    } catch (err) {
      await client.query("ROLLBACK;");
      logger.error({ migration: file, err: err.message }, `Migration failed: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  if (executedCount === 0) {
    logger.info("All database migrations are up to date.");
  } else {
    logger.info(`Applied ${executedCount} pending migration(s).`);
  }

  return executedCount;
}

// Allow direct CLI invocation: `node src/db/migrate.js`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Migration runner failed:", err);
      await closePool();
      process.exit(1);
    });
}