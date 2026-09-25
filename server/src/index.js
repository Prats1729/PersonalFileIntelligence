import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// 1. CORS Configuration
// Crucial: 'credentials: true' allows cookies to travel between frontend and backend
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  }),
);

// 2. Body and Cookie Parsers
app.use(express.json());
app.use(cookieParser());

// 3. Health Check Route
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

import fileRoutes from "./routes/fileRoutes.js";

// 4. Mount API Routes
app.use("/api/auth", authRoutes);
app.use("/api/files", fileRoutes);

// 5. Centralized Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// 6. Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Accepting client requests from ${CLIENT_URL}`);
});
