# tobenamed

Base: Upload a pic of the menu, get an imagified menu in return with a short description of the food

Feature #1: Look through reviews of the restaurant and suggest highly rated foods at the place 

Feature #2: A "get more info" button that opens a window to give you an in depth summary of the food, how it's prepared, etc

Feature #3: Allergy information

Feature #4: Surprise me button for indecisive people

Feature #5: Family-style ordering

## Safe Gemini setup

Keep your Gemini key in a local-only env file:

```bash
touch .env.local
```

Then edit `.env.local` and add your real key:

```bash
GEMINI_API_KEY=your_real_key_here
FOURSQUARE_API_KEY=your_real_foursquare_key_here
```

Important rules:

- `.env.local` is ignored by git in `.gitignore`
- do not rename the key to `NEXT_PUBLIC_GEMINI_API_KEY`
- only call Gemini from a backend route, server action, or other server-only function
- never send the API key to the browser
- keep the Foursquare API key server-side too

## Run the lightweight app

Start the local server:

```bash
npm run dev
```

Then open:

```bash
http://localhost:3000
```

The frontend is a tiny React page served from `public/`, and the backend upload endpoint is `POST /api/parse-menu`.

## Popular Dishes API

There is now a backend-only route for review-driven dish recommendations:

```bash
POST /api/popular-dishes
```

Request body:

```json
{
  "restaurantName": "Casa Galicia",
  "near": "New York, NY",
  "menuItems": [
    {
      "nameOriginal": "CALAMARES",
      "nameEnglish": "Translated: Squid",
      "price": "8,50",
      "description": "Fried squid rings, often served as a tapa."
    }
  ]
}
```

The route uses Foursquare Places search and place tips to build:

- `mostMentioned`
- `highlyPraised`
- `likelyFavorites`

The matching logic lives in `popularDishes.ts`.

It works in two layers:

- heuristic matching first for dish aliases, mention counts, and positive/negative review language
- optional Gemini refinement second to sanity-check the top candidates and ambiguous matches when `GEMINI_API_KEY` is available

## Current parser helper

`menuParser.ts` now exposes two safe server-side entry points:

- `parseMenuImage(filePath)` for backend scripts
- `parseMenuImageBytes({ bytes, mimeType })` for Next.js API routes or server actions handling uploads

Example Next.js route shape:

```ts
import { NextResponse } from "next/server";
import { parseMenuImageBytes } from "@/menuParser";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("image");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const items = await parseMenuImageBytes({
    bytes,
    mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
  });

  return NextResponse.json({ items });
}
```
