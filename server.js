const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = Number(process.env.PORT || 7000);
const API_BASE = (process.env.NGUONC_API_BASE || "https://phim.nguonc.com/api").replace(/\/+$/, "");
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const PAGE_SIZE = 24;

const cache = new Map();

const manifest = {
  id: "vn.nguonc.stremio",
  version: "1.0.0",
  name: "NguonC Việt Nam",
  description: "Phim Việt hóa từ NguonC API cho Stremio.",
  logo: "https://phim.nguonc.com/favicon.ico",
  resources: [
    {
      name: "catalog",
      types: ["movie", "series"],
      idPrefixes: ["nguonc:"]
    },
    {
      name: "meta",
      types: ["movie", "series"],
      idPrefixes: ["nguonc:"]
    },
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["nguonc:"]
    }
  ],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "nguonc_latest_movies",
      name: "NguonC - Phim mới",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "nguonc_latest_series",
      name: "NguonC - Phim bộ",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function cacheSet(key, data) {
  cache.set(key, { time: Date.now(), data });
  return data;
}

async function api(path) {
  const url = `${API_BASE}/${path.replace(/^\/+/, "")}`;
  const cached = cacheGet(url);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "NguonC-Stremio-Addon/1.0"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`NguonC HTTP ${response.status}: ${url}`);
  }

  const data = await response.json();
  return cacheSet(url, data);
}

function idFor(slug) {
  return `nguonc:${slug}`;
}

function slugFromId(id) {
  const value = String(id || "");
  if (value.startsWith("nguonc:")) {
    return value.slice("nguonc:".length);
  }
  return value;
}

function cleanText(value) {
  return value == null ? "" : String(value).trim();
}

function imageUrl(value) {
  const v = cleanText(value);
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://phim.nguonc.com/${v.replace(/^\/+/, "")}`;
}

function detectType(movie) {
  const groups = Array.isArray(movie?.category) ? movie.category : [];
  const names = groups.flatMap(group =>
    Array.isArray(group?.list) ? group.list.map(x => cleanText(x?.name).toLowerCase()) : []
  );

  if (names.includes("phim lẻ") || names.includes("phim le")) return "movie";
  return "series";
}

function preview(movie) {
  const type = detectType(movie);
  const poster = imageUrl(movie?.poster_url || movie?.thumb_url);

  return {
    id: idFor(movie.slug),
    type,
    name: cleanText(movie.name),
    poster,
    posterShape: "poster",
    description: cleanText(movie.description),
    releaseInfo: cleanText(movie.year),
    imdbRating: movie?.imdb_rating ? Number(movie.imdb_rating) : undefined
  };
}

function episodeId(movieSlug, episodeSlug) {
  return `nguonc:${movieSlug}:ep:${episodeSlug}`;
}

function parseEpisodeId(id) {
  const value = String(id || "");
  const match = value.match(/^nguonc:(.+):ep:(.+)$/);
  if (!match) return null;
  return { movieSlug: match[1], episodeSlug: match[2] };
}

function toVideos(movie) {
  const videos = [];
  const episodes = Array.isArray(movie?.episodes) ? movie.episodes : [];

  for (const server of episodes) {
    const items = Array.isArray(server?.items) ? server.items : [];

    for (const item of items) {
      const epName = cleanText(item?.name) || cleanText(item?.slug);
      if (!item?.slug) continue;

      videos.push({
        id: episodeId(movie.slug, item.slug),
        title: epName,
        season: 1,
        episode: extractEpisodeNumber(epName),
        released: movie?.modified?.time || undefined,
        thumbnail: imageUrl(movie?.thumb_url || movie?.poster_url)
      });
    }
  }

  // Some single movies may have no episode list.
  if (!videos.length) {
    videos.push({
      id: idFor(movie.slug),
      title: "Full",
      season: 1,
      episode: 1,
      thumbnail: imageUrl(movie?.thumb_url || movie?.poster_url)
    });
  }

  return videos;
}

function extractEpisodeNumber(name) {
  const text = cleanText(name);
  const match = text.match(/(?:tập|tap|episode|ep)\s*([0-9]+)/i) || text.match(/^([0-9]+)$/);
  return match ? Number(match[1]) : 1;
}

function findEpisode(movie, episodeSlug) {
  const episodes = Array.isArray(movie?.episodes) ? movie.episodes : [];

  for (const server of episodes) {
    const items = Array.isArray(server?.items) ? server.items : [];
    const item = items.find(x => cleanText(x?.slug) === cleanText(episodeSlug));
    if (item) {
      return {
        serverName: cleanText(server?.server_name) || "NguonC",
        item
      };
    }
  }
  return null;
}

