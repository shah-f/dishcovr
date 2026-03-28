import { z } from "zod";

import type { ParsedMenuItem } from "./menuParser.ts";

export type DishImageSource = "themealdb" | "wikimedia" | "pexels" | "none";

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
  mealDbApiKey?: string;
  userAgent?: string;
  fetchImpl?: FetchLike;
  planSearchQueries?: DishImageSearchPlanner;
  validateDishImage?: DishImageValidator;
};

type DishImageSearchContext = {
  baseName: string;
  queryTokens: string[];
  descriptionTokens: string[];
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

const mealDbSearchResponseSchema = z.object({
  meals: z.array(z.object({
    idMeal: z.string(),
    strMeal: z.string(),
    strMealThumb: z.string().nullable().optional(),
  })).nullable().optional(),
});

type MealDbMeal = NonNullable<z.infer<typeof mealDbSearchResponseSchema>["meals"]>[number];

const dishImageSearchPlanSchema = z.array(z.object({
  itemKey: z.string(),
  canonicalDishName: z.string().nullable(),
  wikipediaQuery: z.string().nullable(),
  pexelsQuery: z.string().nullable(),
}));

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
  /\bfood preparation\b/i,
  /\bcuisine\b/i,
  /\bculture\b/i,
  /\bfestival\b/i,
  /\bstreet food\b/i,
  /\bvegetable oils?\b/i,
  /\bcooking oils?\b/i,
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "choice",
  "for",
  "fresh",
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

const FOOD_HINT_WORDS = new Set([
  "appetizer",
  "basil",
  "beef",
  "bowl",
  "bread",
  "burger",
  "burrito",
  "cake",
  "calamari",
  "calamares",
  "cheese",
  "chicken",
  "cooked",
  "curry",
  "dessert",
  "dish",
  "dumpling",
  "dumplings",
  "fish",
  "food",
  "fries",
  "fried",
  "ginger",
  "meal",
  "mozzarella",
  "noodle",
  "noodles",
  "octopus",
  "pasta",
  "pizza",
  "plate",
  "pork",
  "prawn",
  "prawns",
  "ramen",
  "rice",
  "salad",
  "sandwich",
  "seafood",
  "shrimp",
  "snack",
  "soup",
  "squid",
  "starter",
  "sticks",
  "stir",
  "sushi",
  "taco",
  "thai",
  "tofu",
  "vegetable",
  "vegetables",
]);

const NON_FOOD_WORDS = new Set([
  "camera",
  "chair",
  "clothing",
  "crowd",
  "festival",
  "fashion",
  "man",
  "men",
  "monument",
  "museum",
  "person",
  "people",
  "photographer",
  "portrait",
  "sculpture",
  "sitting",
  "standing",
  "statue",
  "street",
  "woman",
  "women",
]);

const DISH_ALIASES = new Map<string, string[]>([
  ["drunken noodle", ["pad kee mao"]],
  ["drunken noodles", ["pad kee mao"]],
  ["calamares", ["calamari"]],
  ["chipirones", ["baby squid", "small squid"]],
  ["pulpo", ["octopus"]],
  ["mejillones", ["mussels"]],
  ["queso gallego", ["galician cheese"]],
  ["mozarella sticks", ["mozzarella sticks"]],
  ["mozzeralla sticks", ["mozzarella sticks"]],
  ["mixed vegetable and tofa", ["tofu vegetable stir fry"]],
]);

const mealDbSearchCache = new Map<string, Promise<DishImageAsset | null>>();
const pexelsSearchCache = new Map<string, Promise<DishImageAsset | null>>();
const wikimediaSearchCache = new Map<string, Promise<DishImageAsset | null>>();
const wikimediaSummaryCache = new Map<string, Promise<z.infer<typeof wikimediaSummaryResponseSchema> | null>>();
const DEFAULT_WIKIMEDIA_RETRY_AFTER_MS = 5 * 60 * 1000;
let wikimediaRateLimitedUntil = 0;

const DISH_IMAGE_QUERY_PLANNER_PROMPT = `
You help choose better image search phrases for restaurant dishes.

For each item, return:
- itemKey
- canonicalDishName: a concise common English plated-dish name
- wikipediaQuery: a concise Wikipedia-friendly dish query
- pexelsQuery: a concise plated-food photo query

Rules:
- Prefer cooked plated dishes, not raw animals, species names, ingredients, or broad cuisine pages.
- If the dish has a known dish-style name, use it.
- Keep every field short.
- Return JSON only.
`.trim();

export function clearDishImageCaches(): void {
  mealDbSearchCache.clear();
  pexelsSearchCache.clear();
  wikimediaSearchCache.clear();
  wikimediaSummaryCache.clear();
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

function getOptionalMealDbApiKey(options: SearchPexelsPhotoOptions = {}): string | null {
  const providedKey = options.mealDbApiKey ?? process.env.THEMEALDB_API_KEY;
  const trimmedProvidedKey = typeof providedKey === "string" ? providedKey.trim() : "";

  if (trimmedProvidedKey) {
    return trimmedProvidedKey;
  }

  // Use TheMealDB's public test key in normal app runtime, but stay out of
  // mocked/test fetch flows unless a key is explicitly provided.
  if (!options.fetchImpl) {
    return "1";
  }

  return null;
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

  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey });
}

