import { z } from "zod";

import type { ParsedMenuItem } from "./menuParser.ts";

export type ReviewDocumentSource = "foursquare_tip";

export type ReviewDocument = {
  id: string;
  source: ReviewDocumentSource;
  text: string;
};

export type DishMentionMatchType = "exact" | "close";

export type DishMentionEvidence = {
  documentId: string;
  source: ReviewDocumentSource;
  matchedAlias: string;
  matchType: DishMentionMatchType;
  sentimentScore: number;
  text: string;
};

export type DishPopularityEntry = {
  menuItem: ParsedMenuItem;
  canonicalName: string;
  mentions: number;
  positiveMentions: number;
  negativeMentions: number;
  netSentiment: number;
  score: number;
  matchedAliases: string[];
  evidence: DishMentionEvidence[];
  aiAssessment: DishPopularityAiAssessment | null;
};

export type PopularDishBuckets = {
  mostMentioned: DishPopularityEntry[];
  highlyPraised: DishPopularityEntry[];
  likelyFavorites: DishPopularityEntry[];
};

export type DishPopularityAnalysis = {
  dishes: DishPopularityEntry[];
  buckets: PopularDishBuckets;
  documentsAnalyzed: number;
  aiRefinementApplied: boolean;
};

export type FoursquarePlace = {
  fsqId: string;
  name: string;
  formattedAddress: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  categories: string[];
  distance: number | null;
};

export type FindPopularDishesInput = {
  restaurantName: string;
  menuItems: ParsedMenuItem[];
  near?: string;
  ll?: string;
};

export type DishPopularityAiAssessment = {
  canonicalName: string;
  mostMentioned: boolean;
  highlyPraised: boolean;
  likelyFavorite: boolean;
  confidence: "low" | "medium" | "high";
  reason: string | null;
};

export type PopularDishesRefinerInput = {
  restaurantName: string;
  near?: string;
  dishes: DishPopularityEntry[];
  maxBuckets: number;
};

export type PopularDishesRefiner = (
  input: PopularDishesRefinerInput,
) => Promise<DishPopularityAiAssessment[] | null>;

type FetchLike = typeof fetch;

const foursquareSearchResponseSchema = z.object({
  results: z.array(z.object({
    fsq_id: z.string().optional(),
    fsq_place_id: z.string().optional(),
    name: z.string(),
    distance: z.number().nullable().optional(),
    categories: z.array(z.object({
      name: z.string().optional(),
    })).optional(),
    location: z.object({
      formatted_address: z.string().nullable().optional(),
      locality: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
    }).optional(),
  })),
});

const foursquareTipsResponseSchema = z.array(z.object({
  id: z.string().optional(),
  text: z.string().optional(),
}));

const POSITIVE_HINTS = new Map<string, number>([
  ["amazing", 1.7],
  ["awesome", 1.5],
  ["best", 1.8],
  ["crispy", 0.5],
  ["delicious", 1.7],
  ["excellent", 1.7],
  ["favorite", 2.1],
  ["fresh", 0.6],
  ["good", 0.6],
  ["great", 1.1],
  ["incredible", 1.8],
  ["love", 1.6],
  ["loved", 1.6],
  ["must get", 2.2],
  ["must try", 2.2],
  ["perfect", 1.7],
  ["recommend", 1.5],
  ["recommended", 1.5],
  ["solid", 0.6],
  ["tender", 0.6],
  ["worth it", 1.2],
]);

const NEGATIVE_HINTS = new Map<string, number>([
  ["avoid", -2],
  ["bad", -1.2],
  ["bland", -1.3],
  ["boring", -1.1],
  ["cold", -0.8],
  ["disappointing", -1.6],
  ["dry", -1.1],
  ["greasy", -1],
  ["mediocre", -1.1],
  ["overpriced", -1.1],
  ["salty", -0.8],
  ["skip", -1.8],
  ["tough", -1],
  ["underwhelming", -1.6],
]);

const popularDishesAiAssessmentSchema = z.array(z.object({
  canonicalName: z.string(),
  mostMentioned: z.boolean(),
  highlyPraised: z.boolean(),
  likelyFavorite: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().nullable(),
}));

