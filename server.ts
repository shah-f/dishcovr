import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { cartSpeechRequestSchema, generateCartSpeech } from "./cartSpeech.ts";
import { findDishImages } from "./dishImages.ts";
import { parseMenuImageBytes } from "./menuParser.ts";
import { findPopularDishesFromFoursquare } from "./popularDishes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 3000);

const singleParseMenuRequestSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(1),
});

const parseMenuRequestSchema = z.union([
  singleParseMenuRequestSchema,
  z.object({
    images: z.array(singleParseMenuRequestSchema).min(1),
  }),
]);

const popularDishesRequestSchema = z.object({
  restaurantName: z.string().min(1),
  near: z.string().min(1).optional(),
  ll: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(),
  menuItems: z.array(z.object({
    nameOriginal: z.string().min(1),
    nameEnglish: z.string().nullable().optional(),
    price: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })).min(1),
});

const dishImagesRequestSchema = z.object({
  items: z.array(z.object({
    nameOriginal: z.string().min(1),
    nameEnglish: z.string().nullable().optional(),
    price: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })).min(1),
});

const dishInfoRequestSchema = z.object({
  nameOriginal: z.string().min(1),
  nameEnglish: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY.");
  }
  return apiKey;
}

async function createGeminiClient() {
  const { GoogleGenAI, Type } = await import("@google/genai");
  return {
    Type,
    ai: new GoogleGenAI({ apiKey: getGeminiApiKey() }),
  };
}

const DISH_INFO_PROMPT = `
You are a knowledgeable food writer providing a concise, engaging deep-dive on a single restaurant dish.

You will receive:
- nameOriginal: the dish name as shown on the menu
- nameEnglish: an English translation if available (may be prefixed with "Translated: ")
- price: the listed price, or null
- description: the menu description, or null

Return a JSON object with exactly these fields:
- origin: one or two sentences on the dish's culinary or cultural background. If unknown, return null.
- preparation: one or two sentences on how the dish is typically made or cooked.
- flavorProfile: a short phrase or sentence describing the taste and texture (e.g. "Rich and savory with a crispy exterior").
- variations: an array of 1–3 short strings naming common variants or serving styles. Return an empty array if none are relevant.
- pairingTips: one sentence suggesting what the dish pairs well with (drinks, sides, etc). Return null if nothing useful to say.
- funFact: one short, interesting sentence about the dish. Return null if nothing notable.

Rules:
- Be factual and grounded. Do not invent specific ingredients unless they are well-established for this dish.
- Keep each field concise — this is supplementary info, not an essay.
- If the dish name is too ambiguous to say anything reliable, return null for every field except preparation (give a generic note).
- Return JSON only.
`.trim();

export type DishInfo = {
  origin: string | null;
  preparation: string | null;
  flavorProfile: string | null;
  variations: string[];
  pairingTips: string | null;
  funFact: string | null;
};

