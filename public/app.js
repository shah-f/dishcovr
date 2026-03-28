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

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("Pick a menu image and I’ll send it to the parser.");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resultJson = result ? formatJson(result) : "{\n  \"items\": []\n}";

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    setError("");
    setResult(null);

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl("");
      setStatus("Pick a menu image and I’ll send it to the parser.");
      return;
    }

    if (!ACCEPTED_TYPES.has(file.type)) {
      setSelectedFile(null);
      setPreviewUrl("");
      setStatus("Waiting for a supported image.");
      setError("Use a PNG, JPG, JPEG, or WEBP image.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setStatus("Ready to parse.");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedFile) {
      setError("Choose an image first.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setStatus("Parsing menu image...");

    try {
      const imageBase64 = await fileToBase64(selectedFile);
      const response = await fetch("/api/parse-menu", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          imageBase64,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Upload failed.");
      }

      setResult(payload);
      setStatus(`Parsed ${payload.items.length} menu items.`);
    } catch (submitError) {
      setResult(null);
      setStatus("Upload failed.");
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl("");
    setError("");
    setResult(null);
    setStatus("Pick a menu image and I’ll send it to the parser.");

    const input = document.getElementById("menu-upload");
    if (input instanceof HTMLInputElement) {
      input.value = "";
    }
  }

  return html`
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">Menu OCR MVP</span>
        <h1>Upload a menu</h1>
        <p className="subhead">
          Send one menu image to the backend, call menuParser.ts, 
          look at json.
        </p>
      </section>

      <section className="grid">
        <form className="panel upload-box" onSubmit=${handleSubmit}>
          <div>
            <h2>1. Choose an image</h2>
            <p className="meta">PNG, JPG, or WEBP. </p>
          </div>

          <label className="dropzone" htmlFor="menu-upload">
            ${
              previewUrl
                ? html`<img className="preview" src=${previewUrl} alt="Selected menu preview" />`
                : html`
                    <div className="dropzone-copy">
                      <strong>Drop a menu image here</strong>
                      <span>or click to browse</span>
                    </div>
                  `
            }
            <input
              id="menu-upload"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange=${handleFileChange}
            />
          </label>

          <div className="actions">
            <button className="primary" type="submit" disabled=${!selectedFile || isSubmitting}>
              ${isSubmitting ? "Parsing..." : "Parse menu"}
            </button>
            <button className="secondary" type="button" onClick=${handleReset}>
              Reset
            </button>
            <button
              className="secondary"
              type="button"
              disabled=${!result}
              onClick=${() => result && downloadJson(result, selectedFile?.name || "menu-results")}
            >
              Download JSON
            </button>
          </div>

          <p className=${error ? "status error" : "status"}>${error || status}</p>
        </form>

        <section className="panel">
          <div>
            <h2>2. Parsed output</h2>
            <p className="meta">The backend response is shown exactly as JSON for now.</p>
          </div>
          <pre>${resultJson}</pre>
        </section>
      </section>
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