const POPULAR_DISHES_REFINEMENT_PROMPT = `
You are validating candidate "popular dishes" for a restaurant using matched review snippets.

You will receive a shortlist of menu items. Each item includes:
- canonicalName
- original menu names
- heuristic counts
- review snippets that matched the dish

Your job:
- Be conservative.
- Use ONLY the provided evidence.
- Do not invent evidence or rely on outside knowledge.
- Mark a dish as "mostMentioned" if the evidence suggests it is repeatedly discussed relative to other candidates.
- Mark a dish as "highlyPraised" if the evidence shows clearly positive language about it.
- Mark a dish as "likelyFavorite" if the evidence suggests it is a standout, a must-order, or especially beloved.
- If evidence is weak or ambiguous, return false.
- If two dishes are easy to confuse, use the review snippets and aliases carefully.

Return one assessment object per candidate with:
- canonicalName
- mostMentioned
- highlyPraised
- likelyFavorite
- confidence: low | medium | high
- reason: short explanation, or null

Return JSON only.
`.trim();

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("popularDishes.ts is server-only. Call it from a backend route or server function.");
  }
}

function getFoursquareApiKey(providedApiKey?: string): string {
  const apiKey = providedApiKey ?? process.env.FOURSQUARE_API_KEY ?? process.env.FSQ_API_KEY;

  if (!apiKey) {
    throw new Error("Missing FOURSQUARE_API_KEY. Add it to .env.local on the server.");
  }

  return apiKey;
}

function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY ?? null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function singularizeToken(token: string): string | null {
  if (token.length <= 3) {
    return null;
  }

  if (token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("es")) {
    return token.slice(0, -2);
  }

  if (token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return null;
}

function pluralizeToken(token: string): string | null {
  if (token.length <= 3 || token.endsWith("s")) {
    return null;
  }

  if (token.endsWith("y")) {
    return `${token.slice(0, -1)}ies`;
  }

  return `${token}s`;
}

function buildAliasVariants(name: string | null | undefined): string[] {
  if (!name) {
    return [];
  }

  const baseAlias = normalizeText(name.replace(/^Translated:\s*/i, ""));
  if (!baseAlias) {
    return [];
  }

  const aliases = new Set<string>([baseAlias]);
  const tokens = baseAlias.split(" ");

  if (tokens.length >= 1) {
    const lastToken = tokens[tokens.length - 1];
    const singularLastToken = singularizeToken(lastToken);
    const pluralLastToken = pluralizeToken(lastToken);

    if (singularLastToken) {
      aliases.add([...tokens.slice(0, -1), singularLastToken].join(" "));
    }

    if (pluralLastToken) {
      aliases.add([...tokens.slice(0, -1), pluralLastToken].join(" "));
    }
  }

  return [...aliases].filter((alias) => alias.length >= 3);
}

function getCanonicalDishName(item: ParsedMenuItem): string {
  return item.nameEnglish?.replace(/^Translated:\s*/i, "") ?? item.nameOriginal;
}

function buildDishAliases(item: ParsedMenuItem): string[] {
  const aliases = new Set<string>();

  for (const alias of buildAliasVariants(item.nameOriginal)) {
    aliases.add(alias);
  }

  for (const alias of buildAliasVariants(item.nameEnglish)) {
    aliases.add(alias);
  }

  return [...aliases].sort((left, right) => right.length - left.length);
}

function containsWholePhrase(text: string, phrase: string): boolean {
  return (` ${text} `).includes(` ${phrase} `);
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
}

function stringSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  const distance = levenshteinDistance(left, right);
  return 1 - (distance / Math.max(left.length, right.length));
}

