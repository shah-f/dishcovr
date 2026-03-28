import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { parseMenuImageBytes } from "./menuParser.ts";
import { findPopularDishesFromFoursquare } from "./popularDishes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const parseMenuRequestSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(1),
});

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
    const { imageBase64, mimeType, filename } = parseMenuRequestSchema.parse(body);

    const items = await parseMenuImageBytes({
      bytes: Buffer.from(imageBase64, "base64"),
      mimeType,
    });

    sendJson(response, 200, {
      filename,
      items,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, {
        error: "Invalid request body.",
        details: error.flatten(),
      });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, {
        error: "Request body must be valid JSON.",
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown server error.";
    sendJson(response, 500, {
      error: message,
    });
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

    await serveStaticAsset(requestUrl.pathname, response);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = createAppServer();

  server.listen(port, host, () => {
    console.log(`Menu parser running at http://${host}:${port}`);
  });
}
