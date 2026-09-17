"use strict";

const base = (process.env.NGUONC_API_BASE || "https://phim.nguonc.com/api").replace(/\/+$/, "");
const paths = [
  "films/danh-sach/phim-le?page=1",
  "films/danh-sach/phim-bo?page=1",
  "films/search?keyword=hoa",
  "film/hoa-thien-cot"
];

(async () => {
  let failed = false;
  for (const path of paths) {
    const url = `${base}/${path}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = response.ok ? await response.json() : null;
      const count = Array.isArray(data?.items) ? `, ${data.items.length} films` : "";
      console.log(`${response.status} ${url}${count}`);
      if (!response.ok || data?.status !== "success") failed = true;
    } catch (error) {
      console.error(`ERROR ${url}: ${error.message}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
})();
