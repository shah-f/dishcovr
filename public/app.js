import React, { useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function downloadJson(data, filename) {
  const blob = new Blob([formatJson(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.replace(/\.[^.]+$/, "") + ".json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => {
      reject(new Error("Could not read that file."));
    };
    reader.readAsDataURL(file);
  });
}

function stripTranslatedPrefix(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/^Translated:\s*/i, "").trim() || null;
}

// Prefer the translated/common name for the card title when we have one.
function buildDisplayName(item) {
  return stripTranslatedPrefix(item.nameEnglish) || item.nameOriginal;
}

// Keep the original menu-language name as a secondary label when useful.
function buildSecondaryName(item) {
  const translated = stripTranslatedPrefix(item.nameEnglish);

  if (!translated || translated === item.nameOriginal) {
    return null;
  }

  return item.nameOriginal;
}

function placeholderJson() {
  return "{\n  \"items\": []\n}";
}

function buildImageStatus(payload) {
  const sourceCounts = payload.sourceCounts || {};
  const parts = [];

  if (sourceCounts.wikimedia) {
    parts.push(`${sourceCounts.wikimedia} from Wikipedia`);
  }

  if (sourceCounts.pexels) {
    parts.push(`${sourceCounts.pexels} from Pexels`);
  }

  if (sourceCounts.none) {
    parts.push(`${sourceCounts.none} with no image`);
  }

  if (parts.length === 0) {
    return `Found images for ${payload.matchedCount} of ${payload.itemCount} dishes.`;
  }

  return `Found images for ${payload.matchedCount} of ${payload.itemCount} dishes: ${parts.join(", ")}.`;
}

function EmptyMenuState({ title, body }) {
  return html`
    <div className="empty-menu-state">
      <strong>${title}</strong>
      <span>${body}</span>
    </div>
  `;
}

