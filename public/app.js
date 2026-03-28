import React, { useEffect, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CART_SPEECH_LANGUAGES = [
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "zh", label: "Chinese" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
];

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

  if (sourceCounts.themealdb) {
    parts.push(`${sourceCounts.themealdb} from TheMealDB`);
  }

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

function buildSourceLabel(imageMatch) {
  switch (imageMatch?.source) {
    case "themealdb":
      return "TheMealDB";
    case "wikimedia":
      return "Wikipedia";
    case "pexels":
      return "Pexels";
    default:
      return null;
  }
}

function buildCartKey(index) {
  return String(index);
}

function resolveCartSpeechLanguage(value) {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return null;
  }

  return CART_SPEECH_LANGUAGES.find((language) =>
    language.label.toLowerCase() === normalizedValue || language.code.toLowerCase() === normalizedValue,
  ) ?? null;
}

function base64ToBlobUrl(base64, mimeType) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function EmptyMenuState({ title, body }) {
  return html`
    <div className="empty-menu-state">
      <strong>${title}</strong>
      <span>${body}</span>
    </div>
  `;
}

function AllergenBadges({ allergens }) {
  if (!allergens || allergens.length === 0) {
    return null;
  }

  return html`
    <div className="allergen-row">
      <span className="allergen-label">⚠️ Contains:</span>
      ${allergens.map((allergen) => html`
        <span key=${allergen} className="allergen-badge">${allergen}</span>
      `)}
    </div>
  `;
}

