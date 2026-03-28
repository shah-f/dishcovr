import { z } from "zod";

import type { ParsedMenuItem } from "./menuParser.ts";

export type DishImageSource = "wikimedia" | "pexels" | "none";

export type DishImageAsset = {
  id: number | string;
  alt: string | null;
  pageUrl: string;
  pexelsUrl: string | null;
  photographer: string | null;
  photographerUrl: string | null;
  avgColor: string | null;
  src: {
    tiny: string;
    small: string;
    medium: string;
    landscape: string;
    portrait: string;
  };
  attributionText: string;
  attributionLink: string;
};

export type DishImageMatch = {
  itemKey: string;
  searchQuery: string | null;
  source: DishImageSource;
  image: DishImageAsset | null;
};

type FetchLike = typeof fetch;

type SearchPexelsPhotoOptions = {
  apiKey?: string;
  userAgent?: string;
  fetchImpl?: FetchLike;
  planSearchQueries?: DishImageSearchPlanner;
  validateDishImage?: DishImageValidator;
};

type DishImageSearchContext = {
  baseName: string;
  description: string | null;
  queryTokens: string[];
  descriptionTokens: string[];
  categoryTokens: string[];
};

type DishImageSearchCandidate = {
  itemKey: string;
  nameOriginal: string;
  nameEnglish: string | null;
  description: string | null;
};

type DishImageSearchPlan = {
  itemKey: string;
  canonicalDishName: string | null;
  wikipediaQuery: string | null;
  pexelsQuery: string | null;
};

type DishImageSearchPlanner = (
  items: DishImageSearchCandidate[],
) => Promise<DishImageSearchPlan[]>;

type DishImageValidationInput = {
  asset: DishImageAsset;
  item: ParsedMenuItem;
  context: DishImageSearchContext;
  searchQuery: string;
};

