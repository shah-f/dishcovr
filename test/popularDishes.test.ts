import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDishPopularity, findPopularDishesFromFoursquare } from "../popularDishes.ts";

test("analyzeDishPopularity ranks most mentioned, highly praised, and likely favorite dishes", () => {
  const menuItems = [
    {
      nameOriginal: "CALAMARES",
      nameEnglish: "Translated: Squid",
      price: "8,50",
      description: null,
    },
    {
      nameOriginal: "GAMBAS (Aji'llo)",
      nameEnglish: "Translated: Garlic Prawns",
      price: "10,50",
      description: null,
    },
    {
      nameOriginal: "EMPANADA",
      nameEnglish: "Translated: Empanada",
      price: "5,00",
      description: null,
    },
  ];

  const documents = [
    {
      id: "tip-1",
      source: "foursquare_tip" as const,
      text: "The squid was amazing and the garlic prawns are a must try.",
    },
    {
      id: "tip-2",
      source: "foursquare_tip" as const,
      text: "Loved the calamares. Crispy, delicious, and worth it.",
    },
    {
      id: "tip-3",
      source: "foursquare_tip" as const,
      text: "Get the garlic prawn dish. Easily the best tapa here.",
    },
    {
      id: "tip-4",
      source: "foursquare_tip" as const,
      text: "Empanada was good, but the squid was the real favorite.",
    },
  ];

  const analysis = analyzeDishPopularity(menuItems, documents, 3);

  assert.equal(analysis.documentsAnalyzed, 4);
  assert.equal(analysis.buckets.mostMentioned[0]?.canonicalName, "Squid");
  assert.equal(analysis.buckets.highlyPraised[0]?.canonicalName, "Squid");
  assert.equal(analysis.buckets.likelyFavorites[0]?.canonicalName, "Squid");

  const garlicPrawns = analysis.dishes.find((dish) => dish.canonicalName === "Garlic Prawns");
  assert.ok(garlicPrawns);
  assert.equal(garlicPrawns.mentions, 2);
  assert.ok(garlicPrawns.matchedAliases.includes("garlic prawn"));
  assert.equal(garlicPrawns.aiAssessment, null);
});

test("findPopularDishesFromFoursquare orchestrates search, tips, and dish analysis", async () => {
  const menuItems = [
    {
      nameOriginal: "CALAMARES",
      nameEnglish: "Translated: Squid",
      price: "8,50",
      description: null,
    },
    {
      nameOriginal: "RAXO",
      nameEnglish: "Translated: Marinated Pork Loin",
      price: "8,00",
      description: null,
    },
  ];

  const requests: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.startsWith("https://api.foursquare.com/v3/places/search")) {
      return new Response(JSON.stringify({
        results: [
          {
            fsq_id: "fsq-restaurant-1",
            name: "Casa Galicia",
            location: {
              formatted_address: "123 Main St, New York, NY",
              locality: "New York",
              region: "NY",
              country: "US",
            },
            categories: [{ name: "Spanish Restaurant" }],
            distance: 120,
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url === "https://api.foursquare.com/v3/places/fsq-restaurant-1/tips?limit=20") {
      return new Response(JSON.stringify([
        {
          id: "tip-1",
          text: "The squid is excellent. Get it.",
        },
        {
          id: "tip-2",
          text: "Raxo was delicious and easily my favorite thing on the menu.",
        },
      ]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await findPopularDishesFromFoursquare(
    {
      restaurantName: "Casa Galicia",
      near: "New York, NY",
      menuItems,
    },
    {
      apiKey: "test-fsq-key",
      fetchImpl: fetchImpl as typeof fetch,
      tipLimit: 20,
      maxBuckets: 3,
      refineWithAi: async () => null,
    },
  );

  assert.deepEqual(requests, [
    "https://api.foursquare.com/v3/places/search?query=Casa+Galicia&limit=10&near=New+York%2C+NY",
    "https://api.foursquare.com/v3/places/fsq-restaurant-1/tips?limit=20",
  ]);
  assert.equal(result.restaurant.fsqId, "fsq-restaurant-1");
  assert.equal(result.documentsAnalyzed, 2);
  assert.equal(result.aiRefinementApplied, false);
  assert.equal(result.buckets.mostMentioned.length, 2);
  assert.equal(result.buckets.likelyFavorites[0]?.canonicalName, "Marinated Pork Loin");
});

test("findPopularDishesFromFoursquare uses ai refinement to promote validated bucket picks", async () => {
  const menuItems = [
    {
      nameOriginal: "CALAMARES",
      nameEnglish: "Translated: Squid",
      price: "8,50",
      description: null,
    },
    {
      nameOriginal: "RAXO",
      nameEnglish: "Translated: Marinated Pork Loin",
      price: "8,00",
      description: null,
    },
    {
      nameOriginal: "EMPANADA",
      nameEnglish: "Translated: Empanada",
      price: "5,00",
      description: null,
    },
  ];

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);

    if (url.startsWith("https://api.foursquare.com/v3/places/search")) {
      return new Response(JSON.stringify({
        results: [
          {
            fsq_id: "fsq-restaurant-2",
            name: "Casa Galicia",
            location: {
              formatted_address: "123 Main St, New York, NY",
              locality: "New York",
              region: "NY",
              country: "US",
            },
            categories: [{ name: "Spanish Restaurant" }],
            distance: 120,
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url === "https://api.foursquare.com/v3/places/fsq-restaurant-2/tips?limit=20") {
      return new Response(JSON.stringify([
        {
          id: "tip-1",
          text: "The squid is excellent. Get it.",
        },
        {
          id: "tip-2",
          text: "Raxo was delicious and easily my favorite thing on the menu.",
        },
        {
          id: "tip-3",
          text: "Empanada was good too.",
        },
      ]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await findPopularDishesFromFoursquare(
    {
      restaurantName: "Casa Galicia",
      near: "New York, NY",
      menuItems,
    },
    {
      apiKey: "test-fsq-key",
      fetchImpl: fetchImpl as typeof fetch,
      tipLimit: 20,
      maxBuckets: 3,
      refineWithAi: async ({ dishes }) => dishes.map((dish) => ({
        canonicalName: dish.canonicalName,
        mostMentioned: dish.canonicalName === "Squid",
        highlyPraised: dish.canonicalName === "Squid",
        likelyFavorite: dish.canonicalName === "Marinated Pork Loin",
        confidence: "medium",
        reason: "Validated from the supplied review snippets.",
      })),
    },
  );

  assert.equal(result.aiRefinementApplied, true);
  assert.equal(result.buckets.mostMentioned[0]?.canonicalName, "Squid");
  assert.equal(result.buckets.highlyPraised[0]?.canonicalName, "Squid");
  assert.equal(result.buckets.likelyFavorites[0]?.canonicalName, "Marinated Pork Loin");
  assert.equal(result.dishes.find((dish) => dish.canonicalName === "Squid")?.aiAssessment?.confidence, "medium");
});
