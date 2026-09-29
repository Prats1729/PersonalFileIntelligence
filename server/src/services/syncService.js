// okay so first i think cron job must have some way to activcate this every 5 mins, so after that
// i need all the files in my database, and i need all the files in my drive,  and then
// i need to compare files in my db to the files in my drive
// if there is a fiel in my db but its not there in my drive then i need to remove it from my db
// also in the top bar we could add something like synced 5 mins ago instead of saying .Drive synced all the time

import cron from "node-cron";
import { pool } from "../db/index.js";
import { getDriveClient } from "./driveService.js";
import { deleteFileRecord } from "./fileService.js";

// "*/5 * * * *" is Cron Syntax for "Every 5 Minutes"
const runSync = async () => {
  console.log("🔄 Starting Background Sync...");

  try {
    // 1. Get ALL files from the database, PLUS the refresh token of the user who owns them.
    const { rows: dbFiles } = await pool.query(`
      SELECT files.*, users.google_refresh_token 
      FROM files 
      JOIN users ON files.user_id = users.id
    `);

    // 2. Loop through each file from the database
    for (const file of dbFiles) {
      try {
        // 3. Initialize the Google Drive client for this specific user
        const drive = getDriveClient(file.google_refresh_token);

        // 4. Ask Google Drive if this specific file still exists and if it is trashed
        const response = await drive.files.get({
          fileId: file.drive_file_id,
          fields: "trashed",
        });

        // 5. If it IS trashed, delete it from our database using deleteFileRecord!
        if (response.data.trashed) {
          console.log(
            `🗑️ File ${file.original_name} was trashed in Drive. Deleting from DB...`
          );
          await deleteFileRecord(file.user_id, file.id); // Fixed arguments!
        }
      } catch (err) {
        // If Google returns a 404 (Not Found), it means the user permanently deleted it!
        if (err.status === 404) {
          console.log(
            `❌ File ${file.original_name} missing from Drive. Deleting from DB...`,
          );
          await deleteFileRecord(file.user_id, file.id); // Fixed arguments!
        } else {
          console.error(`Error checking file ${file.id}:`, err.message);
        }
      }
    }

    console.log("✅ Background Sync Complete!");
  } catch (error) {
    console.error("Critical Sync Error:", error);
  }
};

// "*/5 * * * *" is Cron Syntax for "Every 5 Minutes"
export const startSyncJob = () => {
  console.log("⏰ Scheduling Background Sync Job (Runs every 5 minutes)");
  
  // Run it immediately once on startup so we don't have to wait 5 minutes!
  runSync();

  // Then schedule it to run every 5 minutes
  cron.schedule("*/5 * * * *", runSync);
};
