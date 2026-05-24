# Portfolio gallery API

A 100-line Cloudflare Worker that lists everything under `projects/` in your
R2 bucket and returns a JSON manifest. The site fetches this at boot, so
adding a folder or a new image on R2 makes it appear on the site without
touching any code.

## What it returns

`GET https://portfolio-api.<your-account>.workers.dev/` →

```json
{
  "projects": [
    {
      "folder":     "Water Extractor",
      "title":      "Water Extractor",
      "badge":      "Blender · Houdini",
      "tags":       ["Hard-surface", "PBR"],
      "thumbnail":  "Thumbnail.jpg",
      "images":     ["Beauty.jpg", "Beauty (1).jpg", "Thumbnail.jpg", "WIP.gif"],
      "videos":     [],
      "model":      { "glb": "WaterExtractorWebsite.glb",
                      "hdr": "aerodynamics_workshop_4k.hdr" },
      "comingSoon": false
    },
    ...
  ]
}
```

Files are classified by extension:

| Extension                          | Bucket             |
|------------------------------------|--------------------|
| `.jpg .jpeg .png .gif .webp .avif` | `images[]`         |
| `.mp4 .mov .webm .m4v`             | `videos[]`         |
| `.glb .gltf`                       | `model.glb`        |
| `.hdr .exr`                        | `model.hdr`        |
| `Thumbnail.*` (any image ext)      | `thumbnail` + `images[]` |
| `.DS_Store`, `Thumbs.db`, dotfiles | skipped            |

## Deploy

1. Install Wrangler (one-time):
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. Edit `wrangler.toml` and set `bucket_name` to the actual R2 bucket name
   (visible in the R2 dashboard — *not* the `pub-…r2.dev` subdomain).

3. From the `worker/` folder:
   ```bash
   wrangler deploy
   ```

   Wrangler prints the URL, e.g.
   `https://portfolio-api.<account>.workers.dev`. Copy it.

4. Paste that URL into `index.html` — find the line
   ```js
   const WORKER_URL = '';
   ```
   and set it to your Worker URL (no trailing slash).

5. Commit + push. GitHub Pages redeploys, the gallery becomes dynamic.

## Optional: project metadata

Adding a new folder on R2 will Just Work — the project's `title` defaults to
the folder name and `badge`/`tags` are empty. To customise without redeploying
the site, upload a single file `projects/metadata.json` to R2:

```json
{
  "order": [
    "Water Extractor",
    "Hatfield House",
    "Rooftop Pack",
    "Omni Scatter",
    "Vintage Dremel",
    "The Fjord",
    "Sanctuary of the Nomadic Soul",
    "Site N-8",
    "Landcross Play"
  ],
  "projects": {
    "Water Extractor": {
      "badge": "Blender · Houdini",
      "tags":  ["Hard-surface", "Real-time", "PBR"]
    },
    "Hatfield House": {
      "badge": "Blender + UE5",
      "tags":  ["Architecture", "Heritage", "Hard-surface"]
    },
    "Landcross Play": {
      "comingSoon": true,
      "badge":      "Coming Soon"
    }
  }
}
```

Folders not listed in `order` fall to the end alphabetically.
Folders not listed under `projects` use their folder name as title with
no badge / tags.

Re-upload `metadata.json` whenever you want to tweak. The 5-minute edge
cache means changes are live within ~5 minutes — for faster propagation,
run `wrangler deploy` to invalidate, or hit the Worker URL with a `?bust=1`
query string (different URL = fresh cache key).

## Cost ceiling (no caching, every visit fresh)

| Operation         | Per visit | Free tier/mo | Visits/mo before paying |
|-------------------|-----------|--------------|-------------------------|
| Worker request    | 1         | 3,000,000    | 3,000,000               |
| R2 list (Class A) | 1         | 1,000,000    | 1,000,000               |
| R2 get (Class B)  | 1         | 10,000,000   | 10,000,000              |

With the 5-min edge cache the real numbers are ~100× lower.

## Local development

```bash
wrangler dev
```

Serves the worker at `http://localhost:8787` with a live R2 binding to the
real bucket. Useful for tweaking classification rules.