function findAliasMatch(text: string, tokens: string[], aliases: string[]) {
  for (const alias of aliases) {
    if (containsWholePhrase(text, alias)) {
      return {
        alias,
        matchType: "exact" as const,
        confidence: 1,
      };
    }
  }

  let bestMatch:
    | {
      alias: string;
      matchType: DishMentionMatchType;
      confidence: number;
    }
    | null = null;

  for (const alias of aliases) {
    const aliasTokens = alias.split(" ");

    if (aliasTokens.length === 1) {
      for (const token of tokens) {
        const similarity = stringSimilarity(token, alias);

        if (similarity >= 0.89 && (!bestMatch || similarity > bestMatch.confidence)) {
          bestMatch = {
            alias,
            matchType: "close",
            confidence: similarity,
          };
        }
      }

      continue;
    }

    for (let index = 0; index <= tokens.length - aliasTokens.length; index += 1) {
      const candidate = tokens.slice(index, index + aliasTokens.length).join(" ");
      const similarity = stringSimilarity(candidate, alias);

      if (similarity >= 0.84 && (!bestMatch || similarity > bestMatch.confidence)) {
        bestMatch = {
          alias,
          matchType: "close",
          confidence: similarity,
        };
      }
    }
  }

  return bestMatch;
}

function scoreSentiment(text: string): number {
  let score = 0;

  for (const [phrase, weight] of POSITIVE_HINTS) {
    if (containsWholePhrase(text, phrase)) {
      score += weight;
    }
  }

  for (const [phrase, weight] of NEGATIVE_HINTS) {
    if (containsWholePhrase(text, phrase)) {
      score += weight;
    }
  }

  if (text.includes("!")) {
    score += 0.25;
  }

  return Number(score.toFixed(2));
}

async function defaultRefinePopularDishesWithGemini(
  input: PopularDishesRefinerInput,
): Promise<DishPopularityAiAssessment[] | null> {
  assertServerOnly();

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  const candidates = input.dishes
    .filter((dish) => dish.mentions > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(input.maxBuckets * 2, 6))
    .map((dish) => ({
      canonicalName: dish.canonicalName,
      nameOriginal: dish.menuItem.nameOriginal,
      nameEnglish: dish.menuItem.nameEnglish,
      mentions: dish.mentions,
      positiveMentions: dish.positiveMentions,
      negativeMentions: dish.negativeMentions,
      netSentiment: dish.netSentiment,
      score: dish.score,
      matchedAliases: dish.matchedAliases,
      evidence: dish.evidence.slice(0, 4).map((entry) => ({
        matchedAlias: entry.matchedAlias,
        matchType: entry.matchType,
        sentimentScore: entry.sentimentScore,
        text: entry.text,
      })),
    }));

  if (candidates.length === 0) {
    return null;
  }

  const { GoogleGenAI, Type } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        text: `${POPULAR_DISHES_REFINEMENT_PROMPT}

Restaurant:
${JSON.stringify({
  restaurantName: input.restaurantName,
  near: input.near ?? null,
}, null, 2)}

Candidates:
${JSON.stringify(candidates, null, 2)}`,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            canonicalName: { type: Type.STRING },
            mostMentioned: { type: Type.BOOLEAN },
            highlyPraised: { type: Type.BOOLEAN },
            likelyFavorite: { type: Type.BOOLEAN },
            confidence: { type: Type.STRING },
            reason: { type: Type.STRING, nullable: true },
          },
          required: [
            "canonicalName",
            "mostMentioned",
            "highlyPraised",
            "likelyFavorite",
            "confidence",
            "reason",
          ],
          propertyOrdering: [
            "canonicalName",
            "mostMentioned",
            "highlyPraised",
            "likelyFavorite",
            "confidence",
            "reason",
          ],
        },
      },
    },
  });

  const text = response.text;
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return popularDishesAiAssessmentSchema.parse(parsed);
  } catch {
    return null;
  }
}

function mergeBucketWithAi(
  heuristicBucket: DishPopularityEntry[],
  field: "mostMentioned" | "highlyPraised" | "likelyFavorite",
  maxBuckets: number,
): DishPopularityEntry[] {
  const aiApproved = heuristicBucket.filter((entry) => entry.aiAssessment?.[field]);

  if (aiApproved.length === 0) {
    return heuristicBucket.slice(0, maxBuckets);
  }

  const merged = [
    ...aiApproved,
    ...heuristicBucket.filter((entry) => !aiApproved.includes(entry)),
  ];

  return merged.slice(0, maxBuckets);
}