function MenuCard({ item, imageMatch, quantity, onAddToCart, onIncreaseQuantity, onDecreaseQuantity }) {
  const displayName = buildDisplayName(item);
  const secondaryName = buildSecondaryName(item);
  const image = imageMatch?.image ?? null;
  const placeholderStyle = image?.avgColor ? { background: image.avgColor } : undefined;
  const sourceLabel = buildSourceLabel(imageMatch);
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
                ${sourceLabel ? html`<span className="image-source-pill">${sourceLabel}</span>` : null}
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
                <small>No photo yet</small>
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

        <${AllergenBadges} allergens=${item.allergens} />

        <div className="menu-card-cart-row">
          ${
            quantity > 0
              ? html`
                  <div className="quantity-stepper">
                    <button
                      className="quantity-button"
                      type="button"
                      onClick=${onDecreaseQuantity}
                      aria-label=${`Decrease quantity for ${displayName}`}
                    >
                      -
                    </button>
                    <span className="quantity-value">${quantity}</span>
                    <button
                      className="quantity-button"
                      type="button"
                      onClick=${onIncreaseQuantity}
                      aria-label=${`Increase quantity for ${displayName}`}
                    >
                      +
                    </button>
                  </div>
                `
              : html`
                  <button className="secondary cart-add-button" type="button" onClick=${onAddToCart}>
                    Add to cart
                  </button>
                `
          }

          ${quantity > 0 ? html`<span className="cart-inline-note">${quantity} in cart</span>` : null}
        </div>

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

function CartPanel({
  entries,
  itemCount,
  isOpen,
  onToggle,
  onIncreaseQuantity,
  onDecreaseQuantity,
  onClearCart,
  isLanguageOrderEnabled,
  onToggleLanguageOrder,
  languageSearchValue,
  onLanguageSearchChange,
  onGenerateSpeech,
  speechStatus,
  speechError,
  spokenOrderText,
  speechAudioUrl,
  isGeneratingSpeech,
}) {
  return html`
    <section className="cart-panel">
      <div className="cart-panel-header">
        <div>
          <p className="cart-panel-label">Cart</p>
          <h3>${itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"} selected` : "Start building an order"}</h3>
        </div>

        <div className="cart-panel-actions">
          ${entries.length > 0
            ? html`
                <button className="secondary compact-button" type="button" onClick=${onClearCart}>
                  Clear
                </button>
              `
            : null}
          <button className="primary compact-button" type="button" onClick=${onToggle}>
            ${isOpen ? "Hide cart" : `Open cart${itemCount > 0 ? ` (${itemCount})` : ""}`}
          </button>
        </div>
      </div>

      <div className="language-order-panel">
        <label className="language-toggle">
          <input
            type="checkbox"
            checked=${isLanguageOrderEnabled}
            onChange=${(event) => onToggleLanguageOrder(event.target.checked)}
          />
          <span>Order in a different language</span>
        </label>

        ${
          isLanguageOrderEnabled
            ? html`
                <div className="speech-tools">
                  <div className="language-search-field">
                    <label htmlFor="cart-language-search">Search language</label>
                    <input
                      id="cart-language-search"
                      className="language-search-input"
                      type="text"
                      list="cart-language-options"
                      value=${languageSearchValue}
                      placeholder="Type a language like Spanish or Japanese"
                      onInput=${(event) => onLanguageSearchChange(event.target.value)}
                    />
                    <datalist id="cart-language-options">
                      ${CART_SPEECH_LANGUAGES.map((language) => html`
                        <option key=${language.code} value=${language.label}>
                          ${language.code.toUpperCase()}
                        </option>
                      `)}
                    </datalist>
                  </div>

                  <button
                    className="primary compact-button"
                    type="button"
                    disabled=${entries.length === 0 || isGeneratingSpeech}
                    onClick=${onGenerateSpeech}
                  >
                    ${isGeneratingSpeech ? "Generating audio..." : "Speak to waiter"}
                  </button>

                  <p className=${speechError ? "status error" : "status"}>
                    ${speechError || speechStatus}
                  </p>

                  ${
                    spokenOrderText
                      ? html`
                          <div className="spoken-order-preview">
                            <p className="cart-panel-label">Generated script</p>
                            <p>${spokenOrderText}</p>
                          </div>
                        `
                      : null
                  }

                  ${
                    speechAudioUrl
                      ? html`<audio className="speech-audio" controls src=${speechAudioUrl}></audio>`
                      : null
                  }
                </div>
              `
            : null
        }
      </div>

      ${
        isOpen
          ? entries.length > 0
            ? html`
                <div className="cart-entry-list">
                  ${entries.map((entry) => html`
                    <div key=${entry.key} className="cart-entry">
                      <div className="cart-entry-copy">
                        <strong>${entry.displayName}</strong>
                        ${entry.secondaryName ? html`<span>${entry.secondaryName}</span>` : null}
                        ${entry.item.price ? html`<small>${entry.item.price}</small>` : null}
                      </div>

                      <div className="quantity-stepper compact-stepper">
                        <button
                          className="quantity-button"
                          type="button"
                          onClick=${() => onDecreaseQuantity(entry.key)}
                          aria-label=${`Decrease quantity for ${entry.displayName}`}
                        >
                          -
                        </button>
                        <span className="quantity-value">${entry.quantity}</span>
                        <button
                          className="quantity-button"
                          type="button"
                          onClick=${() => onIncreaseQuantity(entry.key)}
                          aria-label=${`Increase quantity for ${entry.displayName}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  `)}
                </div>
              `
            : html`
                <${EmptyMenuState}
                  title="No dishes in the cart yet."
                  body="Use the Add to cart button on any dish card, then adjust quantities here."
                />
              `
          : null
      }
    </section>
  `;
}