type DishImageValidationResult = {
  isFoodDish: boolean;
  matchesDish: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type DishImageValidator = (
  input: DishImageValidationInput,
) => Promise<DishImageValidationResult | null>;

class WikimediaRateLimitError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "WikimediaRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

const pexelsSearchResponseSchema = z.object({
  photos: z.array(z.object({
    id: z.number(),
    url: z.string(),
    photographer: z.string(),
    photographer_url: z.string(),
    avg_color: z.string().nullable().optional(),
    alt: z.string().nullable().optional(),
    src: z.object({
      tiny: z.string(),
      small: z.string(),
      medium: z.string(),
      landscape: z.string(),
      portrait: z.string(),
    }),
  })),
});

const wikimediaSearchResponseSchema = z.object({
  pages: z.array(z.object({
    id: z.number().optional(),
    key: z.string(),
    title: z.string(),
    excerpt: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    matched_title: z.string().nullable().optional(),
    thumbnail: z.object({
      url: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
    }).nullable().optional(),
  })),
});

const wikimediaSummaryResponseSchema = z.object({
  title: z.string().optional(),
  displaytitle: z.string().optional(),
  thumbnail: z.object({
    source: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).nullable().optional(),
  originalimage: z.object({
    source: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).nullable().optional(),
});

const dishImageValidationResponseSchema = z.object({
  isFoodDish: z.boolean(),
  matchesDish: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

const GENERIC_DISH_PATTERNS = [
  /\bchef'?s?\s+special\b/i,
  /\bdaily\s+special\b/i,
  /\bhouse\s+special\b/i,
  /\bspecial\b/i,
  /\bcombo\b/i,
  /\bcombo\s*\d+\b/i,
  /\bplatter\b/i,
  /\bsampler\b/i,
  /\bmarket\s+price\b/i,
  /\bseasonal\b/i,
];

const GENERIC_WIKIMEDIA_TITLE_PATTERNS = [
  /^list of\b/i,
  /\bas food\b/i,
  /\bvegetable oils?\b/i,
  /\bcooking oils?\b/i,
  /\bfood preparation\b/i,
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "choice",
  "for",
  "fresh",
  "fried",
  "house",
  "in",
  "of",
  "on",
  "or",
  "served",
  "style",
  "the",
  "to",
  "with",
]);

const FOOD_CATEGORY_WORDS = new Set([
  "basil",
  "beef",
  "bread",
  "burger",
  "burrito",
  "cake",
  "calamari",
  "calamares",
  "chicken",
  "curry",
  "dessert",
  "dumpling",
  "dumplings",
  "fish",
  "fries",
  "ginger",
  "noodle",
  "noodles",
  "pasta",
  "pizza",
  "pork",
  "prawn",
  "prawns",
  "ramen",
  "rice",
  "salad",
  "sandwich",
  "seafood",
  "squid",
  "shrimp",
  "soup",
  "steak",
  "sushi",
  "taco",
  "thai",
  "vegetable",
  "vegetables",
]);

const FOOD_CUES = new Set([
  "appetizer",
  "bowl",
  "breakfast",
  "cooked",
  "cuisine",
  "dinner",
  "dish",
  "food",
  "lunch",
  "meal",
  "plate",
  "restaurant",
  "table",
  ...FOOD_CATEGORY_WORDS,
]);

const NON_FOOD_VISUAL_CUES = new Set([
  "camera",
  "chair",
  "fashion",
  "man",
  "men",
  "person",
  "people",
  "photographer",
  "portrait",
  "sitting",
  "standing",
  "street",
  "woman",
  "women",
]);

const pexelsSearchCache = new Map<string, Promise<DishImageAsset | null>>();
const wikimediaSearchCache = new Map<string, Promise<DishImageAsset | null>>();
const wikimediaSummaryCache = new Map<string, Promise<z.infer<typeof wikimediaSummaryResponseSchema> | null>>();
const dishImageValidationCache = new Map<string, Promise<DishImageValidationResult | null>>();
const DEFAULT_WIKIMEDIA_RETRY_AFTER_MS = 5 * 60 * 1000;
let wikimediaRateLimitedUntil = 0;

const DISH_IMAGE_QUERY_PLANNER_PROMPT = `
You help turn menu items into short image-search queries.

For each item, return:
- itemKey
- canonicalDishName: a short common English dish name
- wikipediaQuery: a short query for an exact dish page, or null
- pexelsQuery: a short query for a plated food photo, or null

Rules:
- Keep values short and practical.
- Focus on the plated dish, not ingredients, oils, sauces, drinks, or broad cuisine pages.
- If the menu item is translated, use the common English dish name.
- Use null only when a source is unlikely to help.
- Return JSON only.
`.trim();

const DISH_IMAGE_VALIDATION_PROMPT = `
Decide whether this image is a real food photo for the target menu dish.

Return:
- isFoodDish
- matchesDish
- confidence
- reason

Reject images that mainly show people, places, festivals, packaging, raw ingredients, or the wrong dish.
Return JSON only.
`.trim();

export function clearDishImageCaches(): void {
  pexelsSearchCache.clear();
  wikimediaSearchCache.clear();
  wikimediaSummaryCache.clear();
  dishImageValidationCache.clear();
  wikimediaRateLimitedUntil = 0;
}

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("dishImages.ts is server-only. Call it from a backend route or server function.");
  }
}

function getOptionalPexelsApiKey(providedApiKey?: string): string | null {
  const rawApiKey = providedApiKey ?? process.env.PEXELS_API_KEY;
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
  return apiKey || null;
}

function getOptionalGeminiApiKey(): string | null {
  const rawApiKey = process.env.GEMINI_API_KEY;
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
  return apiKey || null;
}

function canUseDishImageValidation(options: SearchPexelsPhotoOptions = {}): boolean {
  return Boolean(options.validateDishImage || getOptionalGeminiApiKey());
}

function getWikimediaUserAgent(providedUserAgent?: string): string {
  const rawUserAgent = providedUserAgent ?? process.env.WIKIMEDIA_USER_AGENT;
  const userAgent = typeof rawUserAgent === "string" ? rawUserAgent.trim() : "";
  return userAgent || "tobenamed-menu-visualizer/1.0";
}

async function createGeminiClient() {
  assertServerOnly();

  const apiKey = getOptionalGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  const { GoogleGenAI, Type } = await import("@google/genai");

  return {
    Type,
    ai: new GoogleGenAI({ apiKey }),
  };
}

function stripTranslatedPrefix(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.replace(/^Translated:\s*/i, "").trim() || null;
}

function normalizeSearchText(value: string): string {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\\/|]+/g, " ")
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQueryValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeSearchText(stripTranslatedPrefix(value) ?? value);
  return normalized.length > 0 ? normalized : null;
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function isGenericDishName(value: string): boolean {
  const normalized = value.trim();

  if (normalized.length < 3) {
    return true;
  }

  if (!/[A-Za-z]/.test(normalized)) {
    return true;
  }

  return GENERIC_DISH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getMeaningfulTokens(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return tokenize(value)
    .filter((token) => !STOP_WORDS.has(token));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function normalizeDishImageSearchPlan(plan: DishImageSearchPlan): DishImageSearchPlan {
  return {
    itemKey: String(plan.itemKey),
    canonicalDishName: normalizeQueryValue(plan.canonicalDishName),
    wikipediaQuery: normalizeQueryValue(plan.wikipediaQuery),
    pexelsQuery: normalizeQueryValue(plan.pexelsQuery),
  };
}

async function defaultPlanDishImageSearches(
  items: DishImageSearchCandidate[],
): Promise<DishImageSearchPlan[]> {
  if (items.length === 0) {
    return [];
  }

  const geminiClient = await createGeminiClient();
  if (!geminiClient) {
    return [];
  }

  const { ai, Type } = geminiClient;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          text: `${DISH_IMAGE_QUERY_PLANNER_PROMPT}

Items:
${JSON.stringify(items, null, 2)}`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              itemKey: { type: Type.STRING },
              canonicalDishName: { type: Type.STRING, nullable: true },
              wikipediaQuery: { type: Type.STRING, nullable: true },
              pexelsQuery: { type: Type.STRING, nullable: true },
            },
            required: [
              "itemKey",
              "canonicalDishName",
              "wikipediaQuery",
              "pexelsQuery",
            ],
            propertyOrdering: [
              "itemKey",
              "canonicalDishName",
              "wikipediaQuery",
              "pexelsQuery",
            ],
          },
        },
      },
    });

    const text = response.text;
    if (!text) {
      return [];
    }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => normalizeDishImageSearchPlan(entry as DishImageSearchPlan));
  } catch {
    return [];
  }
}

