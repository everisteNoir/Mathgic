# Mathgic — Build 13: Build 11 Book Pose Restoration

A zero-build ES Modules Three.js experience for sacred geometry, projection, infinity and non-Euclidean topics.

## Build 13 changes

- Restored the Build 11 book-stage footprint, bottom placement and apparent size inside the shared Engine renderer.
- Reconstructed the original Build 11 book-camera viewing quaternion (FOV 34°, distance 8.95, pitch 0.34 rad, look-at height 0.44) as a transform reference; the Engine camera and renderer remain unchanged.
- Preserved the original curved page-turn geometry, 64 × 16 mesh resolution, 760 ms duration and cubic ease-in-out animation.
- Kept the book in the shared Engine scene so active solids occlude it through the common depth buffer.
- Removed visible chapter names and native hover tooltips from the Chapter Rail; accessible labels remain for assistive technology.
- Added a second Prologue page, References, with selected further reading and publisher/catalogue/DOI links.
- Retained the single WebGL renderer, solid interactions, Infinity chapter, Projection/Tesseract content and Polyhedra-only hold-to-charge behavior.

## Run locally

Serve this folder with any static web server (ES modules and the import map require HTTP/HTTPS):

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` in a modern browser with WebGL enabled.

## Notes

The reference page is labelled as selected further reading; these entries are supplementary sources, not a claim that the sample source files formally cite every item. Three.js 0.160.0 and Google Fonts load from their hosted services, so an internet connection is required unless those assets are self-hosted.
