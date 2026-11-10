import { GoogleGenAI, type Content } from "@google/genai";
import {
  GetChatSystemPromptResponse,
  SendChatMessageBody,
  SendChatMessageResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { CITY_SYSTEM_PROMPT } from "../city";

const router: IRouter = Router();

const DEFAULT_SETTINGS = {
  temperature: 1,
  topP: 0.95,
  maxOutputTokens: 300,
} as const;

// Keep billable model work bounded even when requests come from many IPs.
const MAX_CONCURRENT_GEMINI_REQUESTS = 4;
let activeGeminiRequests = 0;

function isRetryableGeminiError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  return [429, 503, 504].includes(Number(error.status));
}

async function generateWithRetry<T>(generate: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await generate();
    } catch (error) {
      if (attempt === 1 || !isRetryableGeminiError(error)) {
        throw error;
      }

      // Briefly wait before retrying temporary rate-limit or availability errors.
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }

  throw new Error("Gemini request retry limit reached.");
}

router.get("/chat/system-prompt", (_req, res) => {
  res.json(GetChatSystemPromptResponse.parse({ systemPrompt: CITY_SYSTEM_PROMPT }));
});

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(
      { error: "Please check your message and Prompt Lab settings." },
    );
    return;
  }

  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    // Keep compatibility with the key name already configured in this Repl.
    process.env.GEMINI_APY_KEY?.trim();

  if (!apiKey) {
    res.status(503).json(
      { error: "Add a GEMINI_API_KEY secret in Replit Secrets to enable the city guide." },
    );
    return;
  }

  if (activeGeminiRequests >= MAX_CONCURRENT_GEMINI_REQUESTS) {
    res.set("Retry-After", "1").status(503).json({
      error: "The city guide is handling other messages. Please try again in a moment.",
    });
    return;
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...parsed.data.settings,
  };
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const history: Content[] = (parsed.data.history ?? []).map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  activeGeminiRequests += 1;
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 20_000,
        // Keep retries bounded here; generateWithRetry handles brief 429/503s.
        retryOptions: { attempts: 1 },
      },
    });
    const response = await generateWithRetry(() => ai.models.generateContent({
      model,
      contents: [
        ...history,
        { role: "user", parts: [{ text: parsed.data.message }] },
      ],
      config: {
        systemInstruction: CITY_SYSTEM_PROMPT,
        temperature: settings.temperature,
        topP: settings.topP,
        maxOutputTokens: settings.maxOutputTokens,
      },
    }));

    const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    const finishReason = String(response.candidates?.[0]?.finishReason ?? "")
      .toUpperCase();
    const truncated =
      finishReason === "MAX_TOKENS" || outputTokens >= settings.maxOutputTokens;

    res.json(
      SendChatMessageResponse.parse({
        reply:
          response.text?.trim() ||
          "I’m not sure about that one. Ask me something about Brooklyn and I’ll point you in the right direction.",
        usage: {
          promptTokens,
          outputTokens,
          totalTokens: response.usageMetadata?.totalTokenCount ?? promptTokens + outputTokens,
          truncated,
        },
        settings,
        model,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Gemini city guide request failed");
    const serviceUnavailable = isRetryableGeminiError(error);
    res.status(serviceUnavailable ? 503 : 502).json(
      {
        error: serviceUnavailable
          ? "The city guide is temporarily busy. Please try again in a moment."
          : "The city guide could not answer just now. Please try again.",
      },
    );
  } finally {
    activeGeminiRequests -= 1;
  }
});

export default router;