function stripHtml(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function summarizeResponseText(value: string, maxLength = 220): string {
  const compact = stripHtml(value).replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3).trim()}...`;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
}

function singularizeToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
}

function buildDishImageSearchContext(item: ParsedMenuItem): DishImageSearchContext | null {
  const translatedName = stripTranslatedPrefix(item.nameEnglish);
  const baseName = translatedName ?? item.nameOriginal;
  const normalized = normalizeSearchText(baseName);

  if (normalized.length === 0 || isGenericDishName(normalized)) {
    return null;
  }

  const normalizedDescription = stripTranslatedPrefix(item.description) ?? item.description ?? null;
  const queryTokens = uniqueStrings(getMeaningfulTokens(normalized));
  const descriptionTokens = uniqueStrings(getMeaningfulTokens(normalizedDescription))
    .slice(0, 6);
  const categoryTokens = uniqueStrings(
    [...queryTokens, ...descriptionTokens]
      .map((token) => singularizeToken(token))
      .filter((token) => FOOD_CATEGORY_WORDS.has(token)),
  );

  return {
    baseName: normalized,
    description: normalizedDescription,
    queryTokens,
    descriptionTokens,
    categoryTokens,
  };
}

function buildDishSearchCandidate(item: ParsedMenuItem, itemKey: string): DishImageSearchCandidate {
  return {
    itemKey,
    nameOriginal: item.nameOriginal,
    nameEnglish: stripTranslatedPrefix(item.nameEnglish) ?? item.nameEnglish ?? null,
    description: stripTranslatedPrefix(item.description) ?? item.description ?? null,
  };
}

function enhanceContextWithPlan(
  context: DishImageSearchContext,
  plan: DishImageSearchPlan | null,
): DishImageSearchContext {
  const canonicalDishName = normalizeQueryValue(plan?.canonicalDishName);

  if (!canonicalDishName) {
    return context;
  }

  const canonicalTokens = uniqueStrings(getMeaningfulTokens(canonicalDishName));
  const categoryTokens = uniqueStrings(
    [...context.categoryTokens, ...canonicalTokens]
      .map((token) => singularizeToken(token))
      .filter((token) => FOOD_CATEGORY_WORDS.has(token)),
  );

  return {
    ...context,
    baseName: canonicalDishName,
    queryTokens: uniqueStrings([...canonicalTokens, ...context.queryTokens]),
    categoryTokens,
  };
}

function buildDishSearchQueries(context: DishImageSearchContext): string[] {
  const normalizedQueryTokens = context.queryTokens.map((token) => singularizeToken(token));
  const extraCategoryTokens = context.categoryTokens
    .filter((token) => !normalizedQueryTokens.includes(token))
    .slice(0, 2);
  const descriptorTokens = context.descriptionTokens
    .filter((token) => FOOD_CATEGORY_WORDS.has(singularizeToken(token)))
    .filter((token) => !context.queryTokens.includes(token))
    .slice(0, 2);
  const queries = [
    context.baseName,
    extraCategoryTokens.length > 0
      ? `${context.baseName} ${extraCategoryTokens.join(" ")}`
      : "",
    descriptorTokens.length > 0
      ? `${context.baseName} ${descriptorTokens.join(" ")}`
      : "",
    `${context.baseName} food`,
  ];

  return uniqueStrings(queries);
}

function buildWikimediaQueries(
  context: DishImageSearchContext,
  plan: DishImageSearchPlan | null,
): string[] {
  const plannerQueries = [
    normalizeQueryValue(plan?.wikipediaQuery),
    normalizeQueryValue(plan?.canonicalDishName),
  ].filter((value): value is string => Boolean(value));

  return uniqueStrings([
    ...plannerQueries,
    context.baseName,
  ]);
}

function buildPexelsQueries(
  context: DishImageSearchContext,
  plan: DishImageSearchPlan | null,
): string[] {
  const plannerQueries = [
    normalizeQueryValue(plan?.pexelsQuery),
    normalizeQueryValue(plan?.canonicalDishName),
  ].filter((value): value is string => Boolean(value));

  return uniqueStrings([
    ...plannerQueries,
    ...buildDishSearchQueries(context),
  ]);
}

function mapPexelsPhoto(
  photo: z.infer<typeof pexelsSearchResponseSchema>["photos"][number],
): DishImageAsset {
  return {
    id: photo.id,
    alt: photo.alt ?? null,
    pageUrl: photo.url,
    pexelsUrl: photo.url,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    avgColor: photo.avg_color ?? null,
    src: {
      tiny: photo.src.tiny,
      small: photo.src.small,
      medium: photo.src.medium,
      landscape: photo.src.landscape,
      portrait: photo.src.portrait,
    },
    attributionText: `Photo by ${photo.photographer} on Pexels`,
    attributionLink: photo.url,
  };
}

function normalizeWikimediaImageUrl(url: string): string {
  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("/")) {
    return `https://en.wikipedia.org${url}`;
  }

  return url;
}

