import assert from "node:assert/strict";
import test from "node:test";

import { clearDishImageCaches, findDishImages } from "../dishImages.ts";

test("findDishImages prefers a matching Wikimedia page thumbnail when available", async () => {
  clearDishImageCaches();
  const requests: string[] = [];

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      assert.match(url, /q=Drunken\+Noodle/);

      return new Response(JSON.stringify({
        pages: [
          {
            id: 123,
            key: "Pad_kee_mao",
            title: "Pad kee mao",
            description: "Thai stir-fried rice noodle dish",
            excerpt: "Pad kee mao, also called drunken noodles, is a stir-fried noodle dish.",
            matched_title: "Drunken noodles",
            thumbnail: {
              url: "//upload.wikimedia.org/drunken-noodles-thumb.jpg",
              width: 320,
              height: 240,
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    assert.equal(url, "https://en.wikipedia.org/api/rest_v1/page/summary/Pad_kee_mao");

    return new Response(JSON.stringify({
      title: "Pad kee mao",
      thumbnail: {
        source: "https://upload.wikimedia.org/drunken-noodles-thumb.jpg",
        width: 320,
        height: 240,
      },
      originalimage: {
        source: "https://upload.wikimedia.org/drunken-noodles-full.jpg",
        width: 1200,
        height: 900,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "Drunken Noodle",
        nameEnglish: null,
        price: "12|13",
        description: "Stir fried broad rice noodle, basil, onion, bell pepper, chili.",
      },
    ],
    {
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  assert.equal(requests.length, 2);
  assert.deepEqual(result, [
    {
      itemKey: "0",
      searchQuery: "Drunken Noodle",
      source: "wikimedia",
      image: {
        id: 123,
        alt: "Thai stir-fried rice noodle dish",
        pageUrl: "https://en.wikipedia.org/wiki/Pad_kee_mao",
        pexelsUrl: null,
        photographer: null,
        photographerUrl: null,
        avgColor: null,
        src: {
          tiny: "https://upload.wikimedia.org/drunken-noodles-full.jpg",
          small: "https://upload.wikimedia.org/drunken-noodles-full.jpg",
          medium: "https://upload.wikimedia.org/drunken-noodles-full.jpg",
          landscape: "https://upload.wikimedia.org/drunken-noodles-full.jpg",
          portrait: "https://upload.wikimedia.org/drunken-noodles-full.jpg",
        },
        attributionText: "Image from Wikipedia: Pad kee mao",
        attributionLink: "https://en.wikipedia.org/wiki/Pad_kee_mao",
      },
    },
  ]);
});

test("findDishImages falls back to Pexels when Wikimedia has no matching thumbnail", async () => {
  clearDishImageCaches();
  const requests: string[] = [];

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response(JSON.stringify({ pages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    assert.match(url, /api\.pexels\.com\/v1\/search\?query=Pad\+Thai/);
    assert.match(url, /per_page=6/);

    return new Response(JSON.stringify({
      photos: [
        {
          id: 101,
          url: "https://www.pexels.com/photo/pad-thai-101/",
          photographer: "Jane Doe",
          photographer_url: "https://www.pexels.com/@jane-doe",
          avg_color: "#A97B52",
          alt: "Plate of pad thai",
          src: {
            tiny: "https://images.pexels.com/photos/101/tiny.jpg",
            small: "https://images.pexels.com/photos/101/small.jpg",
            medium: "https://images.pexels.com/photos/101/medium.jpg",
            landscape: "https://images.pexels.com/photos/101/landscape.jpg",
            portrait: "https://images.pexels.com/photos/101/portrait.jpg",
          },
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "ผัดไทย",
        nameEnglish: "Translated: Pad Thai",
        price: "$16",
        description: "Translated: Stir-fried rice noodles with tamarind sauce.",
      },
    ],
    {
      apiKey: "test-pexels-key",
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  assert.ok(requests.some((url) => url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")));
  assert.ok(requests.some((url) => url.startsWith("https://api.pexels.com/v1/search")));
  assert.deepEqual(result, [
    {
      itemKey: "0",
      searchQuery: "Pad Thai",
      source: "pexels",
      image: {
        id: 101,
        alt: "Plate of pad thai",
        pageUrl: "https://www.pexels.com/photo/pad-thai-101/",
        pexelsUrl: "https://www.pexels.com/photo/pad-thai-101/",
        photographer: "Jane Doe",
        photographerUrl: "https://www.pexels.com/@jane-doe",
        avgColor: "#A97B52",
        src: {
          tiny: "https://images.pexels.com/photos/101/tiny.jpg",
          small: "https://images.pexels.com/photos/101/small.jpg",
          medium: "https://images.pexels.com/photos/101/medium.jpg",
          landscape: "https://images.pexels.com/photos/101/landscape.jpg",
          portrait: "https://images.pexels.com/photos/101/portrait.jpg",
        },
        attributionText: "Photo by Jane Doe on Pexels",
        attributionLink: "https://www.pexels.com/photo/pad-thai-101/",
      },
    },
  ]);
});

test("findDishImages falls back to Pexels and cools down Wikimedia after a 429", async () => {
  clearDishImageCaches();
  const requests: string[] = [];

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response("<html><body>rate limited</body></html>", {
        status: 429,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "retry-after": "60",
        },
      });
    }

    if (url.includes("query=Drunken+Noodle")) {
      return new Response(JSON.stringify({
        photos: [
          {
            id: 401,
            url: "https://www.pexels.com/photo/drunken-noodles-401/",
            photographer: "Noodle Lens",
            photographer_url: "https://www.pexels.com/@noodle-lens",
            avg_color: "#7A583A",
            alt: "Plate of spicy thai noodles with basil",
            src: {
              tiny: "https://images.pexels.com/photos/401/tiny.jpg",
              small: "https://images.pexels.com/photos/401/small.jpg",
              medium: "https://images.pexels.com/photos/401/medium.jpg",
              landscape: "https://images.pexels.com/photos/401/landscape.jpg",
              portrait: "https://images.pexels.com/photos/401/portrait.jpg",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("query=Pad+Thai")) {
      return new Response(JSON.stringify({
        photos: [
          {
            id: 402,
            url: "https://www.pexels.com/photo/pad-thai-402/",
            photographer: "Thai Table",
            photographer_url: "https://www.pexels.com/@thai-table",
            avg_color: "#B17443",
            alt: "Pad thai noodles with peanuts on a plate",
            src: {
              tiny: "https://images.pexels.com/photos/402/tiny.jpg",
              small: "https://images.pexels.com/photos/402/small.jpg",
              medium: "https://images.pexels.com/photos/402/medium.jpg",
              landscape: "https://images.pexels.com/photos/402/landscape.jpg",
              portrait: "https://images.pexels.com/photos/402/portrait.jpg",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "Drunken Noodle",
        nameEnglish: null,
        price: "12|13",
        description: "Stir fried broad rice noodle, basil, onion, bell pepper, chili.",
      },
      {
        nameOriginal: "ผัดไทย",
        nameEnglish: "Translated: Pad Thai",
        price: "$16",
        description: "Translated: Stir-fried rice noodles with tamarind sauce.",
      },
    ],
    {
      apiKey: "test-pexels-key",
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  assert.equal(
    requests.filter((url) => url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")).length,
    1,
  );
  assert.deepEqual(
    result.map((match) => match.source),
    ["pexels", "pexels"],
  );
  assert.deepEqual(
    result.map((match) => match.image?.id),
    [401, 402],
  );
});

test("findDishImages uses a planned Gemini-style query to avoid broad Wikimedia matches", async () => {
  clearDishImageCaches();
  const requests: string[] = [];

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response(JSON.stringify({ pages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    assert.match(url, /api\.pexels\.com\/v1\/search\?query=Thai\+tofu\+vegetable\+stir\+fry/);

    return new Response(JSON.stringify({
      photos: [
        {
          id: 501,
          url: "https://www.pexels.com/photo/tofu-stir-fry-501/",
          photographer: "Food Frame",
          photographer_url: "https://www.pexels.com/@food-frame",
          avg_color: "#8A6A46",
          alt: "Thai tofu vegetable stir fry on a plate",
          src: {
            tiny: "https://images.pexels.com/photos/501/tiny.jpg",
            small: "https://images.pexels.com/photos/501/small.jpg",
            medium: "https://images.pexels.com/photos/501/medium.jpg",
            landscape: "https://images.pexels.com/photos/501/landscape.jpg",
            portrait: "https://images.pexels.com/photos/501/portrait.jpg",
          },
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "Mixed Vegetable and Tofa",
        nameEnglish: null,
        price: "12",
        description: "Sauteed mixed vegetable and tofu with garlic sauce served with rice",
      },
    ],
    {
      apiKey: "test-pexels-key",
      fetchImpl: fetchImpl as typeof fetch,
      planSearchQueries: async () => [
        {
          itemKey: "0",
          canonicalDishName: "Tofu vegetable stir fry",
          wikipediaQuery: "Thai tofu vegetable stir fry",
          pexelsQuery: "Thai tofu vegetable stir fry",
          shouldSkip: false,
          confidence: "high",
        },
      ],
    },
  );

  assert.equal(result[0]?.source, "pexels");
  assert.equal(result[0]?.searchQuery, "Thai tofu vegetable stir fry");
  assert.equal(result[0]?.image?.id, 501);
  assert.ok(requests.some((url) => /q=Thai\+tofu\+vegetable\+stir\+fry/.test(url)));
  assert.ok(!requests.some((url) => /List\+of\+vegetable\+oils/.test(url)));
});

test("findDishImages returns no image when candidate images fail validation", async () => {
  clearDishImageCaches();

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response(JSON.stringify({
        pages: [
          {
            id: 601,
            key: "Culture_of_Galicia",
            title: "Culture of Galicia",
            description: "Culture of Galicia",
            excerpt: "Traditional festivities in Galicia.",
            matched_title: "Galicia culture",
            thumbnail: {
              url: "//upload.wikimedia.org/culture-of-galicia.jpg",
              width: 320,
              height: 240,
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url === "https://en.wikipedia.org/api/rest_v1/page/summary/Culture_of_Galicia") {
      return new Response(JSON.stringify({
        title: "Culture of Galicia",
        thumbnail: {
          source: "https://upload.wikimedia.org/culture-of-galicia.jpg",
          width: 320,
          height: 240,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ photos: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "PULPO",
        nameEnglish: "Translated: Octopus",
        price: "14,00",
        description: "Cooked octopus, often served Galician style with paprika and olive oil.",
      },
    ],
    {
      fetchImpl: fetchImpl as typeof fetch,
      validateDishImage: async () => ({
        isFoodDish: false,
        matchesDish: false,
        confidence: "high",
        reason: "This image shows a cultural scene, not plated food.",
      }),
    },
  );

  assert.deepEqual(result, [
    {
      itemKey: "0",
      searchQuery: null,
      source: "none",
      image: null,
    },
  ]);
});

test("findDishImages returns no image for a weak Wikimedia match when validation is unavailable", async () => {
  clearDishImageCaches();

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response(JSON.stringify({
        pages: [
          {
            id: 611,
            key: "Molly_Malone",
            title: "Molly Malone",
            description: "Molly Malone",
            excerpt: "A statue associated with shellfish selling in Dublin.",
            matched_title: "Molly Malone",
            thumbnail: {
              url: "//upload.wikimedia.org/molly-malone.jpg",
              width: 320,
              height: 240,
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url === "https://en.wikipedia.org/api/rest_v1/page/summary/Molly_Malone") {
      return new Response(JSON.stringify({
        title: "Molly Malone",
        thumbnail: {
          source: "https://upload.wikimedia.org/molly-malone.jpg",
          width: 320,
          height: 240,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ photos: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "MEJILLONES",
        nameEnglish: "Translated: Mussels",
        price: "7,00",
        description: "Steamed or cooked mussels, often served in a sauce.",
      },
    ],
    {
      fetchImpl: fetchImpl as typeof fetch,
      validateDishImage: async () => null,
    },
  );

  assert.deepEqual(result, [
    {
      itemKey: "0",
      searchQuery: null,
      source: "none",
      image: null,
    },
  ]);
});

test("findDishImages returns no image found when validation fails", async () => {
  clearDishImageCaches();

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response(JSON.stringify({
        pages: [
          {
            id: 701,
            key: "Fish_as_food",
            title: "Fish as food",
            description: "Fish as food",
            excerpt: "Fish as a broad food category.",
            matched_title: "Fish as food",
            thumbnail: {
              url: "//upload.wikimedia.org/fish-as-food.jpg",
              width: 320,
              height: 240,
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url === "https://en.wikipedia.org/api/rest_v1/page/summary/Fish_as_food") {
      return new Response(JSON.stringify({
        title: "Fish as food",
        thumbnail: {
          source: "https://upload.wikimedia.org/fish-as-food.jpg",
          width: 320,
          height: 240,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ photos: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "Seared Tilapia",
        nameEnglish: null,
        price: "14",
        description: "With curry sauce, sauteed napa, shiitake, green papaya salad served with rice",
      },
    ],
    {
      fetchImpl: fetchImpl as typeof fetch,
      validateDishImage: async () => ({
        isFoodDish: false,
        matchesDish: false,
        confidence: "high",
        reason: "This image does not show the named plated dish.",
      }),
    },
  );

  assert.deepEqual(result, [
    {
      itemKey: "0",
      searchQuery: null,
      source: "none",
      image: null,
    },
  ]);
});

test("findDishImages rejects non-food Pexels photos and keeps a plausible dish match", async () => {
  clearDishImageCaches();
  const fetchImpl = async (input: string | URL) => {
    const url = String(input);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response(JSON.stringify({ pages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      photos: [
        {
          id: 301,
          url: "https://www.pexels.com/photo/photographer-301/",
          photographer: "A Photographer",
          photographer_url: "https://www.pexels.com/@photographer",
          avg_color: "#222222",
          alt: "Man holding a camera in winter",
          src: {
            tiny: "https://images.pexels.com/photos/301/tiny.jpg",
            small: "https://images.pexels.com/photos/301/small.jpg",
            medium: "https://images.pexels.com/photos/301/medium.jpg",
            landscape: "https://images.pexels.com/photos/301/landscape.jpg",
            portrait: "https://images.pexels.com/photos/301/portrait.jpg",
          },
        },
        {
          id: 302,
          url: "https://www.pexels.com/photo/noodles-302/",
          photographer: "Food Shooter",
          photographer_url: "https://www.pexels.com/@food-shooter",
          avg_color: "#6E4E33",
          alt: "Plate of spicy thai noodles with basil",
          src: {
            tiny: "https://images.pexels.com/photos/302/tiny.jpg",
            small: "https://images.pexels.com/photos/302/small.jpg",
            medium: "https://images.pexels.com/photos/302/medium.jpg",
            landscape: "https://images.pexels.com/photos/302/landscape.jpg",
            portrait: "https://images.pexels.com/photos/302/portrait.jpg",
          },
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "Drunken Noodle",
        nameEnglish: null,
        price: "12|13",
        description: "Stir fried broad rice noodle, basil, onion, bell pepper, chili. Choice of chicken, beef or shrimp.",
      },
    ],
    {
      apiKey: "test-pexels-key",
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  assert.equal(result[0]?.source, "pexels");
  assert.equal(result[0]?.image?.id, 302);
});

test("findDishImages returns no image for generic dish names", async () => {
  clearDishImageCaches();
  const fetchImpl = async () => {
    throw new Error("Should not call external image sources for generic dish names.");
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "Chef's Special",
        nameEnglish: null,
        price: "$18",
        description: null,
      },
    ],
    {
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  assert.deepEqual(result, [
    {
      itemKey: "0",
      searchQuery: null,
      source: "none",
      image: null,
    },
  ]);
});

test("findDishImages falls back to a broader Pexels food query when the first query is empty", async () => {
  clearDishImageCaches();
  const requests: string[] = [];

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.startsWith("https://en.wikipedia.org/w/rest.php/v1/search/page")) {
      return new Response(JSON.stringify({ pages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("query=CALAMARES&")) {
      return new Response(JSON.stringify({ photos: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      photos: [
        {
          id: 202,
          url: "https://www.pexels.com/photo/calamares-202/",
          photographer: "Alex Roe",
          photographer_url: "https://www.pexels.com/@alex-roe",
          avg_color: null,
          alt: "Plate of fried squid appetizer",
          src: {
            tiny: "https://images.pexels.com/photos/202/tiny.jpg",
            small: "https://images.pexels.com/photos/202/small.jpg",
            medium: "https://images.pexels.com/photos/202/medium.jpg",
            landscape: "https://images.pexels.com/photos/202/landscape.jpg",
            portrait: "https://images.pexels.com/photos/202/portrait.jpg",
          },
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await findDishImages(
    [
      {
        nameOriginal: "CALAMARES",
        nameEnglish: null,
        price: "8,50",
        description: "Tender squid, often lightly fried and served as a savory seafood starter.",
      },
    ],
    {
      apiKey: "test-pexels-key",
      fetchImpl: fetchImpl as typeof fetch,
    },
  );

  assert.ok(requests.some((url) => url === "https://api.pexels.com/v1/search?query=CALAMARES&page=1&per_page=6&orientation=square&size=medium&locale=en-US"));
  assert.ok(requests.some((url) => url.includes("query=CALAMARES+squid")));
  assert.equal(result[0]?.source, "pexels");
  assert.notEqual(result[0]?.searchQuery, "CALAMARES");
});