export function analyzeDishPopularity(
  menuItems: ParsedMenuItem[],
  documents: ReviewDocument[],
  maxBuckets = 5,
): DishPopularityAnalysis {
  const scoredDishes = menuItems.map((menuItem) => ({
    menuItem,
    canonicalName: getCanonicalDishName(menuItem),
    aliases: buildDishAliases(menuItem),
    matchedAliases: new Set<string>(),
    mentions: 0,
    positiveMentions: 0,
    negativeMentions: 0,
    netSentiment: 0,
    evidence: [] as DishMentionEvidence[],
  }));

  for (const document of documents) {
    const normalizedText = normalizeText(document.text);
    if (!normalizedText) {
      continue;
    }

    const tokens = tokenize(document.text);
    const sentimentScore = scoreSentiment(normalizedText);
    const documentMatches = scoredDishes
      .map((dish, dishIndex) => {
        const match = findAliasMatch(normalizedText, tokens, dish.aliases);
        if (!match) {
          return null;
        }

        return {
          dishIndex,
          ...match,
        };
      })
      .filter((entry): entry is {
        dishIndex: number;
        alias: string;
        matchType: DishMentionMatchType;
        confidence: number;
      } => entry !== null)
      .sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence;
        }

        if (right.alias.length !== left.alias.length) {
          return right.alias.length - left.alias.length;
        }

        if (left.matchType !== right.matchType) {
          return left.matchType === "exact" ? -1 : 1;
        }

        return 0;
      });

    const usedDishIndexes = new Set<number>();

    for (const match of documentMatches) {
      if (usedDishIndexes.has(match.dishIndex)) {
        continue;
      }

      const dish = scoredDishes[match.dishIndex];

      dish.mentions += 1;
      dish.netSentiment = Number((dish.netSentiment + sentimentScore).toFixed(2));
      if (sentimentScore > 0.4) {
        dish.positiveMentions += 1;
      } else if (sentimentScore < -0.4) {
        dish.negativeMentions += 1;
      }

      dish.matchedAliases.add(match.alias);
      dish.evidence.push({
        documentId: document.id,
        source: document.source,
        matchedAlias: match.alias,
        matchType: match.matchType,
        sentimentScore,
        text: document.text,
      });
      usedDishIndexes.add(match.dishIndex);
    }
  }

  const dishes: DishPopularityEntry[] = scoredDishes.map((dish) => {
    const score = Number((
      (dish.mentions * 1.25)
      + (dish.positiveMentions * 1.75)
      - (dish.negativeMentions * 1.25)
      + dish.netSentiment
    ).toFixed(2));

    return {
      menuItem: dish.menuItem,
      canonicalName: dish.canonicalName,
      mentions: dish.mentions,
      positiveMentions: dish.positiveMentions,
      negativeMentions: dish.negativeMentions,
      netSentiment: Number(dish.netSentiment.toFixed(2)),
      score,
      matchedAliases: [...dish.matchedAliases].sort(),
      evidence: dish.evidence,
      aiAssessment: null,
    };
  });

  const mentionedDishes = dishes.filter((dish) => dish.mentions > 0);
  const compareByMentions = (left: DishPopularityEntry, right: DishPopularityEntry) => {
    if (right.mentions !== left.mentions) {
      return right.mentions - left.mentions;
    }

    if (right.positiveMentions !== left.positiveMentions) {
      return right.positiveMentions - left.positiveMentions;
    }

    return right.score - left.score;
  };

  const compareByPraise = (left: DishPopularityEntry, right: DishPopularityEntry) => {
    const leftPraiseRatio = left.mentions === 0 ? 0 : left.positiveMentions / left.mentions;
    const rightPraiseRatio = right.mentions === 0 ? 0 : right.positiveMentions / right.mentions;

    if (rightPraiseRatio !== leftPraiseRatio) {
      return rightPraiseRatio - leftPraiseRatio;
    }

    if (right.netSentiment !== left.netSentiment) {
      return right.netSentiment - left.netSentiment;
    }

    return right.mentions - left.mentions;
  };

  const compareByFavorites = (left: DishPopularityEntry, right: DishPopularityEntry) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return right.mentions - left.mentions;
  };

  return {
    dishes: dishes.sort(compareByFavorites),
    buckets: {
      mostMentioned: [...mentionedDishes].sort(compareByMentions).slice(0, maxBuckets),
      highlyPraised: [...mentionedDishes]
        .filter((dish) => dish.positiveMentions > 0)
        .sort(compareByPraise)
        .slice(0, maxBuckets),
      likelyFavorites: [...mentionedDishes].sort(compareByFavorites).slice(0, maxBuckets),
    },
    documentsAnalyzed: documents.length,
    aiRefinementApplied: false,
  };
}

