import fs from "node:fs/promises";

export type ParsedMenuItem = {
  nameOriginal: string;
  nameEnglish: string | null;
  price: string | null;
  description: string | null;
  allergens: string[] | null;
};

export type SupportedMenuImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type ParseMenuImageBytesInput = {
  bytes: Buffer;
  mimeType: SupportedMenuImageMimeType;
};

export type MenuContentGeneratorInput = {
  imageBase64: string;
  mimeType: SupportedMenuImageMimeType;
};

export type MenuContentGeneratorResult = {
  text?: string | null;
};

export type MenuContentGenerator = (
  input: MenuContentGeneratorInput,
) => Promise<MenuContentGeneratorResult>;

export type MissingDescriptionCandidate = {
  itemKey: string;
  nameOriginal: string;
  nameEnglish: string | null;
  price: string | null;
};

export type MissingDescriptionResult = {
  itemKey: string;
  description: string | null;
};

export type MissingDescriptionGenerator = (
  items: MissingDescriptionCandidate[],
) => Promise<MissingDescriptionResult[]>;

export type ParseMenuImageOptions = {
  generateMenuContent?: MenuContentGenerator;
  generateMissingDescriptions?: MissingDescriptionGenerator;
};

const MENU_PARSER_PROMPT = `
You are parsing a restaurant menu image.

Extract every dish/menu item that appears on the menu.

For each item, return:
- nameOriginal: the item name exactly as shown, preserving original language if possible
- nameEnglish: if the item name is not already English and translation is reasonably possible, return it in this exact format: "Translated: {English translation}"; otherwise null
- price: the displayed price as a string, or null if not visible
- description: a single final, user-facing English description following these rules:
  - if the menu already has a clear, strong English description, copy it exactly and do not rewrite it
  - if the menu description is in another language, translate it to English and return it in this exact format: "Translated: {English translation}"
  - if the menu description is missing, generate a short one-line English description based on the dish name and common preparation
  - if the menu description exists but is sparse, awkward, vague, or confusing, rewrite it into a clearer one-line English description
- allergens: an array of allergen strings ONLY if the menu explicitly states them for that item (e.g. "contains nuts", "GF", "V", allergen icons with labels, etc). Return null if the menu does not explicitly call out allergens for this item. Do NOT infer allergens from ingredients — only report what is visibly stated on the menu.

Important rules:
- Return ONLY actual menu items, not section headers.
- Keep the original-language name only in nameOriginal. Do not put the translation into nameOriginal.
- If a description is already strong and clear, do not rewrite it.
- Keep description as the only description field. Do not return separate original or translated description fields.
- Generated or enhanced descriptions should stay short, factual, and not invent specific ingredients unless they are strongly implied by the dish name or menu text.
- Never invent prices.
- Do not make up original menu text for nameOriginal.
- You MAY generate or improve description, using the rules above.
- If you are too uncertain to write a short factual description, return null instead of guessing.
- Do not merge multiple dishes into one.
- If an item is duplicated, include it only once unless it clearly appears as separate menu entries.
- If text is unclear, do your best but do not hallucinate details.
- If translation is uncertain, prefer null over guessing.
- For allergens, only include what is explicitly printed on the menu. Never guess or infer.
- Return JSON only.
`.trim();

const MISSING_DESCRIPTION_PROMPT = `
You are writing short, user-facing English menu descriptions for dishes whose menu descriptions are missing.

You will receive menu items with:
- itemKey
- nameOriginal
- nameEnglish
- price

For each item, return:
- itemKey
- description

Description rules:
- Write a single short English sentence suitable for a restaurant menu.
- Base it on the dish name and broad culinary knowledge.
- If the dish is common or recognizable, provide a helpful description.
- If the English name is available, use it to understand the dish, but do not repeat "Translated:" in the description.
- Keep it factual and concise.
- Do not invent a price.
- Do not claim very specific ingredients unless they are strongly implied by the dish name.
- Prefer a safe, generic description over an overconfident one.
- Return null only if the dish name is too unclear to understand.

Examples:
- Mozzarella Sticks -> "Breaded mozzarella sticks fried until crisp and served hot and cheesy."
- Calamares -> "Tender squid, often lightly fried and served as a savory seafood starter."
- Gyoza -> "Pan-seared dumplings with a savory filling and a crisp, golden bottom."

Return JSON only.
`.trim();

function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("menuParser.ts is server-only. Call it from a backend route or server function.");
  }
}

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it to .env.local on the server.");
  }

  return apiKey;
}

async function createGeminiClient() {
  assertServerOnly();

  const { GoogleGenAI, Type } = await import("@google/genai");

  return {
    Type,
    ai: new GoogleGenAI({
      apiKey: getGeminiApiKey(),
    }),
  };
}

