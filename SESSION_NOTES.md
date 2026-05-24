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

## Session 2 — UV viewer rework (2026-05-24)

### 8. UV viewer freezes on entry (canvas path build-up)
**Problem:** `drawUVLayout()` accumulated every triangle from every mesh into one giant Canvas2D path via `beginPath` once then `closePath` per triangle, calling `ctx.stroke()` only once at the end. For a ~50k-triangle model this is a single stroke command on a massive path → main thread freeze.

**Fix:** Stroke in batches of 800 triangles. Same pattern applied to the semi-transparent fill pass. Without batching, both passes freeze the page.

---

### 9. 3D viewer squished in UV split mode
**Problem:** `resize()` used `WRAP.clientWidth` (the full wrapper) for the renderer, but CSS set `#viewer-canvas{width:50%}` in UV mode. The renderer produced full-width pixels into a half-width canvas → 2× horizontal distortion.

**Fix:** `resize()` now reads `CANVAS.clientWidth/Height` directly. The CSS owns layout; the renderer just matches whatever the canvas actually displays. Always defer `resize()` via `requestAnimationFrame` after toggling a layout class so the DOM has laid out before measuring.

---

### 10. UV panel not square / not visible on wide viewports
**Problem:** Earlier attempts pinned the UV panel to `wrap.clientHeight × wrap.clientHeight` via JS inline styles — on a 1920px viewport that's 540×540, only 28% of the viewer width. User couldn't see the panel.

**Fix:** Pure CSS — both sides get `flex:0 0 50%; width:50%`. Inside, `#uv-canvas{object-fit:contain}` keeps the canvas's internal 1:1 ratio (the canvas is 1024×1024 in pixels) centered as a square via flexbox letterboxing. No JS sizing needed.

---

### 11. UV channel shader silently failed (uv2 redeclaration)
**Problem:** The channel-aware shader declared `attribute vec2 uv2;` explicitly. In Three.js r150 ShaderMaterial, `uv2` is **automatically injected** in the GLSL preamble when the geometry has that attribute. Our redeclaration was a duplicate-attribute GLSL compile error → shader silently failed → 3D checker always used channel 0 regardless of dropdown.

**Fix:** Drop the explicit `attribute vec2 uv2;` line. Just use `uv2` directly in the shader body — Three.js declares it for you.

**Remember:** In r150 ShaderMaterial, **always-injected** vertex attributes are: `position`, `normal`, `uv`. Conditionally injected (only if geometry has them): `uv2`, `color`, skin/morph attributes. Never re-declare any of these in your shader source.

---

### 12. Material dropdown filtered against wrong UUID
**Problem:** `drawUVLayout` and `applyMode` filtered meshes with `child.material?.uuid === activeMat`. But `applyMode` *replaces* `child.material` with a checker/wireframe/dim material on every mode switch. After the first switch, no mesh's `child.material.uuid` ever matched the dropdown values (which are *original* material UUIDs captured at load).

**Fix:** Always filter against `meshOrigMat.get(child)?.uuid`. That map preserves the original material reference across mode changes.

**Remember:** Any time you compare against material UUIDs from a dropdown populated at load, look up the **original** material via `meshOrigMat`, never `child.material` directly.

---

### 13. ⚠️ Missing function → silent traverse halt (THE big one)

**Problem:** `applyMode`'s `case 'uv'` called `makeCheckerMat(child.geometry, useUV2)` — but the `makeCheckerMat` function itself was missing from the file (dropped in a prior edit cycle). The first mesh hit threw `ReferenceError: makeCheckerMat is not defined` *inside* the `model.traverse(...)` callback.

Three.js's `Object3D.traverse` does **not** catch errors — the throw bubbles up, the traversal halts immediately, and **no material assignments happen after the first failure**. The original PBR materials persisted, dropdown changes didn't update, and entering UV from wireframe "kept the wireframe" because the new material assignment never executed.

**Why it was hard to find:**
- No browser console output (the error is eaten by Three's internal callback wrapper)
- `setMode('uv')` itself didn't throw — it returned normally; the error was deferred to the traverse callback
- The bug looked like a state issue ("material change doesn't apply", "previous mode persists") rather than a missing-function error
- Multiple symptoms had one root cause

**How it was found:** Calling `window.setMode('uv')` from `preview_eval` surfaced the error because devtools eval shows uncaught exceptions from the synchronous call stack. The same call from a button click swallowed it.

**Fix:** Re-add the `makeCheckerMat` function definition right after `uvTex = makeUVChecker()`:

```js
function makeCheckerMat(geo, useUV2) {
  const hasUV2  = !!geo.attributes.uv2;
  const pickUV2 = useUV2 && hasUV2;
  const vs = pickUV2
    ? `varying vec2 vUv; void main(){ vUv=uv2; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`
    : `varying vec2 vUv; void main(){ vUv=uv;  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: uvTex } },
    vertexShader: vs,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor=vec4(texture2D(map,vUv).rgb,1.); }`,
    side: THREE.DoubleSide
  });
}
```

**Lessons to never repeat:**
1. **Three.js `traverse` swallows errors.** Any uncaught exception inside a `traverse` callback halts iteration silently. When debugging "applyMode didn't run", *always* `try/catch` inside the traverse, or call the inner function on one known mesh outside `traverse` first.
2. **After every refactor, grep the file for the function name.** If `makeCheckerMat` is *called* once but *defined* zero times, that's a syntax-level red flag that should be caught before the user sees anything.
3. **When a single bug produces multiple unrelated-looking symptoms** ("material doesn't update", "previous mode persists", "channel switch doesn't work"), suspect a hard-fail upstream that prevents the whole code path from running, not three separate state bugs.
4. **Use the preview tools earlier.** A single `preview_eval` calling `window.setMode('uv')` would have surfaced the ReferenceError instantly. Don't spend turns guessing at state issues when you can just *evaluate the call* and read the stack trace.

---

### 14. Texel slider race (dispose-before-swap)
**Problem:** `setCheckerTiles` did `uvTex.dispose()` *before* creating the new texture and updating uniform references. Between those two lines, materials' `uniforms.map.value` pointed at a disposed texture. Synchronous JS means no render fires in between, so no visible bug *most* of the time — but it's the kind of thing that fails under high-frequency events (slider drag at 60Hz).

**Fix:** Build new texture first, swap every active `ShaderMaterial`'s `uniforms.map.value` to the new texture, *then* dispose the old one.

---

### 15. Final UV mode behavior matrix

| Mode      | Match (selected material)            | No match (dropdown filter excludes)    |
|-----------|--------------------------------------|----------------------------------------|
| Beauty    | Original PBR material                | Dim `0x1a1208`, opacity 0.25           |
| Wireframe | Amber wireframe                      | Dim                                    |
| **UV**    | UV checker + 40% colored wireframe overlay (hue from `meshHueMap`) | Dim |
| Texture   | Selected map (diffuse / normal / RMA channel) | Dim                            |

**Why dim in UV mode too:** Earlier iterations applied the checker to *all* meshes regardless of selection — but then "select MAIN" produced no visible change in the 3D viewer (only the 2D panel updated). Dimming non-matching meshes in UV mode makes the dropdown change unmistakable visually, and is consistent with the other modes.

**Hue map:** `meshHueMap: Map<Mesh, hueDeg>` is keyed at load time by *material* (not mesh index), so all meshes sharing a material get the same hue, and the 2D UV panel + 3D wireframe overlay always cross-reference correctly.

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
