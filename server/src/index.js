import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { logger, httpLogger } from "./utils/logger.js";
import { checkDbHealth, closePool, query } from "./db/index.js";
import { startSyncJob, stopSyncJob } from "./services/syncService.js";
import { startSummarySweepJob, stopSummarySweepJob } from "./services/summaryService.js";
import { startOcrWorkerJob, stopOcrWorkerJob } from "./services/pdfPipelineService.js";
import authRoutes from "./routes/authRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import { errorHandler, notFoundHandler, AppError } from "./middleware/errorHandler.js";

const app = express();

// 1. Trust Proxy Configuration
if (env.TRUST_PROXY) {
  app.set("trust proxy", 1);
}

// 2. HTTP Security Headers (Helmet)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: env.isProduction ? undefined : false,
  })
);

// 3. Strict CORS Allow-list
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  })
);

// 4. Structured Request Logging with Sensitive Redaction
app.use(httpLogger);

// 5. Body Parsers with Strict Size Limits
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

// 6. Request Timeout Guard (60s default)
app.use((req, res, next) => {
  req.setTimeout(60000, () => {
    const err = new AppError("Request timeout on server", 408, "REQUEST_TIMEOUT");
    next(err);
  });
  next();
});

// 7. Health & Readiness Probes (Kubernetes & Cloud Run ready)
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "alive", timestamp: new Date().toISOString() });
});

app.get("/readyz", async (req, res) => {
  try {
    const isHealthy = await checkDbHealth();
    if (isHealthy) {
      return res.status(200).json({ status: "ready", db: "connected" });
    }
    return res.status(503).json({ status: "unavailable", db: "disconnected" });
  } catch (error) {
    logger.warn({ err: error.message }, "Readiness probe failed");
    return res.status(503).json({ status: "unavailable", error: "Database unreachable" });
  }
});

// Backward-compatible health route
app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "healthy", db: "awake", timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: "error", message: "DB sleep timeout or error" });
  }
});

// 8. Mount Domain API Routes
app.use("/api/auth", authRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/settings", settingsRoutes);

// 9. 404 & Centralized Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

// 10. Start Background Jobs & Startup Sweeps
startSyncJob();
startSummarySweepJob();
startOcrWorkerJob();

// 11. Start HTTP Server
const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, clientUrl: env.CLIENT_URL, env: env.NODE_ENV },
    `Server listening on http://localhost:${env.PORT}`
  );
});

// 12. Graceful Shutdown & Unhandled Process Error Handlers
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, `Received ${signal}. Initiating graceful shutdown...`);

  // Stop accepting new requests & stop scheduled background cron
  stopSyncJob();
  stopSummarySweepJob();
  stopOcrWorkerJob();

  server.close(async () => {
    logger.info("HTTP server closed. Draining database connection pool...");
    try {
      await closePool();
      logger.info("Graceful shutdown completed successfully. Exiting process.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during database pool shutdown");
      process.exit(1);
    }
  });

  // Force shutdown after 10s if connections refuse to close
  setTimeout(() => {
    logger.error("Shutdown timed out after 10 seconds. Forcing process exit.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught Exception detected in process");
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled Promise Rejection detected in process");
});