async function generateDishInfo(
  dish: z.infer<typeof dishInfoRequestSchema>,
): Promise<DishInfo> {
  const { ai, Type } = await createGeminiClient();

  const englishName = dish.nameEnglish?.replace(/^Translated:\s*/i, "") ?? null;
  const displayName = englishName ?? dish.nameOriginal;

  const prompt = `${DISH_INFO_PROMPT}

Dish:
${JSON.stringify({
    nameOriginal: dish.nameOriginal,
    nameEnglish: displayName,
    price: dish.price ?? null,
    description: dish.description ?? null,
  }, null, 2)}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ text: prompt }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          origin: { type: Type.STRING, nullable: true },
          preparation: { type: Type.STRING, nullable: true },
          flavorProfile: { type: Type.STRING, nullable: true },
          variations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          pairingTips: { type: Type.STRING, nullable: true },
          funFact: { type: Type.STRING, nullable: true },
        },
        required: ["origin", "preparation", "flavorProfile", "variations", "pairingTips", "funFact"],
        propertyOrdering: ["origin", "preparation", "flavorProfile", "variations", "pairingTips", "funFact"],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const parsed = JSON.parse(text);
  return parsed as DishInfo;
}

const staticContentTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function normalizeParseMenuUploads(body: unknown) {
  const parsedBody = parseMenuRequestSchema.parse(body);
  return "images" in parsedBody ? parsedBody.images : [parsedBody];
}

async function readJsonBody(
  request: import("node:http").IncomingMessage,
  maxBytes = 10 * 1024 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bufferChunk.length;

    if (size > maxBytes) {
      throw new Error("Request body is too large.");
    }

    chunks.push(bufferChunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawBody);
}

async function handleParseMenu(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const uploads = normalizeParseMenuUploads(body);
    const parsedImages = await Promise.all(uploads.map(async ({ imageBase64, mimeType, filename }) => {
      const items = await parseMenuImageBytes({
        bytes: Buffer.from(imageBase64, "base64"),
        mimeType,
      });

      return {
        filename,
        mimeType,
        itemCount: items.length,
        items,
      };
    }));
    const items = parsedImages.flatMap((parsedImage) => parsedImage.items);

    sendJson(response, 200, {
      filename: parsedImages.length === 1 ? parsedImages[0].filename : null,
      imageCount: parsedImages.length,
      images: parsedImages,
      items,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, { error: "Invalid request body.", details: error.flatten() });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Request body must be valid JSON." });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error.";
    sendJson(response, 500, { error: message });
  }
}

async function handleDishInfo(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const dish = dishInfoRequestSchema.parse(body);
    const info = await generateDishInfo(dish);

    sendJson(response, 200, info);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, { error: "Invalid request body.", details: error.flatten() });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Request body must be valid JSON." });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error.";
    sendJson(response, 500, { error: message });
  }
}

async function handlePopularDishes(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const parsedBody = popularDishesRequestSchema.parse(body);

    const result = await findPopularDishesFromFoursquare({
      restaurantName: parsedBody.restaurantName,
      near: parsedBody.near,
      ll: parsedBody.ll,
      menuItems: parsedBody.menuItems.map((menuItem) => ({
        nameOriginal: menuItem.nameOriginal,
        nameEnglish: menuItem.nameEnglish ?? null,
        price: menuItem.price ?? null,
        description: menuItem.description ?? null,
      })),
    });

    sendJson(response, 200, result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, {
        error: "Invalid request body.",
        details: error.flatten(),
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error.";
    sendJson(response, 500, {
      error: message,
    });
  }
}

async function handleDishImages(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const parsedBody = dishImagesRequestSchema.parse(body);
    const items = parsedBody.items.map((item) => ({
      nameOriginal: item.nameOriginal,
      nameEnglish: item.nameEnglish ?? null,
      price: item.price ?? null,
      description: item.description ?? null,
    }));
    const matches = await findDishImages(items);
    const sources = [...new Set(matches.map((match) => match.source).filter((source) => source !== "none"))];
    const sourceCounts = {
      wikimedia: matches.filter((match) => match.source === "wikimedia").length,
      pexels: matches.filter((match) => match.source === "pexels").length,
      none: matches.filter((match) => match.source === "none").length,
    };

    sendJson(response, 200, {
      provider: sources.length === 1 ? sources[0] : "mixed",
      itemCount: items.length,
      matchedCount: matches.filter((match) => match.image !== null).length,
      sourceCounts,
      items: matches,
      attribution: {
        text: "Images may come from Wikipedia or Pexels",
        url: "https://www.pexels.com",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, {
        error: "Invalid request body.",
        details: error.flatten(),
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error.";
    sendJson(response, 500, {
      error: message,
    });
  }
}

async function handleCartSpeech(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const parsedBody = cartSpeechRequestSchema.parse(body);
    const speech = await generateCartSpeech(parsedBody);

    sendJson(response, 200, speech);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, {
        error: "Invalid request body.",
        details: error.flatten(),
      });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Request body must be valid JSON." });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error.";
    sendJson(response, 500, { error: message });
  }
}

async function serveStaticAsset(
  requestPath: string,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const relativePath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = path.normalize(path.join(publicDir, relativePath));

  if (!resolvedPath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  try {
    const fileContents = await fs.readFile(resolvedPath);
    const extension = path.extname(resolvedPath);
    const contentType = staticContentTypes.get(extension) ?? "application/octet-stream";

    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    response.end(fileContents);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (requestUrl.pathname === "/api/parse-menu") {
      await handleParseMenu(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/popular-dishes") {
      await handlePopularDishes(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/dish-images") {
      await handleDishImages(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/dish-info") {
      await handleDishInfo(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/cart-speech") {
      await handleCartSpeech(request, response);
      return;
    }

    await serveStaticAsset(requestUrl.pathname, response);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = createAppServer();

  server.listen(port, host, () => {
    console.log(`Menu parser running at http://${host}:${port}`);
  });
}
