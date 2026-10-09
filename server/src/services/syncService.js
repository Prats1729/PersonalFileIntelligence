import cron from "node-cron";
import { pool } from "../db/index.js";
import { getDriveClient } from "./driveService.js";
import { deleteFileRecord } from "./fileService.js";

/**
 * Two-way sync for a single authenticated user:
 * 1. Discovers files/folders present in Google Drive but missing in DB -> imports them
 * 2. Discovers files present in DB but trashed/deleted in Google Drive -> prunes them
 */
export const syncSingleUser = async (user) => {
  if (!user.google_refresh_token) {
    return { importedCount: 0, prunedCount: 0 };
  }

  const drive = getDriveClient(user.google_refresh_token);

  // 1. Fetch all Drive folders in a single API call (O(1) network request)
  const folderRes = await drive.files.list({
    q: "trashed=false and mimeType='application/vnd.google-apps.folder'",
    fields: "files(id, name)",
    pageSize: 100,
  });
  const folderMap = new Map();
  (folderRes.data.files || []).forEach((f) => folderMap.set(f.id, f.name));

  // 2. Fetch all active files in Drive in a single API call
  const driveRes = await drive.files.list({
    q: "trashed=false and mimeType!='application/vnd.google-apps.folder'",
    fields: "files(id, name, mimeType, size, parents)",
    pageSize: 100,
  });
  const driveFiles = driveRes.data.files || [];

  // 3. Fetch all current files from DB for this user
  const dbRes = await pool.query(
    "SELECT id, drive_file_id, original_name FROM files WHERE user_id = $1",
    [user.id]
  );
  const dbDriveIdMap = new Map();
  dbRes.rows.forEach((f) => dbDriveIdMap.set(f.drive_file_id, f));

  let importedCount = 0;
  let prunedCount = 0;

  // 4. Forward Sync (Drive -> DB): Import any file in Drive that DB does not know about
  for (const df of driveFiles) {
    if (!dbDriveIdMap.has(df.id)) {
      // Determine folder name from parent ID, fallback to 'Others'
      const parentFolderId = df.parents && df.parents[0];
      const folderName = (parentFolderId && folderMap.get(parentFolderId)) || "Others";

      await pool.query(
        `INSERT INTO files (user_id, drive_file_id, original_name, mime_type, size_bytes, context_note, ai_result_folder)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          user.id,
          df.id,
          df.name,
          df.mimeType || "application/octet-stream",
          df.size || 0,
          null,
          folderName,
        ]
      );
      importedCount++;
      console.log(`📥 [Two-Way Sync] Imported "${df.name}" into folder "${folderName}"`);
    }
  }

  // 5. Reverse Sync (DB -> Drive): Prune any file in DB that no longer exists in Drive
  const activeDriveIds = new Set(driveFiles.map((df) => df.id));
  for (const dbf of dbRes.rows) {
    if (!activeDriveIds.has(dbf.drive_file_id)) {
      await deleteFileRecord(user.id, dbf.id);
      prunedCount++;
      console.log(`🗑️ [Two-Way Sync] Pruned missing/trashed file "${dbf.original_name}" from DB`);
    }
  }

  return { importedCount, prunedCount, totalDriveFiles: driveFiles.length, totalDbFiles: dbRes.rows.length + importedCount - prunedCount };
};

/**
 * On-demand sync for a specific user ID
 */
export const syncUserWithDrive = async (userId) => {
  const { rows: users } = await pool.query(
    "SELECT id, google_refresh_token FROM users WHERE id = $1 AND google_refresh_token IS NOT NULL",
    [userId]
  );
  if (users.length === 0) {
    return { importedCount: 0, prunedCount: 0 };
  }
  return await syncSingleUser(users[0]);
};

/**
 * Scheduled background sync for all active users
 */
export const runSync = async () => {
  console.log("🔄 Starting Scheduled Background Two-Way Sync...");
  try {
    const { rows: users } = await pool.query(
      "SELECT id, google_refresh_token FROM users WHERE google_refresh_token IS NOT NULL"
    );

    for (const user of users) {
      try {
        const stats = await syncSingleUser(user);
        if (stats.importedCount > 0 || stats.prunedCount > 0) {
          console.log(`✨ User ${user.id} synced: +${stats.importedCount} imported, -${stats.prunedCount} pruned`);
        }
      } catch (userErr) {
        console.error(`Error syncing user ${user.id}:`, userErr.message);
      }
    }
    console.log("✅ Scheduled Two-Way Sync Complete!");
  } catch (error) {
    console.error("Critical Sync Error:", error);
  }
};

/**
 * Initialize background cron job (Every 5 minutes)
 */
export const startSyncJob = () => {
  console.log("⏰ Scheduling Background Two-Way Sync Job (Runs every 5 minutes)");
  
  // Run initial sync after 5 seconds to let server and DB settle
  setTimeout(runSync, 5000);

  // Then schedule every 5 minutes
  cron.schedule("*/5 * * * *", runSync);
};
