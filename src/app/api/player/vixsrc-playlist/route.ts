import { NextRequest, NextResponse } from "next/server";
import { encodePlayerStreamUrl } from "@/utils/playerUrlCodec";

const VIXSRC_BASE_URL = "https://vixsrc.to";
const CINEMAOS_API_BASE_URL = "https://cinemaos.tech/api/neo/resources";
const OPUK_API_BASE_URL = "https://www.opuk.cc";
const OPUK_ORIGIN = "https://www.opuk.cc";
const OPUK_REFERER = "https://www.opuk.cc/";
const WOLFFLIX_API_BASE_URL = "https://api.wolfflix.xyz";
const WOLFFLIX_ORIGIN = "https://wolfflix.xyz";
const WOLFFLIX_REFERER = "https://wolfflix.xyz/";
const ENABLE_WOLFFLIX_FALLBACK = false;
const CITY_SERVER_LABELS = {
  opuk: "Amsterdam",
  vixsrc: "Berlin",
  wolfflix: "Brussels",
  primevids: "Cairo",
  asiacloudHindi: "Delhi (Hindi)",
} as const;
const CITY_SERVER_PROVIDERS = {
  opuk: "amsterdam",
  vixsrc: "berlin",
  wolfflix: "brussels",
  primevids: "cairo",
  asiacloudHindi: "delhi",
} as const;
const REQUEST_TIMEOUT_MS = 12000;
const SECONDARY_REQUEST_TIMEOUT_MS = 6500;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const DEFAULT_WORKER_PROXY = "https://small-cake-fdee.piracya.workers.dev";
const CINEMAOS_HEADERS = {
  "user-agent": USER_AGENT,
  accept: "application/json, text/plain, */*",
  referer: "https://cinemaos.tech/",
  origin: "https://cinemaos.tech",
} as const;

type MediaType = "movie" | "tv";
type HeaderMap = Record<string, string>;

interface PlaylistSource {
  type: "hls";
  file: string;
  label: string;
  default?: boolean;
  provider?: string;
}

interface PlaylistResponse {
  playlist: Array<{
    sources: PlaylistSource[];
  }>;
}

interface ParsedMediaRequest {
  type: MediaType;
  id: string;
  season?: string;
  episode?: string;
}

interface CinemaSource {
  url?: string;
  quality?: string | number;
  format?: string;
  source?: string;
  headers?: HeaderMap | string | null;
}

interface CinemaProviderResponse {
  data?: {
    sources?: CinemaSource[];
  };
  error?: string;
}

interface OpukSecureStreamResponse {
  success?: boolean;
  secureUrl?: string;
  downloadFile?: string;
  expires?: number;
}

interface WolfflixExtractResponse {
  success?: boolean;
  streamUrl?: string;
  error?: string;
}

const isDigits = (value: string | null): value is string => !!value && /^\d+$/.test(value);

const parseMediaRequest = (params: URLSearchParams): ParsedMediaRequest | null => {
  const type = params.get("type") as MediaType | null;
  const id = params.get("id");
  if (!type || !isDigits(id)) return null;

  if (type === "movie") {
    return { type, id };
  }

  const season = params.get("season");
  const episode = params.get("episode");
  if (!isDigits(season) || !isDigits(episode)) return null;

  return { type, id, season, episode };
};

const getVixsrcPageUrl = (requestParams: ParsedMediaRequest): string => {
  if (requestParams.type === "movie") {
    return `${VIXSRC_BASE_URL}/movie/${requestParams.id}`;
  }

  return `${VIXSRC_BASE_URL}/tv/${requestParams.id}/${requestParams.season}/${requestParams.episode}`;
};