function stripTranslatedPrefix(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
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
    .map((token) => singularizeToken(token))
    .filter((token) => token.length > 1);
}

function singularizeToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

function getMeaningfulTokens(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return tokenize(value).filter((token) => !STOP_WORDS.has(token));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.length > 0)))];
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

  const ai = await createGeminiClient();
  if (!ai) {
    return [];
  }

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
      },
    });

    const text = response.text;
    if (!text) {
      return [];
    }

    const parsed = dishImageSearchPlanSchema.parse(JSON.parse(text));
    return parsed.map(normalizeDishImageSearchPlan);
  } catch {
    return [];
  }
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

function buildDishSearchCandidate(item: ParsedMenuItem, itemKey: string): DishImageSearchCandidate {
  return {
    itemKey,
    nameOriginal: item.nameOriginal,
    nameEnglish: stripTranslatedPrefix(item.nameEnglish) ?? item.nameEnglish ?? null,
    description: stripTranslatedPrefix(item.description) ?? item.description ?? null,
  };
}

function buildDishImageSearchContext(item: ParsedMenuItem): DishImageSearchContext | null {
  const baseName = stripTranslatedPrefix(item.nameEnglish) ?? item.nameOriginal;
  const normalizedName = normalizeSearchText(baseName);

  if (!normalizedName || isGenericDishName(normalizedName)) {
    return null;
  }

  const description = stripTranslatedPrefix(item.description) ?? item.description ?? null;
  const queryTokens = getMeaningfulTokens(normalizedName);
  const meaningfulDescriptionTokens = getMeaningfulTokens(description)
    .filter((token) => !queryTokens.includes(token));
  const foodDescriptionTokens = meaningfulDescriptionTokens
    .filter((token) => FOOD_HINT_WORDS.has(token))
    .slice(0, 2);
  const descriptionTokens = (foodDescriptionTokens.length > 0
    ? foodDescriptionTokens
    : meaningfulDescriptionTokens.slice(0, 2));

  return {
    baseName: normalizedName,
    queryTokens,
    descriptionTokens,
  };
}

function getDishAliases(value: string): string[] {
  return DISH_ALIASES.get(value.toLowerCase()) ?? [];
}

function buildWikipediaQueries(
  context: DishImageSearchContext,
  plan: DishImageSearchPlan | null,
): string[] {
  return uniqueStrings([
    context.baseName,
    normalizeQueryValue(plan?.wikipediaQuery),
    normalizeQueryValue(plan?.canonicalDishName),
    ...getDishAliases(context.baseName),
  ]);
}