function SpeakingModeOverlay({ languageLabel, spokenOrderText, speechAudioUrl, onClose, audioRef }) {
  return html`
    <div className="speaking-mode-overlay" role="dialog" aria-modal="true" aria-labelledby="speaking-mode-title">
      <div className="speaking-mode-card">
        <div className="speaking-mode-header">
          <div>
            <p className="cart-panel-label">Speaking to waiter mode</p>
            <h2 id="speaking-mode-title">Your order is ready in ${languageLabel}</h2>
          </div>

          <button className="secondary compact-button close-speaking-button" type="button" onClick=${onClose}>
            Close mode
          </button>
        </div>

        <p className="speaking-mode-copy">
          The rest of the app is paused while this mode is open, so you can focus on playing the translated order
          for the waiter.
        </p>

        ${
          spokenOrderText
            ? html`
                <div className="spoken-order-preview speaking-script">
                  <p className="cart-panel-label">Spoken order</p>
                  <p>${spokenOrderText}</p>
                </div>
              `
            : null
        }

        ${
          speechAudioUrl
            ? html`
                <audio
                  ref=${audioRef}
                  className="speech-audio speaking-audio"
                  controls
                  autoPlay
                  src=${speechAudioUrl}
                ></audio>
              `
            : null
        }
      </div>
    </div>
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
  const [cartQuantities, setCartQuantities] = useState({});
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isLanguageOrderEnabled, setIsLanguageOrderEnabled] = useState(false);
  const [languageSearchValue, setLanguageSearchValue] = useState("Spanish");
  const [speechStatus, setSpeechStatus] = useState("Choose a language and generate an order phrase when you're ready.");
  const [speechError, setSpeechError] = useState("");
  const [spokenOrderText, setSpokenOrderText] = useState("");
  const [speechAudioUrl, setSpeechAudioUrl] = useState("");
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [isSpeakingModeOpen, setIsSpeakingModeOpen] = useState(false);
  const [activeSpeechLanguageLabel, setActiveSpeechLanguageLabel] = useState("");
  const speakingAudioRef = useRef(null);

  const resultJson = result ? formatJson(result) : placeholderJson();
  const primaryDownloadName = selectedFiles.length === 1 ? selectedFiles[0].name : "menu-results";
  const fileCountLabel = `${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"}`;
  const parsedItemCount = result?.items?.length ?? 0;
  const resolvedImageCount = menuCards.filter(({ imageMatch }) => Boolean(imageMatch?.image)).length;
  const cartEntries = menuCards.reduce((entries, { item }, index) => {
    const key = buildCartKey(index);
    const quantity = cartQuantities[key] ?? 0;

    if (quantity > 0) {
      entries.push({
        key,
        item,
        quantity,
        displayName: buildDisplayName(item),
        secondaryName: buildSecondaryName(item),
      });
    }

    return entries;
  }, []);
  const cartItemCount = cartEntries.reduce((count, entry) => count + entry.quantity, 0);
  const cartDistinctCount = cartEntries.length;

  useEffect(() => {
    if (!isSpeakingModeOpen || !speechAudioUrl || !speakingAudioRef.current) {
      return;
    }

    speakingAudioRef.current.currentTime = 0;
    speakingAudioRef.current.play().catch(() => {});
  }, [isSpeakingModeOpen, speechAudioUrl]);

  function revokePreviewUrls(urls) {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }

  function resetCartState() {
    setCartQuantities({});
    setIsCartOpen(false);
    setIsLanguageOrderEnabled(false);
    setIsSpeakingModeOpen(false);
  }

  function clearSpeechAudio() {
    if (speakingAudioRef.current) {
      speakingAudioRef.current.pause();
      speakingAudioRef.current.currentTime = 0;
    }
    if (speechAudioUrl) {
      URL.revokeObjectURL(speechAudioUrl);
    }
    setSpeechAudioUrl("");
  }

  function resetSpeechState(
    nextStatus = "Choose a language and generate an order phrase when you're ready.",
  ) {
    clearSpeechAudio();
    setIsSpeakingModeOpen(false);
    setSpeechStatus(nextStatus);
    setSpeechError("");
    setSpokenOrderText("");
    setActiveSpeechLanguageLabel("");
    setIsGeneratingSpeech(false);
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
    resetCartState();
    resetSpeechState();

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

  function adjustCartQuantity(itemKey, delta) {
    resetSpeechState("Your spoken order will update after you generate it again.");
    setCartQuantities((current) => {
      const nextQuantity = (current[itemKey] ?? 0) + delta;

      if (nextQuantity <= 0) {
        const { [itemKey]: _removed, ...remaining } = current;
        return remaining;
      }

      return {
        ...current,
        [itemKey]: nextQuantity,
      };
    });
  }

  function handleAddToCart(itemKey) {
    adjustCartQuantity(itemKey, 1);
    setIsCartOpen(true);
  }

  function handleIncreaseQuantity(itemKey) {
    adjustCartQuantity(itemKey, 1);
  }

  function handleDecreaseQuantity(itemKey) {
    adjustCartQuantity(itemKey, -1);
  }

  function closeSpeakingMode() {
    if (speakingAudioRef.current) {
      speakingAudioRef.current.pause();
      speakingAudioRef.current.currentTime = 0;
    }
    setIsSpeakingModeOpen(false);
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

  async function handleGenerateCartSpeech() {
    if (cartEntries.length === 0) {
      setSpeechError("Add at least one dish to the cart first.");
      return;
    }

    const selectedLanguage = resolveCartSpeechLanguage(languageSearchValue);
    if (!selectedLanguage) {
      setSpeechError("Choose a language from the list before generating audio.");
      return;
    }

    setIsGeneratingSpeech(true);
    setSpeechError("");
    setSpeechStatus(`Generating your order in ${selectedLanguage.label}...`);
    clearSpeechAudio();

    try {
      const response = await fetch("/api/cart-speech", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          languageCode: selectedLanguage.code,
          languageLabel: selectedLanguage.label,
          items: cartEntries.map((entry) => ({
            name: entry.item.nameOriginal,
            originalName: entry.item.nameOriginal,
            alternateName: entry.secondaryName,
            price: entry.item.price ?? null,
            quantity: entry.quantity,
          })),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Could not generate order audio.");
      }

      const nextAudioUrl = base64ToBlobUrl(payload.audioBase64, payload.mimeType || "audio/mpeg");
      setSpeechAudioUrl(nextAudioUrl);
      setSpokenOrderText(payload.script || "");
      setSpeechStatus(`Order audio ready in ${selectedLanguage.label}.`);
      setActiveSpeechLanguageLabel(selectedLanguage.label);
      setIsSpeakingModeOpen(true);
    } catch (generateError) {
      setSpeechError(
        generateError instanceof Error ? generateError.message : "Could not generate order audio.",
      );
      setSpeechStatus("Choose a language and try again.");
    } finally {
      setIsGeneratingSpeech(false);
    }
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
    resetSpeechState();
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
      resetCartState();
      resetSpeechState();
      setStatus(
        `Parsed ${payload.items.length} menu items from ${payload.imageCount} image${payload.imageCount === 1 ? "" : "s"}.`,
      );
      setImageStatus("Finding food photos for each dish...");

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
      resetCartState();
      resetSpeechState();
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
    resetCartState();
    resetSpeechState();

    const input = document.getElementById("menu-upload");
    if (input instanceof HTMLInputElement) {
      input.value = "";
    }
  }

  return html`
    <main className=${isSpeakingModeOpen ? "shell shell-locked" : "shell"} aria-hidden=${isSpeakingModeOpen ? "true" : "false"}>
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow-row">
              <span className="eyebrow">Menu Visualizer MVP</span>
              <span className="hero-mini-note">multi-page upload</span>
            </div>
            <h1>Turn menu pages into polished dish cards</h1>
            <p className="subhead">
              Upload one or more menu images, extract the dishes, and rebuild the menu as a cleaner,
              image-first experience your guests can actually scan.
            </p>
            <div className="hero-pills">
              <span className="hero-pill">OCR + translation</span>
              <span className="hero-pill">dish descriptions</span>
              <span className="hero-pill">food photo matching</span>
            </div>
          </div>

          <aside className="hero-note">
            <p className="hero-note-label">Studio direction</p>
            <p className="hero-note-title">Keep the menu content, lose the clutter.</p>
            <p className="hero-note-body">
              This version keeps your upload workflow lightweight while making the output feel closer to a
              designed digital menu than raw OCR output.
            </p>
          </aside>
        </div>

        <div className="hero-metrics">
          <div className="metric">
            <strong>${selectedFiles.length}</strong>
            <span>pages loaded</span>
          </div>
          <div className="metric">
            <strong>${parsedItemCount}</strong>
            <span>dishes parsed</span>
          </div>
          <div className="metric">
            <strong>${resolvedImageCount}</strong>
            <span>cards with photos</span>
          </div>
        </div>
      </section>

      <section className="grid">
        <form className="panel upload-box" onSubmit=${handleSubmit}>
          <div className="panel-heading">
            <span className="panel-step">Step 1</span>
            <div>
              <h2>Upload menu pages</h2>
              <p className="meta">PNG, JPG, or WEBP. You can select multiple menu pages at once.</p>
            </div>
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
          <div className="panel-heading">
            <span className="panel-step">Step 2</span>
            <div>
              <h2>Visual menu</h2>
              <p className="meta">
                Each parsed dish is shown as an easy-to-read card, with food photography when a believable
                match is available.
              </p>
            </div>
          </div>

          <div className="summary-strip">
            <span className="summary-pill">${parsedItemCount} parsed</span>
            <span className="summary-pill">${resolvedImageCount} with photos</span>
            <span className="summary-pill">${menuCards.length} cards shown</span>
            <span className="summary-pill">${cartItemCount} in cart</span>
            <span className="summary-pill">${cartDistinctCount} dishes chosen</span>
          </div>

          <p className=${imageError ? "status error" : "status"}>${imageError || imageStatus}</p>

          ${
            menuCards.length > 0
              ? html`
                  <${CartPanel}
                    entries=${cartEntries}
                    itemCount=${cartItemCount}
                    isOpen=${isCartOpen}
                    onToggle=${() => setIsCartOpen((current) => !current)}
                    onIncreaseQuantity=${handleIncreaseQuantity}
                    onDecreaseQuantity=${handleDecreaseQuantity}
                    onClearCart=${() => {
                      resetCartState();
                      resetSpeechState();
                    }}
                    isLanguageOrderEnabled=${isLanguageOrderEnabled}
                    onToggleLanguageOrder=${(checked) => {
                      setIsLanguageOrderEnabled(checked);
                      if (!checked) {
                        resetSpeechState();
                      }
                    }}
                    languageSearchValue=${languageSearchValue}
                    onLanguageSearchChange=${(value) => {
                      setLanguageSearchValue(value);
                      if (spokenOrderText || speechAudioUrl) {
                        resetSpeechState("Language changed. Generate a fresh spoken order when you're ready.");
                      } else {
                        setSpeechError("");
                      }
                    }}
                    onGenerateSpeech=${handleGenerateCartSpeech}
                    speechStatus=${speechStatus}
                    speechError=${speechError}
                    spokenOrderText=${spokenOrderText}
                    speechAudioUrl=${speechAudioUrl}
                    isGeneratingSpeech=${isGeneratingSpeech}
                  />
                `
              : null
          }

          ${
            menuCards.length > 0
              ? html`
                  <div className="menu-card-grid">
                    ${menuCards.map(({ item, imageMatch }, index) => html`
                      <${MenuCard}
                        key=${`${item.nameOriginal}-${index}`}
                        item=${item}
                        imageMatch=${imageMatch}
                        quantity=${cartQuantities[buildCartKey(index)] ?? 0}
                        onAddToCart=${() => handleAddToCart(buildCartKey(index))}
                        onIncreaseQuantity=${() => handleIncreaseQuantity(buildCartKey(index))}
                        onDecreaseQuantity=${() => handleDecreaseQuantity(buildCartKey(index))}
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

    ${
      isSpeakingModeOpen
        ? html`
            <${SpeakingModeOverlay}
              languageLabel=${activeSpeechLanguageLabel || resolveCartSpeechLanguage(languageSearchValue)?.label || "your selected language"}
              spokenOrderText=${spokenOrderText}
              speechAudioUrl=${speechAudioUrl}
              onClose=${closeSpeakingMode}
              audioRef=${speakingAudioRef}
            />
          `
        : null
    }
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
