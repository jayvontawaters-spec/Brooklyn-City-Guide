import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

/**
 * Public chat quota: 10 POST requests per IP per fixed 60-second window.
 * The map is capped and expired windows are pruned to bound in-memory state.
 */
const CHAT_REQUEST_LIMIT = 10;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_CHAT_IPS = 10_000;
const chatRequestWindows = new Map<
  string,
  { startedAt: number; requestCount: number }
>();
let lastChatWindowPruneAt = 0;

function limitChatRequestsByIp(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const now = Date.now();

  if (now - lastChatWindowPruneAt >= CHAT_RATE_WINDOW_MS) {
    for (const [ip, window] of chatRequestWindows) {
      if (now - window.startedAt >= CHAT_RATE_WINDOW_MS) {
        chatRequestWindows.delete(ip);
      }
    }
    lastChatWindowPruneAt = now;
  }

  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  let window = chatRequestWindows.get(clientIp);

  if (!window || now - window.startedAt >= CHAT_RATE_WINDOW_MS) {
    if (!window && chatRequestWindows.size >= MAX_TRACKED_CHAT_IPS) {
      const oldestIp = chatRequestWindows.keys().next().value;
      if (oldestIp !== undefined) chatRequestWindows.delete(oldestIp);
    }

    window = { startedAt: now, requestCount: 0 };
    chatRequestWindows.set(clientIp, window);
  }

  if (window.requestCount >= CHAT_REQUEST_LIMIT) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((window.startedAt + CHAT_RATE_WINDOW_MS - now) / 1000),
    );
    res.set("Retry-After", String(retryAfterSeconds)).status(429).json({
      error: "You’ve sent too many messages. Please try again in a minute.",
    });
    return;
  }

  window.requestCount += 1;
  next();
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Trust the single ingress hop so req.ip identifies the visitor behind it.
app.set("trust proxy", 1);
app.post("/api/chat", limitChatRequestsByIp);
app.use("/api", router);
app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      res.status(413).json({
        error: "This upload is too large. Choose a photo under 3 MB.",
      });
      return;
    }
    next(error);
  },
);

export default app;
