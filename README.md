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
```

Important rules:

- `.env.local` is ignored by git in `.gitignore`
- do not rename the key to `NEXT_PUBLIC_GEMINI_API_KEY`
- only call Gemini from a backend route, server action, or other server-only function
- never send the API key to the browser

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