function buildWikipediaPageUrl(key: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(key.replace(/\s+/g, "_"))}`;
}

async function getCachedWikimediaSummary(
  pageKey: string,
  options: SearchPexelsPhotoOptions = {},
): Promise<z.infer<typeof wikimediaSummaryResponseSchema> | null> {
  if (wikimediaSummaryCache.has(pageKey)) {
    return wikimediaSummaryCache.get(pageKey) ?? null;
  }

  const summaryPromise = (async () => {
    if (Date.now() < wikimediaRateLimitedUntil) {
      return null;
    }

    try {
      const response = await wikimediaGetJson<unknown>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageKey)}`,
        options,
      );
      return wikimediaSummaryResponseSchema.parse(response);
    } catch (error) {
      if (error instanceof WikimediaRateLimitError) {
        wikimediaRateLimitedUntil = Math.max(
          wikimediaRateLimitedUntil,
          Date.now() + error.retryAfterMs,
        );
        return null;
      }

      return null;
    }
  })();

  wikimediaSummaryCache.set(pageKey, summaryPromise);
  return summaryPromise;
}

async function mapWikimediaResult(
  page: z.infer<typeof wikimediaSearchResponseSchema>["pages"][number],
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageAsset | null> {
  if (!page.thumbnail?.url) {
    return null;
  }

  const summary = await getCachedWikimediaSummary(page.key, options);
  const summaryImageUrl = summary?.originalimage?.source
    ?? summary?.thumbnail?.source
    ?? null;
  const imageUrl = normalizeWikimediaImageUrl(summaryImageUrl ?? page.thumbnail.url);
  const pageUrl = buildWikipediaPageUrl(page.key);

  return {
    id: page.id ?? page.key,
    alt: page.description ?? summary?.title ?? page.title,
    pageUrl,
    pexelsUrl: null,
    photographer: null,
    photographerUrl: null,
    avgColor: null,
    src: {
      tiny: imageUrl,
      small: imageUrl,
      medium: imageUrl,
      landscape: imageUrl,
      portrait: imageUrl,
    },
    attributionText: `Image from Wikipedia: ${page.title}`,
    attributionLink: pageUrl,
  };
}

function buildDishLabel(item: ParsedMenuItem, context: DishImageSearchContext): string {
  return stripTranslatedPrefix(item.nameEnglish) ?? context.baseName ?? item.nameOriginal;
}

async function defaultValidateDishImage(
  input: DishImageValidationInput,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageValidationResult | null> {
  const geminiClient = await createGeminiClient();
  if (!geminiClient) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const imageBytes = await fetchImageBytes(input.asset.src.medium, fetchImpl);
  if (!imageBytes) {
    return null;
  }

  const { ai, Type } = geminiClient;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: imageBytes.mimeType,
            data: imageBytes.data,
          },
        },
        {
          text: `${DISH_IMAGE_VALIDATION_PROMPT}

Target dish:
- Display name: ${buildDishLabel(input.item, input.context)}
- Original menu name: ${input.item.nameOriginal}
- Description: ${input.item.description ?? "None"}
- Search query used: ${input.searchQuery}
- Source attribution text: ${input.asset.attributionText}
- Source page: ${input.asset.pageUrl}

Return JSON only.`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isFoodDish: { type: Type.BOOLEAN },
            matchesDish: { type: Type.BOOLEAN },
            confidence: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ["isFoodDish", "matchesDish", "confidence", "reason"],
          propertyOrdering: ["isFoodDish", "matchesDish", "confidence", "reason"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      return null;
    }

    const parsed = dishImageValidationResponseSchema.parse(JSON.parse(text));
    return parsed;
  } catch {
    return null;
  }
}

