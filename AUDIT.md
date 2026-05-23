# Website Audit — gabriele_stefanelli_portfolio_4.html

**Date:** 2026-05-23  
**Site:** GitHub Pages — `https://gabrielestefa.github.io/Website/`  
**Stack:** Single-file HTML + inline CSS + inline JS + Three.js (CDN) + Git LFS assets

---

## 1. Security

### Missing Subresource Integrity (SRI) — High
All four Three.js libraries are loaded from `cdn.jsdelivr.net` with no `integrity` attribute.  
If the CDN is compromised, malicious code would execute with no browser-level protection.

```html
<!-- Current (unsafe) -->
<script src="https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js"></script>

<!-- Fix: generate hash with openssl or srihash.org and add integrity + crossorigin -->
<script
  src="https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js"
  integrity="sha384-<HASH>"
  crossorigin="anonymous"></script>
```

Affects lines ~366-369 (all four Three.js script imports).

---

### No Content Security Policy (CSP) — High
No `Content-Security-Policy` meta tag is present. Without a CSP the browser will execute any inline or injected script.

Recommended starting point (adjust to your actual usage):
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self';
           script-src 'self' cdn.jsdelivr.net 'unsafe-inline';
           style-src 'self' fonts.googleapis.com 'unsafe-inline';
           font-src fonts.gstatic.com;
           connect-src 'self';
           img-src 'self' data:;
           worker-src blob:;">
```

---

### Inline `onclick` Handlers — Medium
Functions like `setMode`, `setActiveMat`, `setRMAChannel` are called via inline `onclick` attributes (lines 244-263, 275, 749) and exposed on `window`. This is a CSP violation (requires `unsafe-inline`) and pollutes the global namespace.

**Fix:** Use `addEventListener` and remove the `window.functionName = ...` assignments.

---

### `innerHTML` String Construction — Low
Line 749 builds a DOM string via `innerHTML`. Content is internally controlled so XSS is not currently exploitable, but it is a pattern to avoid.

**Fix:** Use `document.createElement` / `appendChild`.

---

## 2. Performance

### Giant LFS Assets Blocking Load — Critical
| Asset | Size |
|---|---|
| `WaterExtractorWebsite.glb` | 75 MB |
| `aerodynamics_workshop_4k.hdr` | 23 MB |

`autoLoad()` triggers on page init (line 765), causing the browser to download ~98 MB before the 3D viewer is interactive. This will produce poor Core Web Vitals (LCP, CLS) and a likely 5-30 second delay on average connections.

**Fixes:**
- Load assets only after the viewer section scrolls into view (`IntersectionObserver`).
- Consider reducing the GLB size with mesh decimation / Draco compression (`gltf-pipeline --draco`).
- Downscale the HDR to a 2K or 1K version for web; the 4K is only needed for print.
- Show a progress bar (the UI element already exists, line 689 — just wire it up before fetch starts).

---

### Base64 Images Embedded in HTML — High
All 7 images (hero, 4 work cards, award badge, about photo) are inlined as `data:image/jpeg;base64` strings. This causes:

- ~33 % size overhead vs raw binary.
- HTML file is bloated to 388 KB (most of which is image data).
- Browser **cannot cache** images independently — every page reload re-parses all image data.
- HTTP compression is less effective on base64.

**Fix:** Extract images to separate `.webp` or `.jpg` files and reference them with `<img src="images/hero.webp">`. Add proper `alt` text while doing so (see Accessibility).

---

### Three.js Not Deferred — Medium
All four CDN scripts are in the `<head>` without `defer` or `async`, blocking HTML parsing.

```html
<script defer src="https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js"></script>
```

---

### Animation Loop Runs When Off-Screen — Low
The Three.js `requestAnimationFrame` loop (line 764) renders every frame regardless of whether the viewer is visible. Use `IntersectionObserver` to pause the loop when out of viewport and resume it when visible.

---

## 3. Accessibility

### No `<h1>` Heading — High
The page has no `<h1>` element. The hero name "Gabriele Stefanelli" is styled as a title but is a plain `<div>`. Screen readers and search engines depend on a heading hierarchy to understand document structure.

**Fix:** Wrap the name in `<h1>` and section titles in `<h2>`.

---

### All 7 Images Missing `alt` Text — High
| Section | Approximate Line |
|---|---|
| Hero portrait | 166 |
| Work card 1 | 210 |
| Work card 2 | 217 |
| Work card 3 | 224 |
| Work card 4 | 228 |
| Award badge | 172 |
| About section | 319 |

None have an `alt` attribute. Screen readers will either skip or read the raw base64 string.

**Fix:** Add descriptive `alt` text, e.g. `alt="Water extractor environment asset — UE5 real-time render"`.

---

### No ARIA Landmarks or Semantic Sectioning — Medium
The page uses `<section>` tags but wraps content without `<main>`, `<nav>`, or `<footer>`. The 3D viewer toolbar buttons (Beauty, Wireframe, UV Checker, material channels) have no `aria-label` or `aria-pressed` state.

---

### No Keyboard Navigation for 3D Viewer — Medium
Orbit controls are mouse/touch only (lines 413-431). Keyboard users cannot interact with the viewer at all.

---

### No Focus Visible Styles — Medium
Custom buttons do not appear to have `:focus-visible` styles. Keyboard users lose track of their position.

---

### Color Contrast — Needs Verification
`--muted: #7a6a52` on `--deep: #1a1410` background. The estimated ratio is below WCAG AA (4.5:1). Verify with a contrast checker before shipping.