function streamCandidates(item) {
  // NguonC versions commonly expose an embed URL. Some mirrors may also expose
  // m3u8/mp4 fields. Prefer direct media URLs when available.
  const values = [
    item?.link_m3u8,
    item?.m3u8,
    item?.url,
    item?.file,
    item?.link,
    item?.embed
  ].filter(Boolean);

  return [...new Set(values.map(v => cleanText(v)).filter(Boolean))];
}

function isDirectMedia(url) {
  return /\.(m3u8|mp4|webm|mkv)(\?.*)?$/i.test(url);
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  try {
    const search = cleanText(extra?.search);
    const skip = Number(extra?.skip || 0);
    const apiPage = Math.floor(skip / PAGE_SIZE) + 1;

    let data;
    if (search) {
      data = await api(`films/search?keyword=${encodeURIComponent(search)}&page=${apiPage}`);
    } else {
      data = await api(`films/phim-moi-cap-nhat?page=${apiPage}`);
    }

    const items = Array.isArray(data?.items) ? data.items : [];

    const metas = items
      .map(preview)
      .filter(item => item.type === type)
      .slice(0, PAGE_SIZE);

    return { metas };
  } catch (error) {
    console.error("CATALOG ERROR:", error.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const slug = slugFromId(id);
    const data = await api(`film/${encodeURIComponent(slug)}`);
    const movie = data?.movie;

    if (!movie) return { meta: {} };

    const poster = imageUrl(movie.poster_url || movie.thumb_url);
    const background = imageUrl(movie.poster_url || movie.thumb_url);

    const meta = {
      id: idFor(movie.slug),
      type,
      name: cleanText(movie.name),
      poster,
      background,
      posterShape: "poster",
      description: cleanText(movie.description),
      releaseInfo: cleanText(movie.year),
      director: cleanText(movie.director) ? [cleanText(movie.director)] : undefined,
      cast: cleanText(movie.casts)
        ? cleanText(movie.casts).split(",").map(x => x.trim()).filter(Boolean)
        : undefined,
      runtime: cleanText(movie.time),
      genres: extractGenres(movie.category),
      videos: type === "series" ? toVideos(movie) : toVideos(movie).slice(0, 1),
      behaviorHints: {
        defaultVideoId: type === "series" ? undefined : idFor(movie.slug)
      }
    };

    return { meta };
  } catch (error) {
    console.error("META ERROR:", error.message);
    return { meta: {} };
  }
});

function extractGenres(category) {
  if (!Array.isArray(category)) return [];
  return category
    .flatMap(group => Array.isArray(group?.list) ? group.list : [])
    .map(x => cleanText(x?.name))
    .filter(Boolean)
    .slice(0, 20);
}

builder.defineStreamHandler(async ({ type, id }) => {
  try {
    let movieSlug = slugFromId(id);
    let episodeSlug = null;

    const parsed = parseEpisodeId(id);
    if (parsed) {
      movieSlug = parsed.movieSlug;
      episodeSlug = parsed.episodeSlug;
    }

    const data = await api(`film/${encodeURIComponent(movieSlug)}`);
    const movie = data?.movie;
    if (!movie) return { streams: [] };

    if (!episodeSlug) {
      // Movie: select the first playable episode/item.
      const videos = toVideos(movie);
      episodeSlug = videos[0]?.id?.split(":ep:")[1] || null;
    }

    const episode = episodeSlug ? findEpisode(movie, episodeSlug) : null;
    if (!episode) return { streams: [] };

    const candidates = streamCandidates(episode.item);
    const streams = [];

    for (const url of candidates) {
      if (isDirectMedia(url)) {
        streams.push({
          name: `NguonC • ${episode.serverName}`,
          title: cleanText(episode.item?.name) || "NguonC",
          url
        });
      } else {
        // An embed page is not necessarily a direct media file. Stremio can
        // expose it as an external link instead of pretending it is a stream.
        streams.push({
          name: `NguonC • ${episode.serverName}`,
          title: `${cleanText(episode.item?.name) || "Xem trên nguồn"} (External)`,
          externalUrl: url
        });
      }
    }

    return { streams };
  } catch (error) {
    console.error("STREAM ERROR:", error.message);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: PORT });

console.log("");
console.log("==============================================");
console.log(" NguonC → Stremio Add-on");
console.log("==============================================");
console.log(` Local:    http://127.0.0.1:${PORT}/manifest.json`);
console.log(` Network:  http://YOUR-IP:${PORT}/manifest.json`);
console.log("");
console.log("Đưa URL /manifest.json vào Stremio > Add-ons.");
console.log("Nếu deploy lên hosting, dùng HTTPS URL của hosting.");
console.log("");