async function pexelsGetJson<T>(
  url: string,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const summary = summarizeResponseText(responseText);
    throw new Error(
      [
        `Pexels request failed with status ${response.status}.`,
        summary ? `Pexels said: ${summary}` : "",
      ].filter(Boolean).join(" "),
    );
  }

  return response.json() as Promise<T>;
}

async function wikimediaGetJson<T>(
  url: string,
  options: SearchPexelsPhotoOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = getWikimediaUserAgent(options.userAgent);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Api-User-Agent": userAgent,
    "User-Agent": userAgent,
  };

  const response = await fetchImpl(url, { headers });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const summary = summarizeResponseText(responseText);

    if (response.status === 429) {
      throw new WikimediaRateLimitError(
        "Wikipedia rate limited the image lookup request.",
        parseRetryAfterMs(response.headers.get("retry-after")) ?? DEFAULT_WIKIMEDIA_RETRY_AFTER_MS,
      );
    }

    throw new Error(
      [
        `Wikipedia request failed with status ${response.status}.`,
        summary ? `Wikipedia said: ${summary}` : "",
      ].filter(Boolean).join(" "),
    );
  }

  return response.json() as Promise<T>;
}

async function fetchImageBytes(
  url: string,
  fetchImpl: FetchLike,
): Promise<{ mimeType: string; data: string } | null> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "image/*",
    },
  });

  if (!response.ok) {
    return null;
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!mimeType.startsWith("image/")) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    return null;
  }

  return {
    mimeType,
    data: buffer.toString("base64"),
  };
}