const extractMasterPlaylistUrl = (html: string, pageUrl: string): string | null => {
  const masterPlaylistBlock = html.match(/window\.masterPlaylist\s*=\s*\{([\s\S]*?)\};/i)?.[1];

  if (masterPlaylistBlock) {
    const urlMatch = masterPlaylistBlock.match(/url\s*:\s*['"]([^'"]+)['"]/i);
    const tokenMatch = masterPlaylistBlock.match(/(?:['"]token['"]|token)\s*:\s*['"]([^'"]+)['"]/i);
    const expiresMatch = masterPlaylistBlock.match(
      /(?:['"]expires['"]|expires)\s*:\s*['"]([^'"]+)['"]/i,
    );

    if (urlMatch && tokenMatch && expiresMatch) {
      const baseUrl = new URL(urlMatch[1], pageUrl);
      baseUrl.searchParams.set("token", tokenMatch[1]);
      baseUrl.searchParams.set("expires", expiresMatch[1]);
      baseUrl.searchParams.set("h", "1");
      baseUrl.searchParams.set("lang", "en");
      return baseUrl.toString();
    }
  }

  const directM3u8 = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i)?.[0];
  if (directM3u8) return directM3u8;

  return null;
};

const getWorkerBaseUrl = () =>
  (process.env.PLAYER_PROXY_URL || process.env.NEXT_PUBLIC_PLAYER_PROXY_URL || DEFAULT_WORKER_PROXY).replace(
    /\/+$/,
    "",
  );

const buildWorkerM3u8ProxyUrl = (m3u8Url: string, headers: HeaderMap): string => {
  const workerBase = getWorkerBaseUrl();
  const params = new URLSearchParams({
    url: m3u8Url,
    headers: JSON.stringify(headers),
  });
  const workerKey = process.env.PLAYER_PROXY_WORKER_KEY?.trim();
  if (workerKey) {
    params.set("k", workerKey);
  }

  // Keep a .m3u8 suffix in the path so player libraries reliably detect HLS mode.
  return `${workerBase}/m3u8-proxy/playlist.m3u8?${params.toString()}`;
};

const toPlaylistPayload = (sources: PlaylistSource[]): PlaylistResponse => ({
  playlist: [
    {
      sources,
    },
  ],
});

const tryDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const toBase64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

const parseJsonObject = <T>(value: string | null | undefined): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const normalizeHeaders = (headers: HeaderMap | string | null | undefined): HeaderMap => {
  if (!headers) return {};

  const raw = typeof headers === "string" ? parseJsonObject<Record<string, unknown>>(headers) : headers;
  if (!raw || typeof raw !== "object") return {};

  const normalized: HeaderMap = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === "string" && value.trim().length > 0) {
      normalized[key] = value;
    }
  });

  return normalized;
};

const CINEMA_SECRET_SALT = [
  "4Z7lUo",
  "gwIVSMD",
  "PLmz2elE2v",
  "Z4OFV0",
  "SZ6RZq6Zc",
  "zhJEFYxrz8",
  "FOm7b0",
  "axHS3q4KDq",
  "o9zuXQ",
  "4Aebt",
  "wgjjWwKKx",
  "rY4VIxqSN",
  "kfjbnSo",
  "2DyrFA1M",
  "YUixDM9B",
  "JQvgEj0",
  "mcuFx6JIek",
  "eoTKe26gL",
  "qaI9EVO1rB",
  "0xl33btZL",
  "1fszuAU",
  "a7jnHzst6P",
  "wQuJkX",
  "cBNhTJlEOf",
  "KNcFWhDvgT",
  "XipDGjST",
  "PCZJlbHoyt",
  "2AYnMZkqd",
  "HIpJh",
  "KH0C3iztrG",
  "W81hjts92",
  "rJhAT",
  "NON7LKoMQ",
  "NMdY3nsKzI",
  "t4En5v",
  "Qq5cOQ9H",
  "Y9nwrp",
  "VX5FYVfsf",
  "cE5SJG",
  "x1vj1",
  "HegbLe",
  "zJ3nmt4OA",
  "gt7rxW57dq",
  "clIE9b",
  "jyJ9g",
  "B5jXjMCSx",
  "cOzZBZTV",
  "FTXGy",
  "Dfh1q1",
  "ny9jqZ2POI",
  "X2NnMn",
  "MBtoyD",
  "qz4Ilys7wB",
  "68lbOMye",
  "3YUJnmxp",
  "1fv5Imona",
  "PlfvvXD7mA",
  "ZarKfHCaPR",
  "owORnX",
  "dQP1YU",
  "dVdkx",
  "qgiK0E",
  "cx9wQ",
  "5F9bGa",
  "7UjkKrp",
  "Yvhrj",
  "wYXez5Dg3",
  "pG4GMU",
  "MwMAu",
  "rFRD5wlM",
];

const stageOneHash = (input: string): string => {
  const text = String(input);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    const charCode = text.charCodeAt(index);
    hash = (charCode + (hash << 6) + (hash << 16) - hash) >>> 0;

    const rotateBy = index % 5;
    const rotated = ((hash << rotateBy) | (hash >>> (32 - rotateBy))) >>> 0;
    const shifted = (charCode << (index % 7)) | (charCode >>> (8 - (index % 7)));

    hash ^= (rotated ^ shifted) >>> 0;
    hash = (hash + ((hash >>> 11) ^ (hash << 3))) >>> 0;
  }

  hash ^= hash >>> 15;
  hash = ((hash & 0xffff) * 49842 + ((((hash >>> 16) * 49842) & 0xffff) << 16)) >>> 0;
  hash ^= hash >>> 13;
  hash = ((hash & 0xffff) * 40503 + ((((hash >>> 16) * 40503) & 0xffff) << 16)) >>> 0;
  hash ^= hash >>> 16;

  return hash.toString(16).padStart(8, "0");
};

const stageTwoHash = (input: string): string => {
  const text = String(input);
  let hash = (0xdeadbeef ^ text.length) >>> 0;

  for (let index = 0; index < text.length; index += 1) {
    let charCode = text.charCodeAt(index);
    charCode ^= ((131 * index + 89) ^ (charCode << (index % 5))) & 255;

    hash = ((((hash << 7) | (hash >>> 25)) >>> 0) ^ charCode) >>> 0;

    const low = (hash & 0xffff) * 60205;
    const high = ((hash >>> 16) * 60205) << 16;
    hash = (low + high) >>> 0;
    hash ^= hash >>> 11;
  }

  hash ^= hash >>> 15;
  hash = ((hash & 0xffff) * 49842 + (((hash >>> 16) * 49842) << 16)) >>> 0;
  hash ^= hash >>> 13;
  hash = ((hash & 0xffff) * 40503 + (((hash >>> 16) * 40503) << 16)) >>> 0;
  hash ^= hash >>> 16;
  hash = ((hash & 0xffff) * 10196 + (((hash >>> 16) * 10196) << 16)) >>> 0;
  hash ^= hash >>> 15;

  return hash.toString(16).padStart(8, "0");
};

const buildCinemaSecret = (id: string | undefined): string => {
  if (typeof id === "undefined") return "rive";

  try {
    const text = String(id);
    let salt = "";
    let insertAt = 0;

    if (Number.isNaN(Number(id))) {
      const charSum = text.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
      salt = CINEMA_SECRET_SALT[charSum % CINEMA_SECRET_SALT.length] || toBase64(text);
      insertAt = Math.floor((charSum % text.length) / 2);
    } else {
      const numeric = Number(id);
      salt = CINEMA_SECRET_SALT[numeric % CINEMA_SECRET_SALT.length] || toBase64(text);
      insertAt = Math.floor((numeric % text.length) / 2);
    }

    const mixed = text.slice(0, insertAt) + salt + text.slice(insertAt);
    return toBase64(stageTwoHash(stageOneHash(mixed)));
  } catch {
    return "topSecret";
  }
};

const extractCinemaSource = (source: CinemaSource): { url: string; headers: HeaderMap } | null => {
  if (typeof source.url !== "string" || source.url.length === 0) return null;

  let directUrl = source.url;
  const mergedHeaders: HeaderMap = {};

  try {
    const parsed = new URL(source.url);
    const wrappedUrl = parsed.searchParams.get("url");
    const wrappedHeaders = parseJsonObject<Record<string, unknown>>(
      tryDecodeURIComponent(parsed.searchParams.get("headers") || ""),
    );

    if (wrappedUrl) directUrl = tryDecodeURIComponent(wrappedUrl);
    Object.assign(mergedHeaders, normalizeHeaders(wrappedHeaders as HeaderMap));
  } catch {
    // keep original url
  }

  Object.assign(mergedHeaders, normalizeHeaders(source.headers));

  return {
    url: directUrl,
    headers: mergedHeaders,
  };
};

const fetchCinemaProviderSources = async (
  requestParams: ParsedMediaRequest,
  service: "primevids" | "asiacloud",
): Promise<CinemaSource[]> => {
  try {
    const secret = buildCinemaSecret(requestParams.id);
    const query = new URLSearchParams({
      requestID: requestParams.type === "movie" ? "movieVideoProvider" : "tvVideoProvider",
      id: requestParams.id,
      service,
      secret,
    });

    if (requestParams.type === "tv") {
      query.set("season", requestParams.season || "");
      query.set("episode", requestParams.episode || "");
    }

    const response = await fetchWithTimeout(
      `${CINEMAOS_API_BASE_URL}?${query.toString()}`,
      {
        cache: "no-store",
        headers: CINEMAOS_HEADERS,
      },
      SECONDARY_REQUEST_TIMEOUT_MS,
    );

    if (!response?.ok) return [];

    const payload = (await response.json()) as CinemaProviderResponse;
    if (!Array.isArray(payload?.data?.sources)) return [];

    return payload.data.sources;
  } catch {
    return [];
  }
};

const getOpukSecureStreamEndpoint = (requestParams: ParsedMediaRequest): string => {
  const suffix =
    requestParams.type === "movie"
      ? requestParams.id
      : `${requestParams.id}-${requestParams.season}-${requestParams.episode}`;
  return `${OPUK_API_BASE_URL}/api/secure-stream/${suffix}/`;
};

const fetchOpukSecureUrl = async (requestParams: ParsedMediaRequest): Promise<string | null> => {
  try {
    const endpoint = getOpukSecureStreamEndpoint(requestParams);
    const response = await fetchWithTimeout(
      endpoint,
      {
        cache: "no-store",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json, text/plain, */*",
          referer: OPUK_REFERER,
          origin: OPUK_ORIGIN,
        },
      },
      SECONDARY_REQUEST_TIMEOUT_MS,
    );

    if (!response?.ok) return null;

    const payload = (await response.json()) as OpukSecureStreamResponse;
    if (!payload.success || typeof payload.secureUrl !== "string" || payload.secureUrl.length === 0) {
      return null;
    }

    return payload.secureUrl;
  } catch {
    return null;
  }
};

const fetchWolfflixStreamUrl = async (requestParams: ParsedMediaRequest): Promise<string | null> => {
  try {
    const query = new URLSearchParams({
      tmdbId: requestParams.id,
    });

    if (requestParams.type === "tv") {
      query.set("s", requestParams.season || "");
      query.set("e", requestParams.episode || "");
    }

    const response = await fetchWithTimeout(
      `${WOLFFLIX_API_BASE_URL}/extract?${query.toString()}`,
      {
        cache: "no-store",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json, text/plain, */*",
          referer: WOLFFLIX_REFERER,
          origin: WOLFFLIX_ORIGIN,
        },
      },
      SECONDARY_REQUEST_TIMEOUT_MS,
    );

    if (!response?.ok) return null;

    const payload = (await response.json()) as WolfflixExtractResponse;
    if (!payload.success || typeof payload.streamUrl !== "string" || payload.streamUrl.length === 0) {
      return null;
    }

    return payload.streamUrl;
  } catch {
    return null;
  }
};

const buildVixsrcSource = (masterPlaylistUrl: string, pageUrl: string): PlaylistSource => {
  const headers: HeaderMap = {
    Referer: pageUrl,
    Origin: new URL(pageUrl).origin,
    "User-Agent": USER_AGENT,
  };

  return {
    type: "hls",
    file: buildWorkerM3u8ProxyUrl(masterPlaylistUrl, headers),
    label: CITY_SERVER_LABELS.vixsrc,
    provider: CITY_SERVER_PROVIDERS.vixsrc,
  };
};

const buildPrimeVidsFallback = (source: CinemaSource): PlaylistSource | null => {
  const resolved = extractCinemaSource(source);
  if (!resolved) return null;

  const headers = { ...resolved.headers };

  if (!headers.Referer && !headers.referer) {
    headers.Referer = "https://spencerdevs.xyz/";
  }
  if (!headers.Origin && !headers.origin) {
    headers.Origin = "https://spencerdevs.xyz";
  }

  return {
    type: "hls",
    file: buildWorkerM3u8ProxyUrl(resolved.url, headers),
    label: CITY_SERVER_LABELS.primevids,
    provider: CITY_SERVER_PROVIDERS.primevids,
  };
};

const buildAsiacloudHindiFallback = (sources: CinemaSource[]): PlaylistSource | null => {
  const hindiExact = sources.find((source) => String(source.quality || "").toLowerCase() === "hindi");
  const hindiLoose = sources.find((source) =>
    String(source.quality || "").toLowerCase().includes("hindi"),
  );
  const selected = hindiExact || hindiLoose;
  if (!selected) return null;

  const resolved = extractCinemaSource(selected);
  if (!resolved) return null;

  return {
    type: "hls",
    file: buildWorkerM3u8ProxyUrl(resolved.url, resolved.headers),
    label: CITY_SERVER_LABELS.asiacloudHindi,
    provider: CITY_SERVER_PROVIDERS.asiacloudHindi,
  };
};

const buildOpukFallback = (secureUrl: string): PlaylistSource => {
  const headers: HeaderMap = {
    Referer: OPUK_REFERER,
    Origin: OPUK_ORIGIN,
    "User-Agent": USER_AGENT,
  };

  return {
    type: "hls",
    file: buildWorkerM3u8ProxyUrl(secureUrl, headers),
    label: CITY_SERVER_LABELS.opuk,
    provider: CITY_SERVER_PROVIDERS.opuk,
  };
};

const buildWolfflixLocalProxyUrl = (request: NextRequest, upstreamUrl: string): string => {
  const url = new URL("/api/player/wolfflix-proxy", request.nextUrl.origin);
  url.searchParams.set("url", upstreamUrl);
  return url.toString();
};

const buildWolfflixFallback = (request: NextRequest, streamUrl: string): PlaylistSource => {
  return {
    type: "hls",
    // Route through local proxy so external HLS clients can consume it without Wolfflix CORS whitelist issues.
    file: buildWolfflixLocalProxyUrl(request, streamUrl),
    label: CITY_SERVER_LABELS.wolfflix,
    provider: CITY_SERVER_PROVIDERS.wolfflix,
  };
};

const getSecondarySources = async (
  request: NextRequest,
  requestParams: ParsedMediaRequest,
): Promise<PlaylistSource[]> => {
  const wolfflixPromise = ENABLE_WOLFFLIX_FALLBACK
    ? fetchWolfflixStreamUrl(requestParams)
    : Promise.resolve<string | null>(null);

  const [opukResult, wolfflixResult, primeResult, asiaResult] = await Promise.allSettled([
    fetchOpukSecureUrl(requestParams),
    wolfflixPromise,
    fetchCinemaProviderSources(requestParams, "primevids"),
    fetchCinemaProviderSources(requestParams, "asiacloud"),
  ]);

  const secondary: PlaylistSource[] = [];

  if (opukResult.status === "fulfilled" && opukResult.value) {
    secondary.push(buildOpukFallback(opukResult.value));
  }

  if (ENABLE_WOLFFLIX_FALLBACK && wolfflixResult.status === "fulfilled" && wolfflixResult.value) {
    secondary.push(buildWolfflixFallback(request, wolfflixResult.value));
  }

  if (primeResult.status === "fulfilled") {
    const candidate = primeResult.value.find((source) => typeof source.url === "string");
    if (candidate) {
      const prime = buildPrimeVidsFallback(candidate);
      if (prime) secondary.push(prime);
    }
  }

  if (asiaResult.status === "fulfilled") {
    const asia = buildAsiacloudHindiFallback(asiaResult.value);
    if (asia) secondary.push(asia);
  }

  return secondary;
};

const dedupeSources = (sources: PlaylistSource[]): PlaylistSource[] => {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.file)) return false;
    seen.add(source.file);
    return true;
  });
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchVixsrcSource = async (pageUrl: string, signal: AbortSignal): Promise<PlaylistSource | null> => {
  try {
    const vixsrcResponse = await fetch(pageUrl, {
      cache: "no-store",
      signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!vixsrcResponse.ok) return null;

    const html = await vixsrcResponse.text();
    const masterPlaylistUrl = extractMasterPlaylistUrl(html, pageUrl);
    if (!masterPlaylistUrl) return null;

    return buildVixsrcSource(masterPlaylistUrl, pageUrl);
  } catch {
    return null;
  }
};

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const requestParams = parseMediaRequest(request.nextUrl.searchParams);
  if (!requestParams) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const pageUrl = getVixsrcPageUrl(requestParams);
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);

  try {
    const [vixsrcSource, secondarySources] = await Promise.all([
      fetchVixsrcSource(pageUrl, timeout.signal),
      getSecondarySources(request, requestParams),
    ]);
    const opukSource =
      secondarySources.find((source) => source.provider === CITY_SERVER_PROVIDERS.opuk) || null;
    const remainingSecondary = secondarySources.filter(
      (source) => source.provider !== CITY_SERVER_PROVIDERS.opuk,
    );

    const orderedSources = dedupeSources(
      [opukSource, vixsrcSource, ...remainingSecondary].filter(Boolean) as PlaylistSource[],
    ).map((source, index) => ({
      ...source,
      default: index === 0,
    }));

    if (!orderedSources.length) {
      return NextResponse.json({ error: "Failed to resolve any playable source" }, { status: 502 });
    }

    const encodedSources = orderedSources.map((source) => ({
      ...source,
      file: encodePlayerStreamUrl(source.file),
    }));

    return NextResponse.json(toPlaylistPayload(encodedSources), {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected proxy error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
  }
};