function scorePlaceCandidate(
  candidate: FoursquarePlace,
  restaurantName: string,
  near?: string,
): number {
  const normalizedQuery = normalizeText(restaurantName);
  const normalizedCandidateName = normalizeText(candidate.name);
  const queryTokens = new Set(tokenize(restaurantName));
  const candidateTokens = new Set(tokenize(candidate.name));
  let score = 0;

  if (normalizedCandidateName === normalizedQuery) {
    score += 5;
  } else if (normalizedCandidateName.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidateName)) {
    score += 3;
  }

  let overlappingTokens = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlappingTokens += 1;
    }
  }

  score += overlappingTokens * 0.8;

  if (near) {
    const normalizedNear = normalizeText(near);
    const placeLocation = normalizeText([
      candidate.formattedAddress,
      candidate.locality,
      candidate.region,
      candidate.country,
    ].filter(Boolean).join(" "));

    if (placeLocation.includes(normalizedNear)) {
      score += 1.5;
    }
  }

  if (candidate.categories.some((category) => normalizeText(category).includes("restaurant"))) {
    score += 0.5;
  }

  if (typeof candidate.distance === "number") {
    score -= Math.min(candidate.distance / 1000, 2.5);
  }

  return score;
}

function mapFoursquarePlace(result: z.infer<typeof foursquareSearchResponseSchema>["results"][number]): FoursquarePlace {
  return {
    fsqId: result.fsq_id ?? result.fsq_place_id ?? "",
    name: result.name,
    formattedAddress: result.location?.formatted_address ?? null,
    locality: result.location?.locality ?? null,
    region: result.location?.region ?? null,
    country: result.location?.country ?? null,
    categories: (result.categories ?? [])
      .map((category) => category.name ?? "")
      .filter((category) => category.length > 0),
    distance: typeof result.distance === "number" ? result.distance : null,
  };
}

async function foursquareGetJson<T>(
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
    throw new Error(`Foursquare request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

export async function findRestaurantOnFoursquare(
  restaurantName: string,
  options: {
    near?: string;
    ll?: string;
    limit?: number;
    apiKey?: string;
    fetchImpl?: FetchLike;
  } = {},
): Promise<FoursquarePlace> {
  assertServerOnly();

  const apiKey = getFoursquareApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const queryParams = new URLSearchParams({
    query: restaurantName,
    limit: String(options.limit ?? 10),
  });

  if (options.near) {
    queryParams.set("near", options.near);
  } else if (options.ll) {
    queryParams.set("ll", options.ll);
  }

  const response = await foursquareGetJson<unknown>(
    `https://api.foursquare.com/v3/places/search?${queryParams.toString()}`,
    apiKey,
    fetchImpl,
  );
  const parsedResponse = foursquareSearchResponseSchema.parse(response);
  const candidates = parsedResponse.results.map(mapFoursquarePlace).filter((candidate) => candidate.fsqId.length > 0);

  if (candidates.length === 0) {
    throw new Error(`No Foursquare place found for "${restaurantName}".`);
  }

  return [...candidates]
    .sort((left, right) => scorePlaceCandidate(right, restaurantName, options.near) - scorePlaceCandidate(left, restaurantName, options.near))[0];
}