function MenuCard({ item, imageMatch }) {
  const displayName = buildDisplayName(item);
  const secondaryName = buildSecondaryName(item);
  const image = imageMatch?.image ?? null;
  const placeholderStyle = image?.avgColor ? { background: image.avgColor } : undefined;
  // Render the largest practical image variant first to avoid fuzzy cards.
  const imageUrl = image
    ? image.src.landscape || image.src.portrait || image.src.medium || image.src.small || image.src.tiny
    : null;

  return html`
    <article className="menu-card">
      ${
        image && imageUrl
          ? html`
              <div className="menu-card-image-shell">
                <img
                  className="menu-card-image"
                  src=${imageUrl}
                  alt=${image.alt || `Photo of ${displayName}`}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            `
          : html`
              <div className="menu-card-placeholder" style=${placeholderStyle}>
                <span>${displayName.slice(0, 1).toUpperCase()}</span>
              </div>
            `
      }

      <div className="menu-card-body">
        <div className="menu-card-header">
          <div>
            <h3>${displayName}</h3>
            ${secondaryName ? html`<p className="menu-card-subtitle">${secondaryName}</p>` : null}
          </div>
          ${item.price ? html`<span className="price-pill">${item.price}</span>` : null}
        </div>

        <p className="menu-card-description">
          ${item.description || "No description available yet."}
        </p>

        ${
          image
            ? html`
                <a
                  className="photo-credit"
                  href=${image.attributionLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  ${image.attributionText}
                </a>
              `
            : html`<p className="photo-credit muted-credit">No image found.</p>`
        }
      </div>
    </article>
  `;
}

function App() {
  // Frontend state stays intentionally simple: uploaded files, parsed JSON, and card-ready image matches.
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [status, setStatus] = useState("Pick one or more menu images and I’ll turn them into a visual menu.");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [menuCards, setMenuCards] = useState([]);
  const [imageStatus, setImageStatus] = useState("Dish photos will show up here after parsing.");
  const [imageError, setImageError] = useState("");
  const [imageAttribution, setImageAttribution] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resultJson = result ? formatJson(result) : placeholderJson();
  const primaryDownloadName = selectedFiles.length === 1 ? selectedFiles[0].name : "menu-results";
  const fileCountLabel = `${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"}`;

  function revokePreviewUrls(urls) {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }

  function resetImageState(nextStatus = "Dish photos will show up here after parsing.") {
    setMenuCards([]);
    setImageStatus(nextStatus);
    setImageError("");
    setImageAttribution(null);
  }

  function handleFileChange(event) {
    const files = Array.from(event.target.files ?? []);

    setError("");
    setResult(null);
    // New uploads invalidate both the parsed menu and any previous image matches.
    resetImageState();

    if (files.length === 0) {
      revokePreviewUrls(previewUrls);
      setSelectedFiles([]);
      setPreviewUrls([]);
      setStatus("Pick one or more menu images and I’ll turn them into a visual menu.");
      return;
    }

    const invalidFile = files.find((file) => !ACCEPTED_TYPES.has(file.type));
    if (invalidFile) {
      revokePreviewUrls(previewUrls);
      setSelectedFiles([]);
      setPreviewUrls([]);
      setStatus("Waiting for supported images.");
      setError("Every file must be a PNG, JPG, JPEG, or WEBP image.");
      return;
    }

    revokePreviewUrls(previewUrls);
    const nextPreviewUrls = files.map((file) => URL.createObjectURL(file));

    setSelectedFiles(files);
    setPreviewUrls(nextPreviewUrls);
    setStatus(`Ready to parse ${files.length} menu image${files.length === 1 ? "" : "s"}.`);
  }

  async function fetchDishImages(items) {
    // The backend returns image matches keyed by item index, so we rebuild card data in the same order here.
    const response = await fetch("/api/dish-images", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ items }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not fetch dish images.");
    }

    const matchByKey = new Map(payload.items.map((match) => [match.itemKey, match]));
    const nextMenuCards = items.map((item, index) => ({
      item,
      imageMatch: matchByKey.get(String(index)) ?? null,
    }));

    setMenuCards(nextMenuCards);
    setImageAttribution(payload.attribution ?? null);
    setImageStatus(buildImageStatus(payload));
    setImageError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (selectedFiles.length === 0) {
      setError("Choose at least one image first.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    resetImageState("Preparing the visual menu...");
    setStatus(`Parsing ${fileCountLabel}...`);

    try {
      // Parse all selected pages first, then enrich the flattened dish list with image matches.
      const images = await Promise.all(selectedFiles.map(async (file) => ({
        filename: file.name,
        mimeType: file.type,
        imageBase64: await fileToBase64(file),
      })));

      const response = await fetch("/api/parse-menu", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ images }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Upload failed.");
      }

      setResult(payload);
      setStatus(
        `Parsed ${payload.items.length} menu items from ${payload.imageCount} image${payload.imageCount === 1 ? "" : "s"}.`,
      );
      setImageStatus("Finding generic food photos from Pexels...");

      // Show text-only cards immediately so the UI still feels responsive while image lookup runs.
      const fallbackCards = payload.items.map((item) => ({
        item,
        imageMatch: null,
      }));
      setMenuCards(fallbackCards);

      try {
        await fetchDishImages(payload.items);
      } catch (imageFetchError) {
        setImageError(
          imageFetchError instanceof Error
            ? imageFetchError.message
            : "Could not fetch dish images.",
        );
        setImageStatus("Showing text-first menu cards because image lookup did not complete.");
      }
    } catch (submitError) {
      setResult(null);
      setMenuCards([]);
      setStatus("Upload failed.");
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
      resetImageState();
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    revokePreviewUrls(previewUrls);
    setSelectedFiles([]);
    setPreviewUrls([]);
    setError("");
    setResult(null);
    setStatus("Pick one or more menu images and I’ll turn them into a visual menu.");
    resetImageState();

    const input = document.getElementById("menu-upload");
    if (input instanceof HTMLInputElement) {
      input.value = "";
    }
  }

  return html`
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">Menu Visualizer MVP</span>
        <h1>Turn menu pages into image cards</h1>
        <p className="subhead">
          Upload one or more menu images, parse the dishes, then pair each item with a generic food photo
          and a clean card layout.
        </p>
      </section>

      <section className="grid">
        <form className="panel upload-box" onSubmit=${handleSubmit}>
          <div>
            <h2>1. Choose images</h2>
            <p className="meta">PNG, JPG, or WEBP. You can select multiple menu pages at once.</p>
          </div>

          <label className="dropzone" htmlFor="menu-upload">
            ${
              previewUrls.length === 1
                ? html`<img className="preview" src=${previewUrls[0]} alt="Selected menu preview" />`
                : previewUrls.length > 1
                  ? html`
                      <div className="multi-selection">
                        <div className="thumb-row">
                          ${previewUrls.slice(0, 4).map((previewUrl, index) => html`
                            <img
                              key=${`${previewUrl}-${index}`}
                              className="thumb"
                              src=${previewUrl}
                              alt=${`Selected menu preview ${index + 1}`}
                            />
                          `)}
                        </div>

                        <div className="dropzone-copy">
                          <strong>${fileCountLabel} selected</strong>
                          <span>The parser will merge dishes from every uploaded page.</span>
                        </div>

                        <ul className="file-list">
                          ${selectedFiles.map((file) => html`
                            <li key=${`${file.name}-${file.size}-${file.lastModified}`}>${file.name}</li>
                          `)}
                        </ul>
                      </div>
                    `
                  : html`
                      <div className="dropzone-copy">
                        <strong>Drop one or more menu images here</strong>
                        <span>or click to browse multiple files</span>
                      </div>
                    `
            }
            <input
              id="menu-upload"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange=${handleFileChange}
            />
          </label>

          <div className="actions">
            <button className="primary" type="submit" disabled=${selectedFiles.length === 0 || isSubmitting}>
              ${isSubmitting ? "Building..." : "Build visual menu"}
            </button>
            <button className="secondary" type="button" onClick=${handleReset}>
              Reset
            </button>
            <button
              className="secondary"
              type="button"
              disabled=${!result}
              onClick=${() => result && downloadJson(result, primaryDownloadName)}
            >
              Download JSON
            </button>
          </div>

          <p className=${error ? "status error" : "status"}>${error || status}</p>
        </form>

        <section className="panel visual-panel">
          <div>
            <h2>2. Visual menu</h2>
            <p className="meta">
              Each parsed dish is shown as an easy-to-read menu card with a generic Pexels food photo when available.
            </p>
          </div>

          <p className=${imageError ? "status error" : "status"}>${imageError || imageStatus}</p>

          ${
            menuCards.length > 0
              ? html`
                  <div className="menu-card-grid">
                    ${menuCards.map(({ item, imageMatch }, index) => html`
                      <${MenuCard}
                        key=${`${item.nameOriginal}-${index}`}
                        item=${item}
                        imageMatch=${imageMatch}
                      />
                    `)}
                  </div>
                `
              : html`
                  <${EmptyMenuState}
                    title="Your dish cards will appear here."
                    body="Upload menu pages first, then I’ll build the visual menu automatically."
                  />
                `
          }

          ${
            imageAttribution
              ? html`
                  <p className="pexels-credit">
                    <a href=${imageAttribution.url} target="_blank" rel="noreferrer">
                      ${imageAttribution.text}
                    </a>
                  </p>
                `
              : null
          }

          <details className="debug-block">
            <summary>Raw parsed JSON</summary>
            <pre className="compact-pre">${resultJson}</pre>
          </details>
        </section>
      </section>
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