---

### No Skip Link — Low
There is no "Skip to main content" link at the top of the page, making keyboard navigation tedious.

---

## 4. SEO

| Missing Element | Impact |
|---|---|
| `<meta name="description">` | Google shows raw page text in results |
| Open Graph tags (`og:title`, `og:image`, etc.) | Poor LinkedIn / social previews |
| Twitter Card tags | Poor Twitter / X previews |
| `<link rel="canonical">` | Minor for single-page, still good practice |
| JSON-LD structured data (Person, CreativeWork) | No rich snippets |
| `<h1>` (see Accessibility) | Major ranking signal missing |

Images as data URIs are not crawlable by Google Image Search.

Core Web Vitals penalty from 98 MB of blocking assets will depress search ranking.

---

## 5. Code Quality

### Deprecated Three.js API — Medium
`renderer.outputEncoding = THREE.sRGBEncoding` (line ~384) was deprecated in Three.js r139. Version 0.150.1 still accepts it, but it will break on a future upgrade.

```js
// Current (deprecated)
renderer.outputEncoding = THREE.sRGBEncoding;

// Fix
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

---

### Global `window` Function Pollution — Low
`window.setMode`, `window.setActiveMat`, `window.setRMAChannel` (lines 538-556) are attached to the global object to bridge inline `onclick` handlers. Removing inline handlers (see Security) also removes the need for these globals.

---

### `window` Event Listeners Never Removed — Low
`mousemove` and `mouseup` listeners are added to `window` (lines 413-431) but never cleaned up. Low risk for a single-page site but would cause memory leaks in an SPA.

---

## 6. GitHub Pages Specifics

| Item | Status |
|---|---|
| HTTPS enforced | Automatic via GitHub Pages — verify in repo Settings → Pages |
| Custom domain (CNAME file) | Not present — add if you own a domain |
| Custom `404.html` | Not present — default GitHub 404 shown on bad URLs |
| Git LFS | Configured in `.gitattributes` — GitHub Pages serves LFS files correctly |
| Jekyll disabled | Static HTML served directly — no `_config.yml` needed |

---

## 7. Priority Action List

### Critical
- [ ] Lazy-load 3D assets (GLB + HDR) via `IntersectionObserver` instead of auto-loading on init
- [ ] Extract base64 images to separate WebP files with `alt` text

### High
- [ ] Add SRI hashes to all four Three.js `<script>` tags
- [ ] Add a Content-Security-Policy `<meta>` tag
- [ ] Add `<h1>` heading around the hero name
- [ ] Add `alt` attributes to all 7 images

### Medium
- [ ] Replace inline `onclick` handlers with `addEventListener`; remove `window.*` function assignments
- [ ] Add `defer` to all Three.js `<script>` tags
- [ ] Fix deprecated `renderer.outputEncoding` → `renderer.outputColorSpace`
- [ ] Add ARIA landmarks (`<main>`, `<nav>`) and `aria-label` to toolbar buttons
- [ ] Add `:focus-visible` styles to all interactive elements
- [ ] Add `<meta name="description">` and Open Graph / Twitter Card tags

### Low
- [ ] Pause the animation loop with `IntersectionObserver` when viewer is off-screen
- [ ] Add a `404.html` page
- [ ] Add JSON-LD structured data (Person + CreativeWork schemas)
- [ ] Consider Draco-compressed GLB and a 1K/2K HDR for faster load
- [ ] Add a `<link rel="canonical">` tag
