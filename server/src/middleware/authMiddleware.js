import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  // 1. Extract session token from HTTP-only cookie
  const token = req.cookies.session_token;

  if (!token) {
    return res
      .status(401)
      .json({ error: "Authentication required. Please sign in." });
  }

  try {
    // 2. Cryptographically verify the token with our secret
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);

    // 3. Attach the authenticated user ID to the request object
    req.user = { id: decoded.userId };

    // 4. Pass control to the next handler
    next();
  } catch (error) {
    // Token expired, tampered with, or invalid
    return res
      .status(401)
      .json({ error: "Invalid or expired session. Please sign in again." });
  }
}
