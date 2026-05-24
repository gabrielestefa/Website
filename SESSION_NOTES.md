# Session Notes — Portfolio Website

**Date:** 2026-05-24  
**Site:** https://gabrielestefa.github.io/Website/  
**Stack:** Single-file HTML (`index.html`) · inline CSS · ES-module JS · Three.js r150.1 · GitHub Pages

---

## What was fixed this session

### 1. GitHub Pages + Git LFS (root cause of broken 3D viewer)
**Problem:** `WaterExtractorWebsite.glb` and `aerodynamics_workshop_4k.hdr` were tracked by Git LFS. GitHub Pages only serves files from the regular git tree — LFS-tracked files return a 134-byte pointer stub, so Three.js received garbage and failed silently.

**Fix:** Removed both files from LFS, committed them as plain git objects.
- Edited `.gitattributes` — removed `*.glb` and `*.hdr` LFS rules (kept `*.mp4`, `*.mov`)
- `git lfs untrack "*.glb"` + `git lfs untrack "*.hdr"`
- `git rm --cached` then `git add` to re-stage as regular files
- URLs in `autoLoad()` reverted to relative paths (`./WaterExtractorWebsite.glb`)

**Remember:** GitHub warns at 50 MB but accepts files up to 100 MB in the regular git tree. The GLB is 75 MB — within limits but near the edge. If the model ever grows past ~95 MB, switch to Cloudflare R2 or similar CORS-enabled CDN.

---

### 2. JavaScript syntax error killing the entire script block
**Problem:** `addHDRPicker()` had unescaped single quotes inside a single-quoted string:
```js
// BROKEN — terminates the string early
onclick="document.getElementById('hdr-input').click()"
```
This was a syntax error that silently prevented the whole `<script>` block from parsing. No functions (`autoLoad`, `setMode`, etc.) were ever defined.

**Fix:** Escaped the inner quotes:
```js
onclick="document.getElementById(\'hdr-input\').click()"
```

---

### 3. Three.js CDN — switched from UMD to ES modules
**Problem:** The original `examples/js` UMD scripts (`three.min.js`, `GLTFLoader.js`, etc.) from jsDelivr at r150 do not reliably attach `GLTFLoader` / `RGBELoader` to the `THREE` global. Result: `THREE.GLTFLoader is not a constructor`.

**Fix:** Replaced the four `<script src>` tags with an importmap + `type="module"` script:
```html
<script type="importmap">{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.150.1/examples/jsm/"
  }
}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader }  from 'three/addons/loaders/RGBELoader.js';
```

**Remember:** With `type="module"`, variables are NOT automatically on `window`. All functions called from inline `onclick` attributes must be explicitly assigned: `window.setMode = ...`, `window.loadFromFile = ...`, etc. This was already done but must be kept for any new functions added to the toolbar.

---

### 4. GLB streaming progress bar (fetch-based loader)
**Problem:** `XMLHttpRequest` progress events don't fire when GitHub omits the `Content-Length` header, so the bar was frozen.

**Fix:** Replaced `GLTFLoader.load()` with a custom `fetch()` streaming reader that reads chunks and calls `onProgress` incrementally:
- If `Content-Length` is present → shows real `%`
- If not → shows `X.X MB` downloaded + estimates based on the known 74 MB file size
- Final step calls `GLTFLoader.parse(arrayBuffer)` on the fully-downloaded buffer

---

### 5. Model floor placement
**Problem:** `fitModel()` centred the model at world origin (subtracting the bounding-box centre), so the model floated mid-air relative to the ground plane.

**Fix:** After scaling, shift so **bottom of bounding box = Y 0**:
```js
obj.position.x -= (box.min.x + box.max.x) / 2;  // centre X
obj.position.y -= box.min.y;                       // floor Y
obj.position.z -= (box.min.z + box.max.z) / 2;  // centre Z
```

---

### 6. Viewer mode buttons not switching
**Problem:** `applyMode()` filtered meshes by material name (`if mn !== 'main' && mn !== 'details') return`). Any mesh whose material had a different name (or an empty name) was silently skipped — wireframe, UV, texture modes had no visible effect.

**Fix:** Store original material and textures **per mesh** in Maps on load:
```js
const meshOrigMat  = new Map(); // mesh → original Material
const meshTextures = new Map(); // mesh → { diffuse, normal, rma }
```
`applyMode()` now iterates ALL meshes unconditionally, looking up textures from `meshTextures` instead of from the name-keyed `texMaps` object.

---

