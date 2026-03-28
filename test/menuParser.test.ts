import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseMenuImage, parseMenuImageBytes } from "../menuParser.ts";

test("parseMenuImageBytes returns parsed items from the injected generator", async () => {
  let seenMimeType: string | null = null;
  let seenBase64: string | null = null;

  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async ({ imageBase64, mimeType }) => {
        seenBase64 = imageBase64;
        seenMimeType = mimeType;

        return {
          text: JSON.stringify([
            {
              nameOriginal: "Pollo alla cacciatora",
              nameEnglish: "Hunter-style chicken",
              price: "$14",
              description: "translated: Braised chicken with tomato and herbs",
            },
          ]),
        };
      },
    },
  );

  assert.equal(seenMimeType, "image/png");
  assert.equal(seenBase64, Buffer.from("fake-image-bytes").toString("base64"));
  assert.deepEqual(items, [
    {
      nameOriginal: "Pollo alla cacciatora",
      nameEnglish: "Translated: Hunter-style chicken",
      price: "$14",
      description: "Translated: Braised chicken with tomato and herbs",
    },
  ]);
});

test("parseMenuImageBytes preserves an existing translated label format", async () => {
  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async () => ({
        text: JSON.stringify([
          {
            nameOriginal: "饺子",
            nameEnglish: "translated: dumplings",
            price: null,
            description: "translated: pork and napa cabbage filling",
          },
        ]),
      }),
    },
  );

  assert.deepEqual(items, [
    {
      nameOriginal: "饺子",
      nameEnglish: "Translated: dumplings",
      price: null,
      description: "Translated: pork and napa cabbage filling",
    },
  ]);
});

test("parseMenuImageBytes keeps an English description without a translated label", async () => {
  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async () => ({
        text: JSON.stringify([
          {
            nameOriginal: "Caesar Salad",
            nameEnglish: null,
            price: "$11",
            description: "Romaine, parmesan, croutons, house dressing",
          },
        ]),
      }),
    },
  );

  assert.deepEqual(items, [
    {
      nameOriginal: "Caesar Salad",
      nameEnglish: null,
      price: "$11",
      description: "Romaine, parmesan, croutons, house dressing",
    },
  ]);
});

test("parseMenuImageBytes keeps a strong description and leaves it untouched", async () => {
  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async () => ({
        text: JSON.stringify([
          {
            nameOriginal: "Margherita Pizza",
            nameEnglish: null,
            price: "$18",
            description: "San Marzano tomato sauce, fresh mozzarella, basil, and olive oil",
          },
        ]),
      }),
    },
  );

  assert.deepEqual(items, [
    {
      nameOriginal: "Margherita Pizza",
      nameEnglish: null,
      price: "$18",
      description: "San Marzano tomato sauce, fresh mozzarella, basil, and olive oil",
    },
  ]);
});

test("parseMenuImageBytes supports generated descriptions when the menu has none", async () => {
  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async () => ({
        text: JSON.stringify([
          {
            nameOriginal: "Mozzarella Sticks",
            nameEnglish: null,
            price: "$9",
            description: null,
          },
        ]),
      }),
      generateMissingDescriptions: async () => ([
        {
          itemKey: "0",
          description: "Breaded mozzarella sticks fried until crisp and served hot and cheesy.",
        },
      ]),
    },
  );

  assert.deepEqual(items, [
    {
      nameOriginal: "Mozzarella Sticks",
      nameEnglish: null,
      price: "$9",
      description: "Breaded mozzarella sticks fried until crisp and served hot and cheesy.",
    },
  ]);
});

test("parseMenuImageBytes supports enhanced descriptions for confusing menu text", async () => {
  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async () => ({
        text: JSON.stringify([
          {
            nameOriginal: "House Noodles",
            nameEnglish: null,
            price: "$16",
            description: "Stir-fried house noodles with a mix of the chef's special ingredients.",
          },
        ]),
      }),
    },
  );

  assert.deepEqual(items, [
    {
      nameOriginal: "House Noodles",
      nameEnglish: null,
      price: "$16",
      description: "Stir-fried house noodles with a mix of the chef's special ingredients.",
    },
  ]);
});

