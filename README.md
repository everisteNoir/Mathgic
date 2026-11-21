# ❖ Platonic Grimoire — Sacred Geometry & Mathematical Sorcery

An interactive 3D web laboratory exploring the **Five Platonic Solids** paired with the **Five Classical Elements from Plato's *Timaeus*** (Fire, Earth, Air, Water, and Aether). Engineered with a **Plug-and-Play Grimoire Architecture** so you can easily attach new mathematical phenomena and visual spells in the future without touching the core engine.

---

## ✨ Built-in Features

1. **The 5 Platonic Solids & Custom Elemental GLSL Shaders:**
   - **Tetrahedron (Fire • *Pyr*):** Swirling plasma currents; click & hold to build thermal charge from crimson to white-hot with rising embers.
   - **Hexahedron / Cube (Earth • *Gē*):** Crystalline mineral stone with glowing emerald veins, heavy rotational inertia, and double-click seismic waves.
   - **Octahedron (Air • *Aēr*):** Translucent wind crystal with swirling atmospheric currents that tilts and drifts with your cursor.
   - **Icosahedron (Water • *Hydōr*):** Underwater light caustics and surface ripples radiating from any point you click.
   - **Dodecahedron (Aether • *Kosmos*):** Deep cosmic nebula containing a nested celestial wireframe core; scroll your mouse wheel to zoom inside.
2. **Multi-Layered Geometric Interaction:**
   - Hover over **Vertices** to inspect $(x, y, z)$ coordinates, **Edges** to pluck harmonic pentatonic chimes, and click **Faces** to align the camera directly perpendicular to that face.
   - **2D Net Unfolding Slider:** Unhinges edges along a spanning tree and unfolds the 3D polyhedron flat onto a 2D plane.
3. **3 Plug-and-Play Mathematical Spells (`js/spells/`):**
   - **Dual Polyhedron Morphing:** Summons the dual solid nested inside the face centers of the active polyhedron.
   - **Golden Ratio X-Ray ($\phi = 1.618$):** Reveals three orthogonal Golden Rectangles and a 3D Fibonacci spiral.
   - **4D Hypercube Portal (*Tesseract*):** Projects a 4-dimensional rotating Tesseract into 3D space.

---

## 🚀 How to Upload to GitHub & Host for Free on Cloudflare Pages

### Step 1: Upload Code to GitHub
1. Go to [github.com](https://github.com), sign in, and click **New** (or `+` in the top-right corner $ightarrow$ **New repository**).
2. Name your repository (e.g., `plato-grimoire`), keep it **Public**, and click **Create repository**.
3. On the new repository page, click **`uploading an existing file`**.
4. Unzip `plato-grimoire-en.zip` on your computer, open the folder inside, and **drag and drop all files and folders** (`index.html`, `README.md`, `css/`, `js/`) into the browser window.
5. Wait for the upload to finish, then click **Commit changes**.

### Step 2: Deploy for Free with Cloudflare Pages
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign in.
2. In the left sidebar, select **Workers & Pages** $ightarrow$ **Create** $ightarrow$ switch to the **Pages** tab $ightarrow$ click **Connect to Git**.
3. Authorize GitHub and select your `plato-grimoire` repository.
4. Under **Set up builds and deployments**:
   - **Framework preset:** `None`
   - **Build command:** *(Leave completely blank)*
   - **Build output directory:** `/`
5. Click **Save and Deploy**. Within 20–30 seconds, Cloudflare will deploy your site globally at `https://plato-grimoire.pages.dev`.

---

## 🪄 How to Add New Mathematical Spells Later

To add a new mathematical visual effect (e.g., *Cymatics Audio Resonance*, *Fourier Epicycles*, *Non-Euclidean Portals*):
1. Share `js/spells/_TemplateSpell.js` with an AI and ask it to generate a new spell file following that exact structure.
2. Upload the new `.js` file into `js/spells/` on GitHub.
3. Edit `js/main.js` directly on GitHub (click the pencil icon ✏️), import and register your new spell, and click **Commit changes** — Cloudflare Pages will automatically update your live site in ~15 seconds.
