import jwt from "jsonwebtoken";
import { oauth2Client, SCOPES } from "../config/google.js";
import {query} from "../db/index.js";

/**
 * 1. Generates the Google OAuth login URL that the user visits in their browser
 */
export function getGoogleAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: "offline", // Crucial: Requests a refresh_token so our backend can access Drive later
    scope: SCOPES,
    prompt: "select_account", // Lets the user pick which Google account to use, without re-asking consent every time
  });
}

/**
 * 2. Exchanges the temporary authorization code from Google for tokens,
 *    verifies the user's identity, and upserts them into PostgreSQL.
 */
export async function handleGoogleCallback(code) {
  // A. Exchange the code with Google for tokens
  const { tokens } = await oauth2Client.getToken(code);
  // B. Verify the ID Token with Google's public keys to extract user info securely
  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  const googleId = payload.sub; // Google's permanent unique user ID
  const email = payload.email;
  const name = payload.name;
  const avatarUrl = payload.picture;
  const refreshToken = tokens.refresh_token;
  // C. Upsert (Insert or Update) the user in PostgreSQL
  // Notice COALESCE($5, google_refresh_token):
  // If Google sent a new refresh token, we save it. If not, we keep the existing one!
  const sql = `
    INSERT INTO users (google_id, email, name, avatar_url, google_refresh_token)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (google_id) DO UPDATE SET
      name = EXCLUDED.name,
      avatar_url = EXCLUDED.avatar_url,
      google_refresh_token = COALESCE(EXCLUDED.google_refresh_token, users.google_refresh_token),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, google_id, email, name, avatar_url, created_at;
  `;
  const values = [googleId, email, name, avatarUrl, refreshToken || null];
  const result = await query(sql, values);
  return result.rows[0];
}

/**
 * 3. Creates our own application session JWT containing the user's database ID
 */
export function generateAppToken(userId) {
  return jwt.sign({ userId }, process.env.SESSION_SECRET, {
    expiresIn: "7d", // Session stays valid for 7 days
  });
}