async function defaultGenerateMenuContent({
  imageBase64,
  mimeType,
}: MenuContentGeneratorInput): Promise<MenuContentGeneratorResult> {
  const { ai, Type } = await createGeminiClient();

  return ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      },
      {
        text: MENU_PARSER_PROMPT,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            nameOriginal: { type: Type.STRING },
            nameEnglish: { type: Type.STRING, nullable: true },
            price: { type: Type.STRING, nullable: true },
            description: { type: Type.STRING, nullable: true },
            allergens: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              nullable: true,
            },
          },
          required: [
            "nameOriginal",
            "nameEnglish",
            "price",
            "description",
            "allergens",
          ],
          propertyOrdering: [
            "nameOriginal",
            "nameEnglish",
            "price",
            "description",
            "allergens",
          ],
        },
      },
    },
  });
}

function getNameForDescriptionContext(item: Pick<ParsedMenuItem, "nameOriginal" | "nameEnglish">): string {
  const normalizedEnglishName = normalizeOptionalString(item.nameEnglish);

  if (normalizedEnglishName) {
    return normalizedEnglishName.replace(/^Translated:\s*/i, "");
  }

  return item.nameOriginal;
}

async function defaultGenerateMissingDescriptions(
  items: MissingDescriptionCandidate[],
): Promise<MissingDescriptionResult[]> {
  if (items.length === 0) {
    return [];
  }

  const { ai, Type } = await createGeminiClient();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        text: `${MISSING_DESCRIPTION_PROMPT}

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
            description: { type: Type.STRING, nullable: true },
          },
          required: ["itemKey", "description"],
          propertyOrdering: ["itemKey", "description"],
        },
      },
    },
  });

  const text = response.text;
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as MissingDescriptionResult[];
  } catch {
    return [];
  }
}

function getMimeType(filePath: string): SupportedMenuImageMimeType {
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";

  throw new Error("Unsupported image type. Use PNG, JPG, JPEG, or WEBP.");
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAllergens(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const cleaned = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  return cleaned.length > 0 ? cleaned : null;
}

function formatTranslatedName(nameEnglish: string | null): string | null {
  const normalizedName = normalizeOptionalString(nameEnglish);

  if (!normalizedName) {
    return null;
  }

  if (/^translated:\s*/i.test(normalizedName)) {
    return normalizedName.replace(/^translated:\s*/i, "Translated: ");
  }

  return `Translated: ${normalizedName}`;
}

function formatFinalDescription(description: string | null): string | null {
  const normalizedDescription = normalizeOptionalString(description);

  if (!normalizedDescription) {
    return null;
  }

  if (/^translated:\s*/i.test(normalizedDescription)) {
    return normalizedDescription.replace(/^translated:\s*/i, "Translated: ");
  }

  return normalizedDescription;
}

function normalizeParsedMenuItem(item: ParsedMenuItem): ParsedMenuItem {
  return {
    nameOriginal: item.nameOriginal.trim(),
    nameEnglish: formatTranslatedName(item.nameEnglish),
    price: normalizeOptionalString(item.price),
    description: formatFinalDescription(item.description),
    allergens: normalizeAllergens(item.allergens),
  };
}

async function fillMissingDescriptions(
  items: ParsedMenuItem[],
  generateMissingDescriptions: MissingDescriptionGenerator,
): Promise<ParsedMenuItem[]> {
  const missingItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.description === null)
    .map(({ item, index }) => ({
      itemKey: String(index),
      nameOriginal: item.nameOriginal,
      nameEnglish: getNameForDescriptionContext(item),
      price: item.price,
    }));

  if (missingItems.length === 0) {
    return items;
  }

  const generatedDescriptions = await generateMissingDescriptions(missingItems);
  const descriptionsByKey = new Map(
    generatedDescriptions.map((entry) => [entry.itemKey, formatFinalDescription(entry.description)]),
  );

  return items.map((item, index) => ({
    ...item,
    description: item.description ?? descriptionsByKey.get(String(index)) ?? null,
  }));
}

export async function parseMenuImageBytes({
  bytes,
  mimeType,
}: ParseMenuImageBytesInput, options: ParseMenuImageOptions = {}): Promise<ParsedMenuItem[]> {
  const response = await (options.generateMenuContent ?? defaultGenerateMenuContent)({
    imageBase64: bytes.toString("base64"),
    mimeType,
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini did not return valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected an array of menu items.");
  }

  const normalizedItems = (parsed as ParsedMenuItem[]).map(normalizeParsedMenuItem);

  return fillMissingDescriptions(
    normalizedItems,
    options.generateMissingDescriptions ?? defaultGenerateMissingDescriptions,
  );
}

export async function parseMenuImage(
  filePath: string,
  options: ParseMenuImageOptions = {},
): Promise<ParsedMenuItem[]> {
  const imageBytes = await fs.readFile(filePath);
  const mimeType = getMimeType(filePath);

  return parseMenuImageBytes({
    bytes: imageBytes,
    mimeType,
  }, options);
}