function buildPexelsQueries(
  context: DishImageSearchContext,
  plan: DishImageSearchPlan | null,
): string[] {
  const expandedName = context.descriptionTokens.length > 0
    ? `${context.baseName} ${context.descriptionTokens.join(" ")}`
    : null;

  return uniqueStrings([
    normalizeQueryValue(plan?.pexelsQuery),
    normalizeQueryValue(plan?.canonicalDishName),
    context.baseName,
    ...getDishAliases(context.baseName),
    expandedName,
  ]);
}

function buildMealDbQueries(
  context: DishImageSearchContext,
  plan: DishImageSearchPlan | null,
): string[] {
  return uniqueStrings([
    context.baseName,
    normalizeQueryValue(plan?.canonicalDishName),
    ...getDishAliases(context.baseName),
  ]);
}

function countSharedTokens(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function containsNonFoodCue(tokens: string[]): boolean {
  return tokens.some((token) => NON_FOOD_WORDS.has(token));
}

function containsFoodCue(tokens: string[]): boolean {
  return tokens.some((token) => FOOD_HINT_WORDS.has(token));
}

function buildQueryTokens(query: string, context: DishImageSearchContext): string[] {
  return uniqueStrings([
    ...context.queryTokens,
    ...getMeaningfulTokens(query),
  ]);
}

function hasStrongTokenMatch(
  queryTokens: string[],
  candidateTokens: string[],
): boolean {
  const shared = countSharedTokens(queryTokens, candidateTokens);

  if (shared === 0) {
    return false;
  }

  if (queryTokens.length <= 2) {
    return shared >= 1;
  }

  return shared >= 2;
}

function buildWikipediaPageUrl(key: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(key.replace(/\s+/g, "_"))}`;
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

function mapMealDbMeal(
  meal: MealDbMeal,
): DishImageAsset | null {
  if (!meal.strMealThumb) {
    return null;
  }

  return {
    id: meal.idMeal,
    alt: meal.strMeal,
    pageUrl: `https://www.themealdb.com/meal/${meal.idMeal}`,
    pexelsUrl: null,
    photographer: null,
    photographerUrl: null,
    avgColor: null,
    src: {
      tiny: meal.strMealThumb,
      small: meal.strMealThumb,
      medium: meal.strMealThumb,
      landscape: meal.strMealThumb,
      portrait: meal.strMealThumb,
    },
    attributionText: `Image from TheMealDB: ${meal.strMeal}`,
    attributionLink: `https://www.themealdb.com/meal/${meal.idMeal}`,
  };
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
  const imageUrl = normalizeWikimediaImageUrl(
    summary?.originalimage?.source
      ?? summary?.thumbnail?.source
      ?? page.thumbnail.url,
  );
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
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "Api-User-Agent": userAgent,
      "User-Agent": userAgent,
    },
  });

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

