import fs from "fs";
import {pool} from "./index.js"
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the migration directory:
const migrationsDir = path.join(__dirname, "migrations");
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

async function runMigrations() {
  const client = await pool.connect();

  try {
    // B. Start a transaction.
    await client.query("BEGIN");

    for (const file of files) {
      console.log(`Running migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
    }

    // D. If we get here → SUCCESS → commit.
    await client.query("COMMIT");
    console.log("✅ All migrations completed succesfully!");

  }catch (error){
    // if any error then undo changes
    await client.query("ROLLBACK");
    console.log("❌ Migration failed, transactions rolled back.");
    console.error("Error: ", error);
    process.exitCode = 1
  }finally {
    // Release the connection back to the pool
    client.release();
    await pool.end();
    console.log("Pool connection closed.");
  }
}

runMigrations();