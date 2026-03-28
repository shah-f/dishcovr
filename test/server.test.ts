import assert from "node:assert/strict";
import test from "node:test";

import { normalizeParseMenuUploads } from "../server.ts";

test("normalizeParseMenuUploads keeps backward compatibility for a single image payload", () => {
  const uploads = normalizeParseMenuUploads({
    filename: "menu-page-1.jpg",
    mimeType: "image/jpeg",
    imageBase64: "abc123",
  });

  assert.deepEqual(uploads, [
    {
      filename: "menu-page-1.jpg",
      mimeType: "image/jpeg",
      imageBase64: "abc123",
    },
  ]);
});

test("normalizeParseMenuUploads accepts a batch of images", () => {
  const uploads = normalizeParseMenuUploads({
    images: [
      {
        filename: "menu-page-1.jpg",
        mimeType: "image/jpeg",
        imageBase64: "abc123",
      },
      {
        filename: "menu-page-2.png",
        mimeType: "image/png",
        imageBase64: "def456",
      },
    ],
  });

  assert.deepEqual(uploads, [
    {
      filename: "menu-page-1.jpg",
      mimeType: "image/jpeg",
      imageBase64: "abc123",
    },
    {
      filename: "menu-page-2.png",
      mimeType: "image/png",
      imageBase64: "def456",
    },
  ]);
});
