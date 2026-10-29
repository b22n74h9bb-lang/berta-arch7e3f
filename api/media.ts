import { storage, StorageError } from "./lib/storage";

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export type GeneratedImageAsset = {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
};

export class ImageGenerationError extends Error {
  readonly code: "configuration" | "quota" | "rate-limited" | "rejected" | "timeout" | "upstream";

  constructor(code: ImageGenerationError["code"], message: string) {
    super(message);
    this.name = "ImageGenerationError";
    this.code = code;
  }
}

function gatewayToolsUrl(): string {
  const raw = process.env.KIMI_AGENTGW_BASE_URL?.trim();
  const key = process.env.KIMI_AGENTGW_API_KEY?.trim();
  if (!raw || !key) {
    throw new ImageGenerationError(
      "configuration",
      "Image generation is not provisioned for this site yet. Publish or reopen the site once, then retry.",
    );
  }
  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  const toolBase = withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash.slice(0, -3)
    : withoutTrailingSlash;
  return `${toolBase}/v1/tools`;
}

function compactError(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

async function requestImage(description: string, size: ImageSize) {
  const apiKey = process.env.KIMI_AGENTGW_API_KEY?.trim();
  if (!apiKey) {
    throw new ImageGenerationError("configuration", "The image-generation credential is missing.");
  }

  let response: Response;
  try {
    response = await fetch(gatewayToolsUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Kimi-Plugin": "image_generation",
      },
      body: JSON.stringify({
        method: "generate_image",
        params: {
          description,
          size,
          background: "IMAGE_BACKGROUND_OPAQUE",
          version: "v2",
        },
      }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ImageGenerationError(
        "timeout",
        "Image generation exceeded the four-minute request limit. No automatic retry was made.",
      );
    }
    throw new ImageGenerationError(
      "upstream",
      `The image gateway could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!response.ok) {
    const message = compactError(text || response.statusText);
    if (response.status === 429) {
      throw new ImageGenerationError(
        "rate-limited",
        "The image service is rate limited right now. Wait for current work to finish before trying again.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ImageGenerationError(
        "quota",
        "Image generation is unavailable for the site owner’s current quota or gateway permissions.",
      );
    }
    if (response.status === 400) {
      throw new ImageGenerationError("rejected", message || "The image request was rejected.");
    }
    throw new ImageGenerationError("upstream", message || `Image generation failed with HTTP ${response.status}.`);
  }

  const media = (data as { media?: { url?: unknown; mime_type?: unknown }; error?: unknown }).media;
  const directError = (data as { error?: unknown }).error;
  if (directError) {
    const message = typeof directError === "string" ? directError : JSON.stringify(directError);
    if (/reject|policy|content/i.test(message)) {
      throw new ImageGenerationError("rejected", "The image prompt was rejected by the generation service.");
    }
    if (/quota|402|payment/i.test(message)) {
      throw new ImageGenerationError("quota", "Image generation quota is exhausted for the site owner.");
    }
    throw new ImageGenerationError("upstream", compactError(message));
  }
  if (!media || typeof media.url !== "string" || !media.url) {
    throw new ImageGenerationError("upstream", "The image service returned no media URL.");
  }
  return {
    url: media.url,
    mimeType: typeof media.mime_type === "string" ? media.mime_type : "image/png",
  };
}

async function downloadImage(url: string, mimeType: string) {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new ImageGenerationError(
      error instanceof Error && error.name === "TimeoutError" ? "timeout" : "upstream",
      "The generated image could not be downloaded before the request limit.",
    );
  }
  if (!response.ok) {
    throw new ImageGenerationError("upstream", `Generated image download failed with HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new ImageGenerationError("upstream", "The generated image download was empty.");
  }
  return {
    bytes,
    contentType: response.headers.get("content-type")?.split(";")[0] || mimeType,
  };
}

export async function generateAndStoreImage(input: {
  userId: number;
  prompt: string;
  size: ImageSize;
}): Promise<GeneratedImageAsset> {
  const media = await requestImage(input.prompt, input.size);
  const downloaded = await downloadImage(media.url, media.mimeType);
  const extension = downloaded.contentType.includes("jpeg") ? "jpg" : "png";

  let saved;
  try {
    saved = await storage.uploadFile({
      fileContent: downloaded.bytes,
      fileName: `u/${input.userId}/berta-images/generated.${extension}`,
      contentType: downloaded.contentType,
    });
  } catch (error) {
    if (error instanceof StorageError) {
      if (error.code === "STORAGE_QUOTA_EXCEEDED") {
        throw new ImageGenerationError("quota", "Mission media storage is full; no replacement upload was attempted.");
      }
      if (error.code === "STORAGE_REVIEW_REJECTED") {
        throw new ImageGenerationError("rejected", "The generated image was rejected during storage review.");
      }
      throw new ImageGenerationError("upstream", `The image could not be saved: ${error.message}`);
    }
    throw error;
  }

  const url = await getStoredImageUrl(saved.key);
  return {
    key: saved.key,
    url,
    contentType: saved.contentType,
    sizeBytes: saved.size,
  };
}

export async function getStoredImageUrl(key: string): Promise<string> {
  const result = await storage.getPresignedUrl({ key });
  return result.url;
}