### 7. UV Layout viewer + Texture dropdown
**New features added:**

**UV Layout** (renamed from "UV Checker"):
- Clicking the button splits the canvas-wrap 50/50
- Left: 3D model with the procedural UV-checker texture applied
- Right: 2D canvas showing the actual UV wireframe (all mesh triangles drawn in UV space, amber lines on dark background)
- A **Channel** dropdown auto-populates from the geometry attributes actually present in the GLB (`uv`, `uv2`, …)
- Changing the dropdown instantly redraws the UV layout

**Texture mode** (replaced separate Diffuse/Normal/RMA buttons):
- Single **Texture** button in the toolbar
- **Map** dropdown with options: `Diffuse`, `Normal`, `RMA · R · Roughness`, `RMA · G · Metallic`, `RMA · B · AO`
- Each mesh shows its own texture from `meshTextures` — no hardcoded name matching required

---

## Architecture to remember

### File structure
```
Website/
├── index.html              ← entire site: HTML + CSS + JS (single file)
├── WaterExtractorWebsite.glb   ← 75 MB, plain git (NOT LFS)
├── aerodynamics_workshop_4k.hdr ← 23 MB, plain git (NOT LFS)
├── .gitattributes          ← only *.mp4 and *.mov remain LFS-tracked
├── AUDIT.md                ← security/perf/a11y findings from session 1
└── SESSION_NOTES.md        ← this file
```

### Three.js setup
- Version: **r150.1** via jsDelivr ES modules
- `GLTFLoader` and `RGBELoader` imported from `three/addons/`
- `PMREMGenerator` is part of THREE core — no separate import needed
- `renderer.outputEncoding = THREE.sRGBEncoding` is **deprecated** → should be `renderer.outputColorSpace = THREE.SRGBColorSpace` (not yet fixed — in the audit backlog)

### Viewer state variables
| Variable | Purpose |
|---|---|
| `meshOrigMat` | `Map<Mesh, Material>` — original PBR material per mesh |
| `meshTextures` | `Map<Mesh, {diffuse, normal, rma}>` — texture refs per mesh |
| `currentMode` | `'beauty' \| 'wireframe' \| 'uv' \| 'texture'` |
| `currentTexMap` | `'diffuse' \| 'normal' \| 'rma_r' \| 'rma_g' \| 'rma_b'` |
| `currentUVSet` | `'uv' \| 'uv2' \| ...` — active UV channel for layout view |
| `origMats` | Legacy name-keyed object — kept for compat, may be empty |
| `texMaps` | Legacy name-keyed object — kept for compat, may be empty |

### Adding new toolbar controls
1. Add the button/select to the HTML toolbar
2. Assign the handler to `window.myHandler = ...` in the module script (required for `onclick` to work)
3. If it's a mode, add the id to the `modeBtns` array so the active class is managed correctly
4. Update `applyMode()` with the new `case`

---

## Known remaining issues (from AUDIT.md)

| Priority | Issue |
|---|---|
| High | No SRI hashes on Three.js CDN `<script>` tags |
| High | No Content-Security-Policy meta tag |
| High | No `<h1>` heading in the document |
| High | All 7 images missing `alt` attributes |
| Medium | `renderer.outputEncoding` deprecated — change to `renderer.outputColorSpace` |
| Medium | Inline `onclick` handlers require `unsafe-inline` (CSP concern) |
| Medium | No meta description / Open Graph / Twitter Card tags |
| Medium | No ARIA landmarks or `aria-label` on toolbar buttons |
| Low | Animation loop runs even when viewer is off-screen (no IntersectionObserver) |
| Low | No `404.html` page |
| Low | No JSON-LD structured data |

---

## CORS / hosting notes

GitHub Releases download URLs (`github.com/.../releases/download/...`) **do not support cross-origin JavaScript fetch** — they redirect through `objects.githubusercontent.com` which does not return `Access-Control-Allow-Origin` headers. Multiple approaches were tried and failed:
- Direct `fetch()` → "Failed to fetch"
- GitHub API asset endpoint with `Accept: application/octet-stream` → same issue

**Conclusion:** For large assets on a GitHub Pages site, the only reliable options are:
1. **Commit directly to git** (current solution) — works up to 100 MB per file; no CORS because it's same-origin
2. **Cloudflare R2 free tier** — 10 GB storage, no bandwidth charges, CORS configurable (requires credit card on file even for free tier)
3. **Move entire site to Netlify/Vercel** — handles large files natively, CORS non-issue
