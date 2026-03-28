import test from "node:test";
import assert from "node:assert/strict";

import { generateCartSpeech } from "../cartSpeech.ts";

const originalElevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const originalElevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
const originalElevenLabsModelId = process.env.ELEVENLABS_MODEL_ID;

function restoreEnv() {
  if (originalElevenLabsApiKey === undefined) {
    delete process.env.ELEVENLABS_API_KEY;
  } else {
    process.env.ELEVENLABS_API_KEY = originalElevenLabsApiKey;
  }

  if (originalElevenLabsVoiceId === undefined) {
    delete process.env.ELEVENLABS_VOICE_ID;
  } else {
    process.env.ELEVENLABS_VOICE_ID = originalElevenLabsVoiceId;
  }

  if (originalElevenLabsModelId === undefined) {
    delete process.env.ELEVENLABS_MODEL_ID;
  } else {
    process.env.ELEVENLABS_MODEL_ID = originalElevenLabsModelId;
  }
}

test("generateCartSpeech uses the configured ElevenLabs voice id", async () => {
  try {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    process.env.ELEVENLABS_VOICE_ID = "voice-123";
    process.env.ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

    const requests = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        init,
      });

      return new Response(Buffer.from("fake-audio"), {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
        },
      });
    };

    const result = await generateCartSpeech({
      languageCode: "es",
      languageLabel: "Spanish",
      items: [
        {
          name: "Mozzarella Sticks",
          originalName: "Mozzarella Sticks",
          alternateName: null,
          price: "$7.99",
          quantity: 2,
        },
      ],
    }, {
      composeOrderScript: async () => "Me gustaria pedir dos porciones de mozzarella sticks.",
      fetchImpl,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.elevenlabs.io/v1/text-to-speech/voice-123");
    assert.equal(result.voiceId, "voice-123");
    assert.equal(result.script, "Me gustaria pedir dos porciones de mozzarella sticks.");
    assert.equal(result.audioBase64, Buffer.from("fake-audio").toString("base64"));

    const requestBody = JSON.parse(String(requests[0].init?.body));
    assert.equal(requestBody.language_code, "es");
    assert.equal(requestBody.model_id, "eleven_flash_v2_5");
  } finally {
    restoreEnv();
  }
});

test("generateCartSpeech looks up a default ElevenLabs voice when none is configured", async () => {
  try {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    delete process.env.ELEVENLABS_VOICE_ID;
    delete process.env.ELEVENLABS_MODEL_ID;

    const requests = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });

      if (url.startsWith("https://api.elevenlabs.io/v2/voices")) {
        return Response.json({
          voices: [{ voice_id: "default-voice-999" }],
        });
      }

      return new Response(Buffer.from("auto-voice-audio"), {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
        },
      });
    };

    const result = await generateCartSpeech({
      languageCode: "fr",
      languageLabel: "French",
      items: [
        {
          name: "Pad Thai",
          originalName: "Pad Thai",
          alternateName: null,
          price: null,
          quantity: 1,
        },
      ],
    }, {
      composeOrderScript: async () => "Je voudrais commander un pad thai.",
      fetchImpl,
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://api.elevenlabs.io/v2/voices?voice_type=default&page_size=1");
    assert.equal(requests[1].url, "https://api.elevenlabs.io/v1/text-to-speech/default-voice-999");
    assert.equal(result.voiceId, "default-voice-999");

    const requestBody = JSON.parse(String(requests[1].init?.body));
    assert.equal(requestBody.model_id, "eleven_flash_v2_5");
    assert.equal(requestBody.language_code, "fr");
  } finally {
    restoreEnv();
  }
});
