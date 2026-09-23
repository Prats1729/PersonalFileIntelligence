import { Router } from "express";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  generateAppToken,
} from "../services/authService.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { query } from "../db/index.js";

const router = Router();

/**
 * 1. Start Google Login Flow
 * Redirects the user's browser to Google's OAuth consent page
 */
router.get("/google", (req, res) => {
  const url = getGoogleAuthUrl();
  res.redirect(url);
});

/**
 * 2. Google OAuth Callback
 * Google redirects back here with a one-time 'code' in the query parameters
 */
router.get("/google/callback", async (req, res) => {
  const { code, error } = req.query;
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

  // If user clicked "Cancel" on Google's consent screen
  if (error || !code) {
    console.error("Google Auth error or cancelled:", error);
    return res.redirect(
      `${clientUrl}?auth_error=${encodeURIComponent(error || "access_denied")}`,
    );
  }

  try {
    // Exchange the code for tokens and upsert user into PostgreSQL
    const user = await handleGoogleCallback(code);

    // Generate our internal 7-day session JWT
    const token = generateAppToken(user.id);

    // Set the token inside a secure, HTTP-only cookie
    res.cookie("session_token", token, {
      httpOnly: true, // Prevents client-side JS from reading the cookie (protects from XSS)
      secure: process.env.NODE_ENV === "production", // True in HTTPS production, false in local HTTP development
      sameSite: "lax", // Protects against CSRF while allowing navigation from Google
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    });

    // Send the user to the frontend dashboard!
    res.redirect(clientUrl);
  } catch (err) {
    console.error("Failed to complete Google authentication:", err.message);
    res.redirect(`${clientUrl}?auth_error=server_error`);
  }
});

/**
 * 3. Get Current Authenticated User Profile
 * The frontend calls this on page load to see if a session exists
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await query(
      "SELECT id, google_id, email, name, avatar_url, created_at FROM users WHERE id = $1",
      [req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Error fetching user profile:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 4. Logout
 * Clears the session cookie
 */
router.post("/logout", (req, res) => {
  res.clearCookie("session_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  res.json({ message: "Logged out successfully" });
});

export default router;