function countTokenOverlap(tokens: string[], candidates: string[]): number {
  if (tokens.length === 0 || candidates.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidates.map((token) => singularizeToken(token)));
  return tokens
    .map((token) => singularizeToken(token))
    .filter((token) => candidateSet.has(token)).length;
}

function containsAnyToken(tokens: string[], candidates: Set<string>): boolean {
  return tokens.some((token) => candidates.has(singularizeToken(token)));
}

function scorePexelsPhoto(
  photo: z.infer<typeof pexelsSearchResponseSchema>["photos"][number],
  context: DishImageSearchContext,
): number {
  const alt = normalizeSearchText(photo.alt ?? "");
  const altTokens = tokenize(alt);
  const hasFoodCue = containsAnyToken(altTokens, FOOD_CUES);
  const hasNonFoodCue = containsAnyToken(altTokens, NON_FOOD_VISUAL_CUES);
  const queryOverlap = countTokenOverlap(context.queryTokens, altTokens);
  const descriptionOverlap = countTokenOverlap(context.descriptionTokens, altTokens);
  const categoryOverlap = countTokenOverlap(context.categoryTokens, altTokens);

  if (!hasFoodCue && categoryOverlap === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  if (hasNonFoodCue && queryOverlap === 0 && categoryOverlap === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (alt.length > 0 && alt.includes(context.baseName.toLowerCase())) {
    score += 6;
  }

  score += queryOverlap * 2;
  score += categoryOverlap * 2.5;
  score += descriptionOverlap * 0.75;

  if (hasFoodCue) {
    score += 1.5;
  }

  if (hasNonFoodCue) {
    score -= 2;
  }

  return score;
}

function scoreWikimediaResult(
  page: z.infer<typeof wikimediaSearchResponseSchema>["pages"][number],
  context: DishImageSearchContext,
): number {
  if (!page.thumbnail?.url) {
    return Number.NEGATIVE_INFINITY;
  }

  const title = normalizeSearchText(page.title);
  const matchedTitle = normalizeSearchText(page.matched_title ?? "");
  const description = normalizeSearchText(page.description ?? "");
  const excerpt = normalizeSearchText(stripHtml(page.excerpt ?? ""));
  const titleTokens = tokenize(title);
  const matchedTitleTokens = tokenize(matchedTitle);
  const descriptionTokens = tokenize(description);
  const excerptTokens = tokenize(excerpt);
  const combinedTokens = uniqueStrings([
    ...titleTokens,
    ...matchedTitleTokens,
    ...descriptionTokens,
    ...excerptTokens,
  ]);
  const genericTitle = [page.title, page.matched_title ?? ""]
    .some((value) => GENERIC_WIKIMEDIA_TITLE_PATTERNS.some((pattern) => pattern.test(value)));
  const hasFoodCue = containsAnyToken(combinedTokens, FOOD_CUES);
  const hasNonFoodCue = containsAnyToken(combinedTokens, NON_FOOD_VISUAL_CUES);
  const queryOverlap = countTokenOverlap(context.queryTokens, combinedTokens);
  const categoryOverlap = countTokenOverlap(context.categoryTokens, combinedTokens);
  const descriptionOverlap = countTokenOverlap(context.descriptionTokens, combinedTokens);

  if (!hasFoodCue && categoryOverlap === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  if (genericTitle && queryOverlap === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (title.length > 0 && title.includes(context.baseName.toLowerCase())) {
    score += 7;
  }

  if (matchedTitle.length > 0 && matchedTitle.includes(context.baseName.toLowerCase())) {
    score += 6;
  }

  score += queryOverlap * 1.8;
  score += categoryOverlap * 2.25;
  score += descriptionOverlap * 0.9;

  if (hasFoodCue) {
    score += 1.5;
  }

  if (hasNonFoodCue) {
    score -= 1.5;
  }

  return score;
}

async function searchWikimediaPhoto(
  query: string,
  context: DishImageSearchContext,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageAsset | null> {
  assertServerOnly();

  if (Date.now() < wikimediaRateLimitedUntil) {
    return null;
  }

  const queryParams = new URLSearchParams({
    q: query,
    limit: "6",
  });

  let response: unknown;

  try {
    response = await wikimediaGetJson<unknown>(
      `https://en.wikipedia.org/w/rest.php/v1/search/page?${queryParams.toString()}`,
      options,
    );
  } catch (error) {
    if (error instanceof WikimediaRateLimitError) {
      wikimediaRateLimitedUntil = Math.max(
        wikimediaRateLimitedUntil,
        Date.now() + error.retryAfterMs,
      );
      return null;
    }

    throw error;
  }

  const parsed = wikimediaSearchResponseSchema.parse(response);

  if (parsed.pages.length === 0) {
    return null;
  }

  const bestPage = parsed.pages
    .map((page) => ({
      page,
      score: scoreWikimediaResult(page, context),
    }))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 2.25)
    .sort((left, right) => right.score - left.score)[0];

  if (!bestPage) {
    return null;
  }

  return mapWikimediaResult(bestPage.page, options);
}

async function searchPexelsPhoto(
  query: string,
  context: DishImageSearchContext,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageAsset | null> {
  assertServerOnly();

  const apiKey = getOptionalPexelsApiKey(options.apiKey);
  if (!apiKey) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const queryParams = new URLSearchParams({
    query,
    page: "1",
    per_page: "6",
    orientation: "square",
    size: "medium",
    locale: "en-US",
  });

  const response = await pexelsGetJson<unknown>(
    `https://api.pexels.com/v1/search?${queryParams.toString()}`,
    apiKey,
    fetchImpl,
  );
  const parsed = pexelsSearchResponseSchema.parse(response);

  if (parsed.photos.length === 0) {
    return null;
  }

  const bestPhoto = parsed.photos
    .map((photo) => ({
      photo,
      score: scorePexelsPhoto(photo, context),
    }))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 2.5)
    .sort((left, right) => right.score - left.score)[0];

  if (!bestPhoto) {
    return null;
  }

  return mapPexelsPhoto(bestPhoto.photo);
}

async function getCachedPexelsPhoto(
  query: string,
  context: DishImageSearchContext,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageAsset | null> {
  const cacheKey = `${query.toLowerCase()}::${context.baseName.toLowerCase()}`;

  if (!pexelsSearchCache.has(cacheKey)) {
    pexelsSearchCache.set(cacheKey, searchPexelsPhoto(query, context, options));
  }

  return pexelsSearchCache.get(cacheKey) ?? null;
}

async function getCachedWikimediaPhoto(
  query: string,
  context: DishImageSearchContext,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageAsset | null> {
  const cacheKey = `${query.toLowerCase()}::${context.baseName.toLowerCase()}`;

  if (!wikimediaSearchCache.has(cacheKey)) {
    wikimediaSearchCache.set(cacheKey, searchWikimediaPhoto(query, context, options));
  }

  return wikimediaSearchCache.get(cacheKey) ?? null;
}

async function getCachedDishImageValidation(
  input: DishImageValidationInput,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageValidationResult | null> {
  if (!canUseDishImageValidation(options)) {
    return null;
  }

  const cacheKey = [
    input.context.baseName.toLowerCase(),
    input.searchQuery.toLowerCase(),
    input.asset.src.medium,
  ].join("::");

  if (!dishImageValidationCache.has(cacheKey)) {
    const validator = options.validateDishImage
      ? (candidate: DishImageValidationInput) => options.validateDishImage?.(candidate) ?? Promise.resolve(null)
      : (candidate: DishImageValidationInput) => defaultValidateDishImage(candidate, options);
    dishImageValidationCache.set(cacheKey, validator(input));
  }

  return dishImageValidationCache.get(cacheKey) ?? null;
}

function passesDishImageValidation(
  validation: DishImageValidationResult | null,
): boolean {
  if (!validation) {
    return true;
  }

  if (validation.isFoodDish && validation.matchesDish) {
    return true;
  }

  return validation.confidence !== "high";
}

export async function findDishImages(
  items: ParsedMenuItem[],
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageMatch[]> {
  const planningCandidates = items.map((item, index) => buildDishSearchCandidate(item, String(index)));
  const plannedSearches = await (options.planSearchQueries ?? defaultPlanDishImageSearches)(planningCandidates);
  const searchPlanByKey = new Map(
    plannedSearches.map((plan) => [String(plan.itemKey), normalizeDishImageSearchPlan(plan)]),
  );
  const matches: DishImageMatch[] = [];

  for (const [index, item] of items.entries()) {
    const itemKey = String(index);
    const searchPlan = searchPlanByKey.get(itemKey) ?? null;

    const baseContext = buildDishImageSearchContext(item);

    if (!baseContext) {
      matches.push({
        itemKey,
        searchQuery: null,
        source: "none" as const,
        image: null,
      });
      continue;
    }

    const context = enhanceContextWithPlan(baseContext, searchPlan);
    const wikimediaQueries = buildWikimediaQueries(context, searchPlan);
    const pexelsQueries = buildPexelsQueries(context, searchPlan);
    const queries = uniqueStrings([...wikimediaQueries, ...pexelsQueries]);

    if (queries.length === 0) {
      matches.push({
        itemKey,
        searchQuery: null,
        source: "none" as const,
        image: null,
      });
      continue;
    }

    let match: DishImageMatch | null = null;

    for (const query of wikimediaQueries) {
      const wikimediaImage = await getCachedWikimediaPhoto(query, context, options);

      if (wikimediaImage) {
        const validation = await getCachedDishImageValidation({
          asset: wikimediaImage,
          item,
          context,
          searchQuery: query,
        }, options);

        if (passesDishImageValidation(validation)) {
          match = {
            itemKey,
            searchQuery: query,
            source: "wikimedia" as const,
            image: wikimediaImage,
          };
          break;
        }
      }
    }

    if (!match) {
      for (const query of pexelsQueries) {
        const image = await getCachedPexelsPhoto(query, context, options);

        if (image) {
          const validation = await getCachedDishImageValidation({
            asset: image,
            item,
            context,
            searchQuery: query,
          }, options);

          if (passesDishImageValidation(validation)) {
            match = {
              itemKey,
              searchQuery: query,
              source: "pexels" as const,
              image,
            };
            break;
          }
        }
      }
    }

    matches.push(match ?? {
      itemKey,
      searchQuery: null,
      source: "none" as const,
      image: null,
    });
  }

  return matches;
}