function scoreWikimediaResult(
  page: z.infer<typeof wikimediaSearchResponseSchema>["pages"][number],
  context: DishImageSearchContext,
  query: string,
): number {
  if (!page.thumbnail?.url) {
    return Number.NEGATIVE_INFINITY;
  }

  const title = normalizeSearchText(page.title);
  const matchedTitle = normalizeSearchText(page.matched_title ?? "");
  const description = normalizeSearchText(page.description ?? "");
  const excerpt = normalizeSearchText(stripHtml(page.excerpt ?? ""));
  const titleTokens = uniqueStrings([...tokenize(title), ...tokenize(matchedTitle)]);
  const metadataTokens = uniqueStrings([
    ...tokenize(description),
    ...tokenize(excerpt),
  ]);
  const queryTokens = buildQueryTokens(query, context);

  if ([page.title, page.matched_title ?? ""].some((value) =>
    GENERIC_WIKIMEDIA_TITLE_PATTERNS.some((pattern) => pattern.test(value))
  )) {
    return Number.NEGATIVE_INFINITY;
  }

  const titleOverlap = countSharedTokens(queryTokens, titleTokens);
  if (!hasStrongTokenMatch(queryTokens, titleTokens)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (containsNonFoodCue(metadataTokens) && titleOverlap < 2) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = titleOverlap * 4;

  if (title.toLowerCase() === context.baseName.toLowerCase()) {
    score += 8;
  } else if (
    title.toLowerCase().includes(context.baseName.toLowerCase())
    || matchedTitle.toLowerCase().includes(context.baseName.toLowerCase())
  ) {
    score += 4;
  }

  if (containsFoodCue(metadataTokens)) {
    score += 1;
  }

  return score;
}

function scorePexelsPhoto(
  photo: z.infer<typeof pexelsSearchResponseSchema>["photos"][number],
  context: DishImageSearchContext,
  query: string,
): number {
  const alt = normalizeSearchText(photo.alt ?? "");
  const altTokens = tokenize(alt);
  const queryTokens = buildQueryTokens(query, context);
  const overlap = countSharedTokens(queryTokens, altTokens);

  if (!hasStrongTokenMatch(queryTokens, altTokens)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (containsNonFoodCue(altTokens) && overlap < 2) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = overlap * 3;

  if (alt.toLowerCase().includes(context.baseName.toLowerCase())) {
    score += 4;
  }

  if (containsFoodCue(altTokens)) {
    score += 1;
  }

  return score;
}

function scoreMealDbMeal(
  meal: MealDbMeal,
  context: DishImageSearchContext,
  query: string,
): number {
  if (!meal.strMealThumb) {
    return Number.NEGATIVE_INFINITY;
  }

  const title = normalizeSearchText(meal.strMeal);
  const titleTokens = tokenize(title);
  const queryTokens = buildQueryTokens(query, context);
  const overlap = countSharedTokens(queryTokens, titleTokens);

  if (!hasStrongTokenMatch(queryTokens, titleTokens)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = overlap * 3;

  if (title.toLowerCase() === context.baseName.toLowerCase()) {
    score += 8;
  } else if (title.toLowerCase() === query.toLowerCase()) {
    score += 6;
  } else if (
    title.toLowerCase().includes(context.baseName.toLowerCase())
    || context.baseName.toLowerCase().includes(title.toLowerCase())
  ) {
    score += 3;
  }

  return score;
}

async function mealDbGetJson<T>(
  url: string,
  fetchImpl: FetchLike,
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const summary = summarizeResponseText(responseText);
    throw new Error(
      [
        `TheMealDB request failed with status ${response.status}.`,
        summary ? `TheMealDB said: ${summary}` : "",
      ].filter(Boolean).join(" "),
    );
  }

  return response.json() as Promise<T>;
}

async function searchMealDbPhoto(
  query: string,
  context: DishImageSearchContext,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageAsset | null> {
  assertServerOnly();

  const apiKey = getOptionalMealDbApiKey(options);
  if (!apiKey) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const queryParams = new URLSearchParams({
    s: query,
  });
  const response = await mealDbGetJson<unknown>(
    `https://www.themealdb.com/api/json/v1/${encodeURIComponent(apiKey)}/search.php?${queryParams.toString()}`,
    fetchImpl,
  );
  const parsed = mealDbSearchResponseSchema.parse(response);
  const meals = parsed.meals ?? [];

  const bestMeal = meals
    .map((meal) => ({
      meal,
      score: scoreMealDbMeal(meal, context, query),
    }))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 5)
    .sort((left, right) => right.score - left.score)[0];

  if (!bestMeal) {
    return null;
  }

  return mapMealDbMeal(bestMeal.meal);
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

  try {
    const queryParams = new URLSearchParams({
      q: query,
      limit: "8",
    });
    const response = await wikimediaGetJson<unknown>(
      `https://en.wikipedia.org/w/rest.php/v1/search/page?${queryParams.toString()}`,
      options,
    );
    const parsed = wikimediaSearchResponseSchema.parse(response);
    const bestPage = parsed.pages
      .map((page) => ({
        page,
        score: scoreWikimediaResult(page, context, query),
      }))
      .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 4)
      .sort((left, right) => right.score - left.score)[0];

    if (!bestPage) {
      return null;
    }

    return mapWikimediaResult(bestPage.page, options);
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
  const bestPhoto = parsed.photos
    .map((photo) => ({
      photo,
      score: scorePexelsPhoto(photo, context, query),
    }))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 3)
    .sort((left, right) => right.score - left.score)[0];

  if (!bestPhoto) {
    return null;
  }

  return mapPexelsPhoto(bestPhoto.photo);
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

async function getCachedMealDbPhoto(
  query: string,
  context: DishImageSearchContext,
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageAsset | null> {
  const cacheKey = `${query.toLowerCase()}::${context.baseName.toLowerCase()}`;

  if (!mealDbSearchCache.has(cacheKey)) {
    mealDbSearchCache.set(cacheKey, searchMealDbPhoto(query, context, options));
  }

  return mealDbSearchCache.get(cacheKey) ?? null;
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

async function validateCandidateImage(
  input: DishImageValidationInput,
  options: SearchPexelsPhotoOptions = {},
): Promise<boolean> {
  if (!options.validateDishImage) {
    return true;
  }

  const result = await options.validateDishImage(input);
  if (!result) {
    return true;
  }

  return result.isFoodDish && result.matchesDish;
}

export async function findDishImages(
  items: ParsedMenuItem[],
  options: SearchPexelsPhotoOptions = {},
): Promise<DishImageMatch[]> {
  const planningCandidates = items.map((item, index) => buildDishSearchCandidate(item, String(index)));
  const plannedSearches = await (options.planSearchQueries ?? defaultPlanDishImageSearches)(
    planningCandidates,
  );
  const searchPlanByKey = new Map(
    plannedSearches.map((plan) => [String(plan.itemKey), normalizeDishImageSearchPlan(plan)]),
  );
  const matches: DishImageMatch[] = [];

  for (const [index, item] of items.entries()) {
    const itemKey = String(index);
    const context = buildDishImageSearchContext(item);

    if (!context) {
      matches.push({
        itemKey,
        searchQuery: null,
        source: "none",
        image: null,
      });
      continue;
    }

    const searchPlan = searchPlanByKey.get(itemKey) ?? null;
    const mealDbQueries = buildMealDbQueries(context, searchPlan);
    const wikimediaQueries = buildWikipediaQueries(context, searchPlan);
    const pexelsQueries = buildPexelsQueries(context, searchPlan);

    let match: DishImageMatch | null = null;

    for (const query of mealDbQueries) {
      const image = await getCachedMealDbPhoto(query, context, options);

      if (!image) {
        continue;
      }

      const isValid = await validateCandidateImage({
        asset: image,
        item,
        context,
        searchQuery: query,
      }, options);

      if (!isValid) {
        continue;
      }

      match = {
        itemKey,
        searchQuery: query,
        source: "themealdb",
        image,
      };
      break;
    }

    for (const query of wikimediaQueries) {
      if (match) {
        break;
      }

      const image = await getCachedWikimediaPhoto(query, context, options);

      if (!image) {
        continue;
      }

      const isValid = await validateCandidateImage({
        asset: image,
        item,
        context,
        searchQuery: query,
      }, options);

      if (!isValid) {
        continue;
      }

      match = {
        itemKey,
        searchQuery: query,
        source: "wikimedia",
        image,
      };
      break;
    }

    if (!match) {
      for (const query of pexelsQueries) {
        const image = await getCachedPexelsPhoto(query, context, options);

        if (!image) {
          continue;
        }

        const isValid = await validateCandidateImage({
          asset: image,
          item,
          context,
          searchQuery: query,
        }, options);

        if (!isValid) {
          continue;
        }

        match = {
          itemKey,
          searchQuery: query,
          source: "pexels",
          image,
        };
        break;
      }
    }

    matches.push(match ?? {
      itemKey,
      searchQuery: null,
      source: "none",
      image: null,
    });
  }

  return matches;
}
