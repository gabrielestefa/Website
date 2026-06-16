// ─────────────────────────────────────────────────────────────────────────────
// Portfolio gallery API — Cloudflare Worker
//
// Lists everything under `projects/` in the bound R2 bucket and returns a
// JSON manifest grouped by folder. The site fetches this once at boot
// instead of hardcoding filenames.
//
// Costs (free tier covers this easily):
//   - 1 R2 list() per cache miss          (Class A, 1M/mo free)
//   - 1 R2 get(metadata.json) per miss    (Class B, 10M/mo free)
//   - 5-minute edge cache cuts traffic ~99% in practice
//
// Per-project files (inside each projects/<Folder>/):
//   - description.txt   → body text shown in the lightbox left panel
//   - <N>.txt           → filename number sets display order (1.txt = first)
//
// Optional file: `projects/metadata.json` — top-level overrides:
//   {
//     "order": ["Water Extractor", "Hatfield House", ...],
//     "projects": {
//       "Water Extractor": {
//         "title": "Water Extractor",
//         "badge": "Blender · Houdini",
//         "tags": ["Hard-surface", "PBR"],
//         "comingSoon": false
//       },
//       "Landcross Play": { "comingSoon": true }
//     }
//   }
//
// Order priority: per-folder <N>.txt → metadata.order → alphabetical.
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_EXT  = /\.(jpe?g|png|gif|webp|avif)$/i;
const VIDEO_EXT  = /\.(mp4|mov|webm|m4v)$/i;
const MODEL_EXT  = /\.(glb|gltf)$/i;
const HDR_EXT    = /\.(hdr|exr)$/i;
const THUMB_RE   = /^thumbnail\.(jpe?g|png|webp|gif)$/i;
const DESC_RE    = /^description\.txt$/i;       // body text shown in the lightbox
const ORDER_RE   = /^(\d+)\.txt$/;              // filename number = display order
const SKIP_RE    = /^(\.|Thumbs\.db$|\.DS_Store$|metadata\.json$)/i;

const CACHE_TTL  = 300;        // edge + browser cache, seconds
const PREFIX     = 'projects/';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age':       '86400',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    // Edge cache: same URL within TTL returns instantly with zero R2 ops.
    const cache    = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const cached   = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const projects = await listProjects(env.MEDIA);
      const response = new Response(JSON.stringify({ projects }), {
        headers: {
          ...CORS,
          'Content-Type':  'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
        },
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err && err.message || err) }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};

async function listProjects(bucket) {
  // 1. Flat list of everything under projects/ (single Class A op per 1000 keys).
  const objects = [];
  let cursor;
  do {
    const r = await bucket.list({ prefix: PREFIX, cursor, limit: 1000 });
    objects.push(...r.objects);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);

  // 2. Optional metadata overrides (1 Class B op).
  let meta = { order: null, projects: {} };
  try {
    const obj = await bucket.get(`${PREFIX}metadata.json`);
    if (obj) meta = { ...meta, ...JSON.parse(await obj.text()) };
  } catch { /* missing or invalid is fine */ }

  // 3. Group files by folder (first path segment under projects/).
  const folders = new Map();
  for (const o of objects) {
    const rel = o.key.slice(PREFIX.length);
    if (!rel || rel === 'metadata.json') continue;
    const slash = rel.indexOf('/');
    if (slash === -1) continue;                     // top-level files: skip
    const folder = rel.slice(0, slash);
    const file   = rel.slice(slash + 1);
    if (!file || SKIP_RE.test(file)) continue;
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push(file);
  }

  // 4. Build a project entry per folder, classifying files by extension.
  const projects = [];
  const descJobs = [];   // [{project, key}] — description.txt fetches to run in parallel
  for (const [folder, files] of folders) {
    const m = (meta.projects && meta.projects[folder]) || {};
    const project = {
      folder,
      title:       m.title  || folder,
      badge:       m.badge  || '',
      tags:        m.tags   || [],
      thumbnail:   null,
      images:      [],
      videos:      [],
      model:       null,
      description: '',
      order:       null,   // from N.txt filename; null = unordered
      comingSoon:  m.comingSoon === true,
    };
    let glb = null, hdr = null, descFile = null;
    for (const f of files) {
      let mo;
      if      (THUMB_RE.test(f))  { project.thumbnail = f; /* card only — not a gallery slide */ }
      else if (DESC_RE.test(f))   { descFile = f; }
      else if ((mo = ORDER_RE.exec(f))) { project.order = parseInt(mo[1], 10); }
      else if (IMAGE_EXT.test(f)) { project.images.push(f); }
      else if (VIDEO_EXT.test(f)) { project.videos.push(f); }
      else if (MODEL_EXT.test(f)) { glb = f; }
      else if (HDR_EXT.test(f))   { hdr = f; }
    }
    project.images.sort();
    project.videos.sort();
    if (glb) project.model = { glb, hdr };
    if (descFile) descJobs.push({ project, key: `${PREFIX}${folder}/${descFile}` });
    // Empty folder with comingSoon flag → still surface it
    if (project.images.length || project.videos.length || project.model || project.comingSoon) {
      projects.push(project);
    }
  }

  // 4b. Fetch all description.txt bodies in parallel (1 Class B op each).
  await Promise.all(descJobs.map(async ({ project, key }) => {
    try {
      const obj = await bucket.get(key);
      if (obj) project.description = (await obj.text()).trim();
    } catch { /* missing/unreadable description is fine */ }
  }));

  // 5. Order priority: N.txt filename number → metadata.order → alphabetical.
  const metaRank = Array.isArray(meta.order)
    ? new Map(meta.order.map((n, i) => [n, i]))
    : null;
  projects.sort((a, b) => {
    const ao = a.order, bo = b.order;
    if (ao != null && bo != null) return ao - bo || a.folder.localeCompare(b.folder);
    if (ao != null) return -1;   // numbered projects come first
    if (bo != null) return 1;
    if (metaRank) {
      const ai = metaRank.has(a.folder) ? metaRank.get(a.folder) : 1e9;
      const bi = metaRank.has(b.folder) ? metaRank.get(b.folder) : 1e9;
      if (ai !== bi) return ai - bi;
    }
    return a.folder.localeCompare(b.folder);
  });

  return projects;
}
