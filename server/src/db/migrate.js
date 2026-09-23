import fs from "fs";
import {pool} from "./index.js"
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the migration file:
const migrationPath = path.join(__dirname, "migrations", "001_init.sql");
const sql = fs.readFileSync(migrationPath, "utf8");


async function runMigrations() {
  // A. Checkout a single dedicated connection from our pool.
  // We need one dedicated connection so our BEGIN and COMMIT happen on the SAME socket.
  const client = await pool.connect();

  try{
    console.log("Running migration: 001_init.sql...");

    // B. Start a transaction.
  await client.query("BEGIN");

  // C. Execute the SQL.
  await client.query(sql);

  // D. If we get here → SUCCESS → commit.
  await client.query("COMMIT");
  console.log("✅ Migration completed succesfully! Tables created.");

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