"use strict";

const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = Number(process.env.PORT || 7000);
const API_BASE = (process.env.NGUONC_API_BASE || "https://phim.nguonc.com/api").replace(/\/+$/, "");
const CACHE_MS = Number(process.env.CACHE_TTL_MS || 300000);
const PAGE_SIZE = 10; // NguonC paginate.items_per_page, verified against the live API.
const cache = new Map();

const catalogs = [
  { type: "movie", id: "nguonc_movies", name: "NguồnC • Phim lẻ", path: "films/danh-sach/phim-le" },
  { type: "series", id: "nguonc_series", name: "NguồnC • Phim bộ", path: "films/danh-sach/phim-bo" }
];

const manifest = {
  id: "vn.nguonc.stremio",
  version: "2.0.0",
  name: "NguồnC Việt Nam",
  description: "Danh sách, thông tin phim và tập từ API NguồnC.",
  resources: [
    "catalog",
    { name: "meta", types: ["movie", "series"], idPrefixes: ["nguonc:"] },
    { name: "stream", types: ["movie", "series"], idPrefixes: ["nguonc:"] }
  ],
  types: ["movie", "series"],
  catalogs: catalogs.map(({ type, id, name }) => ({
    type, id, name,
    extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
  }))
};

const builder = new addonBuilder(manifest);
const str = value => value == null ? "" : String(value).trim();
const idFor = slug => `nguonc:${slug}`;
const slugFor = id => str(id).startsWith("nguonc:") ? str(id).slice(7) : "";
const groups = category => Array.isArray(category) ? category : Object.values(category || {});

function fieldList(category, groupName) {
  return groups(category)
    .filter(group => str(group?.group?.name).toLowerCase() === groupName.toLowerCase())
    .flatMap(group => Array.isArray(group.list) ? group.list : [])
    .map(item => str(item?.name)).filter(Boolean);
}

function movieType(movie) {
  const formats = fieldList(movie?.category, "Định dạng").map(x => x.toLowerCase());
  if (formats.includes("phim lẻ")) return "movie";
  if (formats.includes("phim bộ")) return "series";
  return Number(movie?.total_episodes) > 1 ? "series" : "movie";
}

function image(value) {
  const url = str(value);
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://phim.nguonc.com/${url.replace(/^\/+/, "")}`;
}

function remember(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

async function api(path) {
  const url = `${API_BASE}/${path.replace(/^\/+/, "")}`;
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "NguonC-Stremio-Addon/2.0" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const body = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`NguonC API HTTP ${response.status}: ${url}; ${body}`);
  }
  const data = await response.json();
  if (data?.status !== "success") throw new Error(`NguonC API error: ${url}`);
  return remember(url, data);
}

function preview(movie, type) {
  const poster = image(movie.poster_url || movie.thumb_url);
  if (!movie.slug || !movie.name || !poster) return null;
  return {
    id: idFor(movie.slug), type, name: str(movie.name), poster,
    posterShape: "poster", description: str(movie.description),
    releaseInfo: str(movie.year)
  };
}

function episodeNumber(item, index) {
  const text = str(item?.name || item?.slug);
  const match = text.match(/(?:tập|tap|episode|ep)[\s-]*(\d+)/i) || text.match(/^(\d+)$/);
  return match ? Number(match[1]) : index + 1;
}

function episodeItems(movie) {
  const seen = new Set();
  const result = [];
  for (const server of Array.isArray(movie?.episodes) ? movie.episodes : []) {
    for (const item of Array.isArray(server?.items) ? server.items : []) {
      if (!item.slug || seen.has(item.slug)) continue;
      seen.add(item.slug);
      result.push(item);
    }
  }
  return result;
}

function episodeId(movieSlug, episodeSlug) {
  return `${idFor(movieSlug)}:ep:${episodeSlug}`;
}

