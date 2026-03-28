import { z } from "zod";

export const cartSpeechItemSchema = z.object({
  name: z.string().min(1),
  originalName: z.string().nullable().optional(),
  alternateName: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
});

export const cartSpeechRequestSchema = z.object({
  languageCode: z.string().min(2),
  languageLabel: z.string().min(1),
  items: z.array(cartSpeechItemSchema).min(1),
});

export type CartSpeechItem = z.infer<typeof cartSpeechItemSchema>;
export type CartSpeechRequest = z.infer<typeof cartSpeechRequestSchema>;

type ComposeCartOrderScript = (request: CartSpeechRequest) => Promise<string>;

type GenerateCartSpeechOptions = {
  composeOrderScript?: ComposeCartOrderScript;
  fetchImpl?: typeof fetch;
};

type ElevenLabsVoiceListResponse = {
  voices?: Array<{
    voice_id?: string;
  }>;
};

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY.");
  }
  return apiKey;
}

function getElevenLabsApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY.");
  }
  return apiKey;
}

async function createGeminiClient() {
  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey: getGeminiApiKey() });
}

function buildCartOrderPrompt({ items, languageCode, languageLabel }: CartSpeechRequest): string {
  const normalizedItems = items.map((item) => ({
    quantity: item.quantity,
    name: item.name,
    originalName: item.originalName ?? null,
    alternateName: item.alternateName ?? null,
    price: item.price ?? null,
  }));

  return `
You are helping a restaurant guest say their order out loud naturally.

Write a short spoken ordering script in ${languageLabel} (${languageCode}).

Rules:
- Return only plain spoken text in ${languageLabel}.
- Mention the quantities and dishes clearly.
- Keep it concise and natural, like someone politely ordering at a restaurant.
- Do not use bullet points, numbering, labels, quotation marks, or markdown.
- Do not add dishes that are not in the cart.
- Always use the original menu-language dish name when one is provided in originalName.
- Do not replace originalName with its English translation.
- If alternateName or name is present, treat them only as background context to understand the dish, not as the spoken dish name.
- If a dish name is a proper noun or should stay in its original language, keep it natural.
- Prices are optional. Only mention them if it sounds natural in the target language.

Cart:
${JSON.stringify(normalizedItems, null, 2)}
  `.trim();
}

export async function composeCartOrderScript(request: CartSpeechRequest): Promise<string> {
  const ai = await createGeminiClient();
  const prompt = buildCartOrderPrompt(request);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ text: prompt }],
  });

  const script = response.text?.trim();

  if (!script) {
    throw new Error("Gemini returned an empty cart speech response.");
  }

  return script;
}

async function resolveElevenLabsVoiceId(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const configuredVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (configuredVoiceId) {
    return configuredVoiceId;
  }

  const voicesResponse = await fetchImpl("https://api.elevenlabs.io/v2/voices?voice_type=default&page_size=1", {
    headers: {
      "xi-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (!voicesResponse.ok) {
    const message = await voicesResponse.text();
    throw new Error(`Could not fetch ElevenLabs voices (${voicesResponse.status}): ${message || "Unknown error."}`);
  }

  const payload = (await voicesResponse.json()) as ElevenLabsVoiceListResponse;
  const voiceId = payload.voices?.[0]?.voice_id?.trim();

  if (!voiceId) {
    throw new Error("No ElevenLabs voice is available. Set ELEVENLABS_VOICE_ID in .env.local.");
  }

  return voiceId;
}

function getElevenLabsModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_flash_v2_5";
}

export async function generateCartSpeech(
  request: CartSpeechRequest,
  options: GenerateCartSpeechOptions = {},
): Promise<{
  audioBase64: string;
  mimeType: string;
  script: string;
  voiceId: string;
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const composeOrderScript = options.composeOrderScript ?? composeCartOrderScript;
  const apiKey = getElevenLabsApiKey();
  const voiceId = await resolveElevenLabsVoiceId(apiKey, fetchImpl);
  const script = await composeOrderScript(request);

  const speechResponse = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: script,
      model_id: getElevenLabsModelId(),
      language_code: request.languageCode,
    }),
  });

  if (!speechResponse.ok) {
    const message = await speechResponse.text();
    throw new Error(`ElevenLabs request failed (${speechResponse.status}): ${message || "Unknown error."}`);
  }

  const mimeType = speechResponse.headers.get("content-type")?.split(";")[0] || "audio/mpeg";
  const audioBytes = Buffer.from(await speechResponse.arrayBuffer());

  return {
    audioBase64: audioBytes.toString("base64"),
    mimeType,
    script,
    voiceId,
  };
}