test("parseMenuImageBytes backfills multiple missing descriptions", async () => {
  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async () => ({
        text: JSON.stringify([
          {
            nameOriginal: "CALAMARES",
            nameEnglish: "Translated: Squid",
            price: "8,50",
            description: null,
          },
          {
            nameOriginal: "CHIPIRONES",
            nameEnglish: "Translated: Small squid",
            price: "9,00",
            description: null,
          },
        ]),
      }),
      generateMissingDescriptions: async (missingItems) => {
        assert.deepEqual(missingItems, [
          {
            itemKey: "0",
            nameOriginal: "CALAMARES",
            nameEnglish: "Squid",
            price: "8,50",
          },
          {
            itemKey: "1",
            nameOriginal: "CHIPIRONES",
            nameEnglish: "Small squid",
            price: "9,00",
          },
        ]);

        return [
          {
            itemKey: "0",
            description: "Tender squid, often lightly fried and served as a savory seafood starter.",
          },
          {
            itemKey: "1",
            description: "Small squid prepared as a light seafood appetizer with a tender bite.",
          },
        ];
      },
    },
  );

  assert.deepEqual(items, [
    {
      nameOriginal: "CALAMARES",
      nameEnglish: "Translated: Squid",
      price: "8,50",
      description: "Tender squid, often lightly fried and served as a savory seafood starter.",
    },
    {
      nameOriginal: "CHIPIRONES",
      nameEnglish: "Translated: Small squid",
      price: "9,00",
      description: "Small squid prepared as a light seafood appetizer with a tender bite.",
    },
  ]);
});

test("parseMenuImageBytes leaves description null when fallback generator is still unsure", async () => {
  const items = await parseMenuImageBytes(
    {
      bytes: Buffer.from("fake-image-bytes"),
      mimeType: "image/png",
    },
    {
      generateMenuContent: async () => ({
        text: JSON.stringify([
          {
            nameOriginal: "ZXQ-17",
            nameEnglish: null,
            price: null,
            description: null,
          },
        ]),
      }),
      generateMissingDescriptions: async () => ([
        {
          itemKey: "0",
          description: null,
        },
      ]),
    },
  );

  assert.deepEqual(items, [
    {
      nameOriginal: "ZXQ-17",
      nameEnglish: null,
      price: null,
      description: null,
    },
  ]);
});

test("parseMenuImage infers mime type from the file extension", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "menu-parser-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const imagePath = path.join(tempDir, "menu.jpeg");
  await writeFile(imagePath, Buffer.from("jpeg-bytes"));

  let seenMimeType: string | null = null;

  const items = await parseMenuImage(imagePath, {
    generateMenuContent: async ({ mimeType }) => {
      seenMimeType = mimeType;
      return { text: "[]" };
    },
  });

  assert.equal(seenMimeType, "image/jpeg");
  assert.deepEqual(items, []);
});

test("parseMenuImageBytes throws when Gemini returns empty text", async () => {
  await assert.rejects(
    () =>
      parseMenuImageBytes(
        {
          bytes: Buffer.from("image"),
          mimeType: "image/webp",
        },
        {
          generateMenuContent: async () => ({ text: "" }),
        },
      ),
    /Gemini returned an empty response\./,
  );
});

test("parseMenuImageBytes throws when Gemini returns invalid JSON", async () => {
  await assert.rejects(
    () =>
      parseMenuImageBytes(
        {
          bytes: Buffer.from("image"),
          mimeType: "image/png",
        },
        {
          generateMenuContent: async () => ({ text: "{not json}" }),
        },
      ),
    /Gemini did not return valid JSON\./,
  );
});

test("parseMenuImageBytes throws when Gemini returns a non-array payload", async () => {
  await assert.rejects(
    () =>
      parseMenuImageBytes(
        {
          bytes: Buffer.from("image"),
          mimeType: "image/png",
        },
        {
          generateMenuContent: async () => ({ text: "{\"nameOriginal\":\"Soup\"}" }),
        },
      ),
    /Expected an array of menu items\./,
  );
});

test("parseMenuImage rejects unsupported file types before calling Gemini", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "menu-parser-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const imagePath = path.join(tempDir, "menu.gif");
  await writeFile(imagePath, Buffer.from("gif-bytes"));

  await assert.rejects(
    () =>
      parseMenuImage(imagePath, {
        generateMenuContent: async () => ({ text: "[]" }),
      }),
    /Unsupported image type\./,
  );
});