function metaFrom(movie, type) {
  const poster = image(movie.poster_url || movie.thumb_url);
  const meta = {
    id: idFor(movie.slug), type, name: str(movie.name), poster,
    background: image(movie.poster_url || movie.thumb_url),
    posterShape: "poster", description: str(movie.description),
    releaseInfo: str(movie.year), runtime: str(movie.time),
    genres: fieldList(movie.category, "Thể loại"),
    country: fieldList(movie.category, "Quốc gia").join(", ") || undefined,
    director: str(movie.director) ? [str(movie.director)] : undefined,
    cast: str(movie.casts) ? str(movie.casts).split(",").map(str).filter(Boolean) : undefined
  };
  if (type === "series") {
    meta.videos = episodeItems(movie).map((item, index) => ({
      id: episodeId(movie.slug, item.slug),
      title: str(item.name) || `Tập ${index + 1}`,
      season: 1,
      episode: episodeNumber(item, index)
    }));
  }
  // Movies have one implicit video whose ID equals meta.id (Stremio protocol).
  return meta;
}

function streamFor(url, serverName, itemName) {
  const value = str(url);
  if (!/^https?:\/\//i.test(value)) return null;
  const title = `${serverName} • ${itemName}`;
  if (/\.(m3u8|mp4|webm|mkv)(?:[?#]|$)/i.test(value)) {
    return { name: "NguồnC", title, url: value };
  }
  return { name: "NguồnC", title: `${title} (mở trình duyệt)`, externalUrl: value };
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const catalog = catalogs.find(x => x.type === type && x.id === id);
  if (!catalog) return { metas: [] };
  const skip = Math.max(0, Number.parseInt(extra?.skip, 10) || 0);
  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const search = str(extra?.search);
  const path = search
    ? `films/search?keyword=${encodeURIComponent(search)}&page=${page}`
    : `${catalog.path}?page=${page}`;
  try {
    const data = await api(path);
    const items = Array.isArray(data.items) ? data.items : [];
    let selected = items;
    if (search) {
      selected = (await Promise.all(items.map(async item => {
        try {
          const detail = await api(`film/${encodeURIComponent(item.slug)}`);
          return movieType(detail.movie) === type ? item : null;
        } catch (error) {
          console.error("Search detail failed:", item.slug, error);
          return null;
        }
      }))).filter(Boolean);
    }
    return { metas: selected.slice(skip % PAGE_SIZE).map(item => preview(item, type)).filter(Boolean) };
  } catch (error) {
    console.error("CATALOG ERROR:", error);
    throw error; // Show a request failure instead of falsely reporting an empty catalog.
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  const slug = slugFor(id);
  if (!slug || !["movie", "series"].includes(type)) return { meta: {} };
  try {
    const { movie } = await api(`film/${encodeURIComponent(slug)}`);
    if (!movie) return { meta: {} };
    return { meta: metaFrom(movie, type) };
  } catch (error) {
    console.error("META ERROR:", error);
    throw error;
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (!["movie", "series"].includes(type)) return { streams: [] };
  const match = str(id).match(/^nguonc:([^:]+)(?::ep:(.+))?$/);
  if (!match) return { streams: [] };
  const [, slug, episodeSlug] = match;
  try {
    const { movie } = await api(`film/${encodeURIComponent(slug)}`);
    if (!movie) return { streams: [] };
    const streams = [];
    for (const server of Array.isArray(movie.episodes) ? movie.episodes : []) {
      const items = Array.isArray(server.items) ? server.items : [];
      const item = episodeSlug
        ? items.find(x => str(x.slug) === episodeSlug)
        : items[0];
      if (!item) continue;
      const serverName = str(server.server_name) || "Máy chủ";
      const itemName = str(item.name) || str(item.slug) || "Xem phim";
      const candidates = [item.m3u8, item.link_m3u8, item.mp4, item.url, item.file, item.embed];
      for (const candidate of new Set(candidates.filter(Boolean))) {
        const stream = streamFor(candidate, serverName, itemName);
        if (stream) streams.push(stream);
      }
    }
    return { streams };
  } catch (error) {
    console.error("STREAM ERROR:", error);
    throw error;
  }
});

serveHTTP(builder.getInterface(), { port: PORT });
console.log(`NguonC Stremio addon v${manifest.version} listening on port ${PORT}`);