export async function getFoursquarePlaceTips(
  fsqId: string,
  options: {
    limit?: number;
    apiKey?: string;
    fetchImpl?: FetchLike;
  } = {},
): Promise<ReviewDocument[]> {
  assertServerOnly();

  const apiKey = getFoursquareApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const queryParams = new URLSearchParams({
    limit: String(options.limit ?? 50),
  });

  const response = await foursquareGetJson<unknown>(
    `https://api.foursquare.com/v3/places/${fsqId}/tips?${queryParams.toString()}`,
    apiKey,
    fetchImpl,
  );
  const tips = foursquareTipsResponseSchema.parse(response);

  return tips
    .map((tip, index) => ({
      id: tip.id ?? `tip-${index}`,
      source: "foursquare_tip" as const,
      text: tip.text ?? "",
    }))
    .filter((tip) => tip.text.trim().length > 0);
}

export async function findPopularDishesFromFoursquare(
  input: FindPopularDishesInput,
  options: {
    apiKey?: string;
    fetchImpl?: FetchLike;
    searchLimit?: number;
    tipLimit?: number;
    maxBuckets?: number;
    refineWithAi?: PopularDishesRefiner;
  } = {},
) {
  const restaurant = await findRestaurantOnFoursquare(input.restaurantName, {
    near: input.near,
    ll: input.ll,
    limit: options.searchLimit,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  });
  const tips = await getFoursquarePlaceTips(restaurant.fsqId, {
    limit: options.tipLimit,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  });
  const maxBuckets = options.maxBuckets ?? 5;
  const analysis = analyzeDishPopularity(input.menuItems, tips, maxBuckets);
  const aiAssessments = await (options.refineWithAi ?? defaultRefinePopularDishesWithGemini)({
    restaurantName: input.restaurantName,
    near: input.near,
    dishes: analysis.dishes,
    maxBuckets,
  });
  const assessmentByDish = new Map(
    (aiAssessments ?? []).map((assessment) => [normalizeText(assessment.canonicalName), assessment]),
  );
  const dishes = analysis.dishes.map((dish) => ({
    ...dish,
    aiAssessment: assessmentByDish.get(normalizeText(dish.canonicalName)) ?? null,
  }));

  return {
    provider: "foursquare" as const,
    restaurant,
    documentsAnalyzed: analysis.documentsAnalyzed,
    aiRefinementApplied: (aiAssessments?.length ?? 0) > 0,
    dishes,
    buckets: {
      mostMentioned: mergeBucketWithAi(
        dishes
          .filter((dish) => dish.mentions > 0)
          .sort((left, right) => {
            if (right.mentions !== left.mentions) {
              return right.mentions - left.mentions;
            }

            if (right.positiveMentions !== left.positiveMentions) {
              return right.positiveMentions - left.positiveMentions;
            }

            return right.score - left.score;
          }),
        "mostMentioned",
        maxBuckets,
      ),
      highlyPraised: mergeBucketWithAi(
        dishes
          .filter((dish) => dish.mentions > 0 && dish.positiveMentions > 0)
          .sort((left, right) => {
            const leftPraiseRatio = left.mentions === 0 ? 0 : left.positiveMentions / left.mentions;
            const rightPraiseRatio = right.mentions === 0 ? 0 : right.positiveMentions / right.mentions;

            if (rightPraiseRatio !== leftPraiseRatio) {
              return rightPraiseRatio - leftPraiseRatio;
            }

            if (right.netSentiment !== left.netSentiment) {
              return right.netSentiment - left.netSentiment;
            }

            return right.mentions - left.mentions;
          }),
        "highlyPraised",
        maxBuckets,
      ),
      likelyFavorites: mergeBucketWithAi(
        [...dishes]
          .filter((dish) => dish.mentions > 0)
          .sort((left, right) => {
            if (right.score !== left.score) {
              return right.score - left.score;
            }

            return right.mentions - left.mentions;
          }),
        "likelyFavorite",
        maxBuckets,
      ),
    },
  };
}
