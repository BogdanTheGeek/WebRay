import { mat4, vec4 } from 'https://cdn.skypack.dev/gl-matrix';

const shaderSource = await (await fetch('shaders.wgsl')).text();
const computeShaderSource = await (await fetch('compute.wgsl')).text();
// Toggle debug overlays/features
var DEBUG = true;

// Gem species presets  [name, RI, COD, hex-colour]
const presets = [
   ['Quartz', 1.544, 0.013, '#e8e8e8'],
   ['Diamond', 2.417, 0.044, '#ffffff'],
   ['Ruby', 1.762, 0.018, '#e8253a'],
   ['Sapphire', 1.762, 0.018, '#1a5fd4'],
   ['Emerald', 1.575, 0.014, '#1db85c'],
   ['Amethyst', 1.544, 0.013, '#9b59d0'],
   ['Topaz', 1.619, 0.014, '#f5c842'],
   ['Spinel', 1.718, 0.020, '#ff6090'],
   ['Zircon', 1.925, 0.039, '#b8e0ff'],
   ['Cubic Zirconia', 2.170, 0.060, '#ffffff'],
   ['Garnet', 1.75, 0.020, '#d32e2f'],
   ['Tourmaline', 1.62, 0.014, '#ff7b50'],
   ['Peridot', 1.65, 0.015, '#9fff00'],
   ['Aquamarine', 1.57, 0.012, '#7fffd4'],
];


// ---------------------------------------------------------------------------
// UI panel — markup and CSS live in index.html; this function wires up
// event listeners and initialises values from the ui state object.
// ---------------------------------------------------------------------------
function buildUI(ui, cbs) {
   const panel = document.getElementById('gemui');
   const toggleBtn = document.getElementById('gemui-toggle');
   const uiFileInput = document.getElementById('uiFileInput');
   const fileBtn = document.getElementById('fileBtn');
   const fileNameEl = document.getElementById('fileNameEl');

   // Populate preset dropdown (options are generated from the JS presets array)
   const gPreset = panel.querySelector('#gPreset');
   gPreset.innerHTML = presets.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('')
      + '<option value="-1">Custom</option>';

   // Initialise slider / display values from ui state
   panel.querySelector('#riSlider').value = ui.ri;
   panel.querySelector('#riVal').textContent = ui.ri.toFixed(3);
   panel.querySelector('#codSlider').value = ui.cod;
   panel.querySelector('#codVal').textContent = ui.cod.toFixed(3);
   panel.querySelector('#tiltAngle').value = ui.tiltAngleDeg;
   panel.querySelector('#tiltVal').textContent = ui.tiltAngleDeg;
   panel.querySelector('#focalSlider').value = ui.focalLength;
   panel.querySelector('#focalVal').textContent = `${ui.focalLength} mm`;

   // Sync active light-mode button with ui.lightMode
   panel.querySelectorAll('#modes .mode').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.mode) === ui.lightMode)
   );

   // Mobile toggle
   toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('mobile-open');
      const icon = toggleBtn.querySelector('span:first-child');
      icon.textContent = panel.classList.contains('mobile-open') ? '✕' : '☰';
   });
   if (window.innerWidth <= 960) {
      const collapsePanel = (panelId, toggleId, expandLabel) => {
         document.getElementById(panelId)?.classList.add('collapsed');
         const btn = document.getElementById(toggleId);
         btn.textContent = '+';
         btn.setAttribute('aria-label', expandLabel);
      };
      collapsePanel('lightReturnPanel', 'lightReturnToggle', 'Expand graph');
      collapsePanel('facetInfoPanel', 'facetInfoToggle', 'Expand facet notes');
   }

   // Button triggers hidden input
   fileBtn.addEventListener('click', () => uiFileInput.click());

   uiFileInput.addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      fileNameEl.textContent = f.name;
      const url = URL.createObjectURL(f);
      cbs.onFileSelected?.(f.name, url);
   });

   // --- Colour swatches ---
   const gemColours = [
      '#ffffff', '#e8253a', '#1a5fd4',
      '#1db85c', '#9b59d0', '#f5c842',
      '#ff6090', '#b8e0ff',
   ];
   const swatchContainer = panel.querySelector('#swatches');

   function hexToRgb(hex) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return [r, g, b];
   }

   let activeSwatch = null;
   gemColours.forEach(hex => {
      const el = document.createElement('div');
      el.className = 'swatch' + (hex === '#ffffff' ? ' active' : '');
      el.style.background = hex;
      el.title = hex;
      el.addEventListener('click', () => {
         if (activeSwatch) activeSwatch.classList.remove('active');
         el.classList.add('active');
         activeSwatch = el;
         ui.color = hexToRgb(hex);
         colorPicker.value = hex;
         cbs.onRenderOutputChanged?.();
      });
      if (hex === '#ffffff') activeSwatch = el;
      swatchContainer.appendChild(el);
   });

   // Custom colour picker
   const colorPicker = document.createElement('input');
   colorPicker.type = 'color';
   colorPicker.value = '#ffffff';
   colorPicker.title = 'Custom colour';
   colorPicker.addEventListener('input', () => {
      if (activeSwatch) activeSwatch.classList.remove('active');
      activeSwatch = null;
      ui.color = hexToRgb(colorPicker.value);
      cbs.onRenderOutputChanged?.();
   });
   swatchContainer.appendChild(colorPicker);

   // --- RI slider ---
   const riSlider = panel.querySelector('#riSlider');
   const riVal = panel.querySelector('#riVal');
   riSlider.addEventListener('input', () => {
      ui.ri = parseFloat(riSlider.value);
      riVal.textContent = ui.ri.toFixed(3);
      panel.querySelector('#gPreset').value = '-1';
      cbs.onGraphParamsChanged?.();
      cbs.onRenderOutputChanged?.();
   });

   // --- COD slider ---
   const codSlider = panel.querySelector('#codSlider');
   const codVal = panel.querySelector('#codVal');
   codSlider.addEventListener('input', () => {
      ui.cod = parseFloat(codSlider.value);
      codVal.textContent = ui.cod.toFixed(3);
      panel.querySelector('#gPreset').value = '-1';
      cbs.onGraphParamsChanged?.();
      cbs.onRenderOutputChanged?.();
   });

   // --- Preset dropdown ---
   panel.querySelector('#gPreset').addEventListener('change', (e) => {
      const idx = parseInt(e.target.value);
      if (idx < 0) return;
      const [, ri, cod, hex] = presets[idx];
      ui.ri = ri;
      ui.cod = cod;
      riSlider.value = ri;
      riVal.textContent = ri.toFixed(3);
      codSlider.value = cod;
      codVal.textContent = cod.toFixed(3);
      // Match colour swatch
      const swatches = [...swatchContainer.querySelectorAll('.swatch')];
      const match = swatches.find(s => s.style.background === hexToRgb(hex).toString()
         || s.title === hex);
      if (activeSwatch) activeSwatch.classList.remove('active');
      if (match) { match.classList.add('active'); activeSwatch = match; }
      ui.color = hexToRgb(hex);
      colorPicker.value = hex;
      cbs.onGraphParamsChanged?.();
      cbs.onRenderOutputChanged?.();
   });

   panel.querySelector('#exitColor').addEventListener('input', e => {
      ui.exitHighlight = hexToRgb(e.target.value);
      ui.exitStrength = 1.0; // Ensure it's visible when a colour is picked
      cbs.onRenderOutputChanged?.();
   });

   // --- Light mode buttons ---
   panel.querySelector('#modes').addEventListener('click', (e) => {
      const btn = e.target.closest('.mode');
      if (!btn) return;
      panel.querySelectorAll('#modes .mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ui.lightMode = parseInt(btn.dataset.mode);
      cbs.onRenderOutputChanged?.();
   });

   // --- Focal length slider ---
   const focalSlider = panel.querySelector('#focalSlider');
   const focalVal = panel.querySelector('#focalVal');
   focalSlider.addEventListener('input', () => {
      ui.focalLength = parseFloat(focalSlider.value);
      focalVal.textContent = `${ui.focalLength} mm`;
      cbs.onGraphParamsChanged?.();
      cbs.onRenderOutputChanged?.();
   });

   // --- View buttons (Reset / Tilt) ---
   const vTiltEl = panel.querySelector('#vTilt');
   panel.querySelector('#vReset').addEventListener('click', () => {
      vTiltEl.classList.remove('active');
      cbs.onReset();
   });
   vTiltEl.addEventListener('click', () => {
      const on = cbs.onTilt();
      vTiltEl.classList.toggle('active', on);
   });

   // Tilt angle control
   const tiltSlider = panel.querySelector('#tiltAngle');
   const tiltVal = panel.querySelector('#tiltVal');
   tiltSlider.addEventListener('input', (e) => {
      const prevTiltDeg = ui.tiltAngleDeg;
      ui.tiltAngleDeg = parseFloat(e.target.value);
      tiltVal.textContent = ui.tiltAngleDeg.toFixed(0);
      cbs.onTiltAngleChanged?.(prevTiltDeg, ui.tiltAngleDeg);
   });

   // External API for model-loading to push updates into the live panel
   return {
      setFileName(name) {
         fileNameEl.textContent = name;
      },
      setRI(ri) {
         ui.ri = parseFloat(ri.toFixed(3));
         riSlider.value = ui.ri;
         riVal.textContent = ui.ri.toFixed(3);
         panel.querySelector('#gPreset').value = '-1';
      },
      setCOD(cod) {
         ui.cod = parseFloat(cod.toFixed(3));
         codSlider.value = ui.cod;
         codVal.textContent = ui.cod.toFixed(3);
         panel.querySelector('#gPreset').value = '-1';
      },
   };
}

class StoneData {
   constructor(vertexData, triangleCount, facets = [], refractiveIndex = null, dispersion = null) {
      this.vertexData = vertexData;
      this.triangleCount = triangleCount;
      this.facets = facets;
      this.refractiveIndex = refractiveIndex;
      this.dispersion = dispersion;
   }
}

async function loadSTL(url) {
   const response = await fetch(url);
   const buffer = await response.arrayBuffer();

   const countView = new DataView(buffer, 80, 4);
   const triangleCount = countView.getUint32(0, true);

   const entrySize = 50;
   const verticesPerTriangle = 3;
   const floatsPerVertex = 7;

   const vertexData = new Float32Array(triangleCount * verticesPerTriangle * floatsPerVertex);
   const dataView = new DataView(buffer, 84);

   for (let i = 0; i < triangleCount; i++) {
      const offset = i * entrySize;
      const nx = dataView.getFloat32(offset + 0, true);
      const ny = dataView.getFloat32(offset + 4, true);
      const nz = dataView.getFloat32(offset + 8, true);

      for (let v = 0; v < 3; v++) {
         const vOffset = offset + 12 + (v * 12);
         const writeIdx = (i * 3 + v) * floatsPerVertex;
         vertexData[writeIdx + 0] = dataView.getFloat32(vOffset + 0, true);
         vertexData[writeIdx + 1] = dataView.getFloat32(vOffset + 4, true);
         vertexData[writeIdx + 2] = dataView.getFloat32(vOffset + 8, true);
         vertexData[writeIdx + 3] = nx;
         vertexData[writeIdx + 4] = ny;
         vertexData[writeIdx + 5] = nz;
         vertexData[writeIdx + 6] = 0.0;
      }
   }

   return new StoneData(vertexData, triangleCount);
}

function normalizeFacetMetadata(name, instructions) {
   const rawName = String(name || '').trim();
   const rawInstructions = String(instructions || '').trim();
   const hasFrostedInstruction = /\bfrosted\b/i.test(rawInstructions);
   const trailingFMatch = rawName.match(/^(.*\d)f$/i);
   const normalizedName = trailingFMatch ? trailingFMatch[1] : rawName;
   const frosted = hasFrostedInstruction || Boolean(trailingFMatch);
   const normalizedInstructions = frosted && !hasFrostedInstruction
      ? (rawInstructions ? `${rawInstructions} FROSTED` : 'FROSTED')
      : rawInstructions;
   return {
      name: normalizedName,
      instructions: normalizedInstructions,
      frosted,
   };
}

// ---------------------------------------------------------------------------
// GemCut Studio .gcs XML format loader
//
// Structure:
//   <GemCutStudio version="...">
//     <index gear="..." symmetry="..." mirror="..."/>
//     <tier angle="..." depth="..." name="T1" instructions="..." ...>
//       <facet nx="..." ny="..." nz="..." index_angle="...">
//         <vertex x="..." y="..." z="..."/>
//         ...
//       </facet>
//       ...
//     </tier>
//     ...
//     <render material="..." refractive_index="1.76" dispersion="0.044" ...>
//       <color r="1" g="1" b="1"/>
//     </render>
//   </GemCutStudio>
//
// Vertices are pre-computed — no plane intersection needed.
// Facets with < 3 vertices are skipped. Fan triangulation from vertex 0.
// Y axis is negated (same GemCad convention as .gem loader).
// ---------------------------------------------------------------------------
async function loadGCS(url) {
   const response = await fetch(url);
   const text = await response.text();
   const parser = new DOMParser();
   const doc = parser.parseFromString(text, 'application/xml');

   if (doc.querySelector('parsererror')) {
      throw new Error('GCS: XML parse error');
   }

   // Refractive index + dispersion
   let refractiveIndex = 1.76;
   let dispersion = 0.044;
   const renderEl = doc.querySelector('render');
   if (renderEl) {
      const ri = parseFloat(renderEl.getAttribute('refractive_index'));
      if (isFinite(ri)) refractiveIndex = ri;
      const disp = parseFloat(renderEl.getAttribute('dispersion'));
      if (isFinite(disp)) dispersion = disp;
   }

   const floatsPerVertex = 7;
   const triangles = [];
   const facets = [];

   for (const tierEl of doc.querySelectorAll('tier')) {
      const tierName = (tierEl.getAttribute('name') || '').trim();
      const tierInst = (tierEl.getAttribute('instructions') || '').trim();

      for (const facetEl of tierEl.querySelectorAll('facet')) {
         const nx = parseFloat(facetEl.getAttribute('nx') || '0');
         const ny = parseFloat(facetEl.getAttribute('ny') || '0');
         const nz = parseFloat(facetEl.getAttribute('nz') || '0');
         // Re-normalise (tiny floating-point noise in source)
         const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
         const normal = [nx / len, ny / len, nz / len];

         const vertEls = facetEl.querySelectorAll('vertex');
         if (vertEls.length < 3) continue;

         // GCS vertices are in CW order from outside — swap v1↔v2 in the fan
         // to restore CCW (front-face) winding. No Y-flip needed: GCS uses the
         // same coordinate convention as the renderer (Z = table = up).
         const verts = Array.from(vertEls).map(v => [
            parseFloat(v.getAttribute('x') || '0'),
            parseFloat(v.getAttribute('y') || '0'),
            parseFloat(v.getAttribute('z') || '0'),
         ]);

         const normalized = normalizeFacetMetadata(tierName, tierInst);

         const triangleCount = verts.length - 2;
         facets.push({
            name: normalized.name,
            instructions: normalized.instructions,
            frosted: normalized.frosted,
            normal,
            vertexCount: verts.length,
            triangleCount,
         });

         // GCS vertices are listed CW from outside; swap v1↔v2 to get CCW (front face).
         for (let i = 1; i < verts.length - 1; i++) {
            triangles.push({
               v0: verts[0],
               v1: verts[i + 1], // swapped
               v2: verts[i],     // swapped
               normal,
               frosted: normalized.frosted,
            });
         }
      }
   }

   const triCount = triangles.length;
   const vertexData = new Float32Array(triCount * 3 * floatsPerVertex);

   for (let i = 0; i < triCount; i++) {
      const { v0, v1, v2, normal, frosted } = triangles[i];
      const vs = [v0, v1, v2];
      for (let v = 0; v < 3; v++) {
         const idx = (i * 3 + v) * floatsPerVertex;
         vertexData[idx + 0] = vs[v][0];
         vertexData[idx + 1] = vs[v][1];
         vertexData[idx + 2] = vs[v][2];
         vertexData[idx + 3] = normal[0];
         vertexData[idx + 4] = normal[1];
         vertexData[idx + 5] = normal[2];
         vertexData[idx + 6] = frosted ? 1.0 : 0.0;
      }
   }

   return new StoneData(vertexData, triCount, facets, refractiveIndex, dispersion);
}

// ---------------------------------------------------------------------------
// GemCad .gem binary format loader — derived from stone.cpp::readGemFile()
//
// The format is NOT a fixed-record binary. It is a flat stream of float64s:
//
//   FACET LOOP (repeat until sentinel):
//     a, b, c   — float64 * 3  (raw plane normal, NOT yet unit length)
//                 sentinel: a == -99999.0 ends the loop
//     int32     — 4 bytes, unused padding (read and discarded)
//     nameLen   — 1 byte: 0 = no name, else number of chars that follow
//     nameChars — nameLen bytes (tab-delimited: "name\tcutting_instructions")
//
//     VERTEX LOOP for this facet (repeat until tag != 1):
//       tag      — int32: 1 = vertex follows, anything else = end of vertices
//       x, y, z  — float64 * 3  (only present when tag == 1)
//
//   TAIL (optional, may be absent in older files):
//     nsym        — int32
//     mirror_sym  — int32  (0 or 1)
//     igear       — int32
//     r_i         — float64  ← refractive index
//
// Key insight from stone.cpp lines 1583-1647:
//   - a,b,c are read raw then normalised: len=sqrt(a²+b²+c²), d=0.9/len
//   - The normalised (a/len, b/len, c/len, d) defines a half-space: ax+by+cz=d
//   - Vertices are reconstructed by intersecting ALL combinations of 3 planes
//   - Each facet's vertices are the intersection points that satisfy ALL planes
//   - The vertex data in the file is ignored (it's a cache GemCad writes for
//     its own use); stone.cpp discards it too (reads but never stores x,y,z)
//
// So we must reconstruct vertices ourselves by plane intersection, exactly
// as stone.cpp::newFacet() does via half-space clipping of a convex hull.
// ---------------------------------------------------------------------------
async function loadGEM(url) {
   const response = await fetch(url);
   const buffer = await response.arrayBuffer();
   const view = new DataView(buffer);
   let offset = 0;
   const SILLY = -99999.0;
   const F64 = 8;
   const I32 = 4;

   // ── 1. Parse plane records ───────────────────────────────────────────────
   const planes = []; // each: { a, b, c, d, name, instructions }  (unit normal, d = 0.9/|abc|)

   function readFacetLabel(byteLength) {
      const safeLength = Math.max(0, Math.min(byteLength, buffer.byteLength - offset));
      const bytes = new Uint8Array(buffer, offset, safeLength);
      offset += safeLength;

      let name = '';
      let instructions = '';
      let active = '';
      let hasSplit = false;

      for (let i = 0; i < bytes.length; i++) {
         const ch = String.fromCharCode(bytes[i]);
         if (ch === '\n' || ch === '\0') break;
         if (ch === '\t' && !hasSplit) {
            name = active;
            active = '';
            hasSplit = true;
            continue;
         }
         active += ch;
      }

      if (hasSplit) instructions = active;
      else name = active;

      return {
         name: name.trim(),
         instructions: instructions.trim(),
      };
   }

   while (offset + F64 <= buffer.byteLength) {
      const a_raw = view.getFloat64(offset, true); offset += F64;
      if (a_raw === SILLY) break;

      if (offset + F64 * 2 > buffer.byteLength) break;
      const b_raw = view.getFloat64(offset, true); offset += F64;
      const c_raw = view.getFloat64(offset, true); offset += F64;

      const len = Math.sqrt(a_raw * a_raw + b_raw * b_raw + c_raw * c_raw);
      if (len === 0) continue; // zero-length normal, skip plane

      const plane = {
         a: a_raw / len,
         b: b_raw / len,
         c: c_raw / len,
         d: 0.9 / len,   // matches stone.cpp: d = 1/len * 0.9
         name: '',
         instructions: '',
         frosted: false,
      };
      planes.push(plane);

      // discard the int32 pad
      offset += I32;

      // read name (1-byte length prefix)
      if (offset >= buffer.byteLength) break;
      const nameLen = view.getUint8(offset); offset += 1;
      if (nameLen > 0) {
         const label = readFacetLabel(nameLen);
         const normalized = normalizeFacetMetadata(label.name, label.instructions);
         plane.name = normalized.name;
         plane.instructions = normalized.instructions;
         plane.frosted = normalized.frosted;
      }

      // skip cached vertex data: read int32 tags until tag != 1
      while (offset + I32 <= buffer.byteLength) {
         const tag = view.getInt32(offset, true); offset += I32;
         if (tag !== 1) break;
         offset += F64 * 3; // skip x, y, z
      }
   }

   // ── 2. Read optional tail ────────────────────────────────────────────────
   let refractiveIndex = 1.77; // default: corundum, reasonable fallback
   if (offset + I32 * 3 + F64 <= buffer.byteLength) {
      offset += I32; // nsym
      offset += I32; // mirror_sym
      offset += I32; // igear
      refractiveIndex = view.getFloat64(offset, true);
   }

   // ── 3. Reconstruct vertices by 3-plane intersection ──────────────────────
   // For a convex polyhedron defined by half-spaces ax+by+cz <= d, every
   // vertex is the intersection of exactly 3 planes. We try all C(n,3)
   // combinations and keep points that satisfy ALL planes (within epsilon).
   const EPSILON = 1e-8;
   const VERTEX_EPS = 1e-6; // deduplicate tolerance

   function intersect3Planes(p0, p1, p2) {
      // Solve: [p0; p1; p2] * [x,y,z]^T = [d0, d1, d2]^T
      const { a: a0, b: b0, c: c0, d: d0 } = p0;
      const { a: a1, b: b1, c: c1, d: d1 } = p1;
      const { a: a2, b: b2, c: c2, d: d2 } = p2;

      const det = a0 * (b1 * c2 - b2 * c1) - b0 * (a1 * c2 - a2 * c1) + c0 * (a1 * b2 - a2 * b1);
      if (Math.abs(det) < EPSILON) return null; // parallel/degenerate

      const x = (d0 * (b1 * c2 - b2 * c1) - b0 * (d1 * c2 - d2 * c1) + c0 * (d1 * b2 - d2 * b1)) / det;
      const y = (a0 * (d1 * c2 - d2 * c1) - d0 * (a1 * c2 - a2 * c1) + c0 * (a1 * d2 - a2 * d1)) / det;
      const z = (a0 * (b1 * d2 - b2 * d1) - b0 * (a1 * d2 - a2 * d1) + d0 * (a1 * b2 - a2 * b1)) / det;
      return [x, y, z];
   }

   function insideAllPlanes(pt) {
      const [x, y, z] = pt;
      for (const p of planes) {
         if (p.a * x + p.b * y + p.c * z > p.d + EPSILON) return false;
      }
      return true;
   }

   // Collect unique vertices
   const allVerts = [];
   function addVertex(pt) {
      for (const v of allVerts) {
         if (Math.abs(v[0] - pt[0]) + Math.abs(v[1] - pt[1]) + Math.abs(v[2] - pt[2]) < VERTEX_EPS)
            return allVerts.indexOf(v);
      }
      allVerts.push(pt);
      return allVerts.length - 1;
   }

   // For each plane, collect which vertices lie on it (within epsilon)
   const n = planes.length;
   const facetVerts = planes.map(() => []); // facetVerts[planeIdx] = [vertIdx, ...]

   for (let i = 0; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
         for (let k = j + 1; k < n; k++) {
            const pt = intersect3Planes(planes[i], planes[j], planes[k]);
            if (!pt || !insideAllPlanes(pt)) continue;

            const vi = addVertex(pt);

            // This vertex belongs to planes i, j, k
            for (const pi of [i, j, k]) {
               if (!facetVerts[pi].includes(vi))
                  facetVerts[pi].push(vi);
            }
         }
      }
   }

   // ── 4. Order each facet's vertices in CCW winding ────────────────────────
   // Project onto the facet plane and sort by angle around centroid.
   function orderFacetVerts(planeIdx, vindices) {
      if (vindices.length < 3) return vindices;
      const p = planes[planeIdx];
      const normal = [p.a, p.b, p.c];

      // Centroid
      let cx = 0, cy = 0, cz = 0;
      for (const vi of vindices) {
         cx += allVerts[vi][0];
         cy += allVerts[vi][1];
         cz += allVerts[vi][2];
      }
      cx /= vindices.length;
      cy /= vindices.length;
      cz /= vindices.length;

      // Build two tangent vectors in the plane
      let t0 = [1, 0, 0];
      if (Math.abs(normal[0]) > 0.9) t0 = [0, 1, 0];
      // t1 = normal × t0
      const t1 = [
         normal[1] * t0[2] - normal[2] * t0[1],
         normal[2] * t0[0] - normal[0] * t0[2],
         normal[0] * t0[1] - normal[1] * t0[0],
      ];
      // t0 = t1 × normal  (orthogonalise)
      const tu = [
         t1[1] * normal[2] - t1[2] * normal[1],
         t1[2] * normal[0] - t1[0] * normal[2],
         t1[0] * normal[1] - t1[1] * normal[0],
      ];

      const angles = vindices.map(vi => {
         const dx = allVerts[vi][0] - cx;
         const dy = allVerts[vi][1] - cy;
         const dz = allVerts[vi][2] - cz;
         const u = dx * tu[0] + dy * tu[1] + dz * tu[2];
         const v = dx * t1[0] + dy * t1[1] + dz * t1[2];
         return { vi, angle: Math.atan2(v, u) };
      });

      angles.sort((a, b) => a.angle - b.angle);
      return angles.map(a => a.vi);
   }

   // ── 5. Tessellate and pack ────────────────────────────────────────────────
   const triangles = [];
   const facets = [];

   for (let pi = 0; pi < n; pi++) {
      const verts = orderFacetVerts(pi, facetVerts[pi]);
      if (verts.length < 3) continue;

      const p = planes[pi];
      const nx = p.a, ny = p.b, nz = p.c;
      const triangleCount = verts.length - 2;
      facets.push({
         index: pi + 1,
         name: p.name,
         instructions: p.instructions,
         frosted: Boolean(p.frosted),
         normal: [nx, ny, nz],
         d: p.d,
         vertexCount: verts.length,
         triangleCount,
      });

      // Fan triangulation from first vertex
      for (let i = 1; i < verts.length - 1; i++) {
         triangles.push({
            v0: allVerts[verts[0]],
            v1: allVerts[verts[i]],
            v2: allVerts[verts[i + 1]],
            normal: [nx, ny, nz],
            frosted: Boolean(p.frosted),
         });
      }
   }

   // Pack into flat Float32Array matching loadSTL output format.
   // GemCad's Y axis is inverted relative to the renderer's convention,
   // so negate Y on both positions and normals. Swapping v1↔v2 restores
   // the CCW winding that the negation would otherwise flip.
   const triCount = triangles.length;
   const floatsPerVertex = 7;
   const vertexData = new Float32Array(triCount * 3 * floatsPerVertex);

   for (let i = 0; i < triCount; i++) {
      const { v0, v1, v2, normal, frosted } = triangles[i];
      const vs = [v0, v2, v1]; // swap v1↔v2 to fix winding after Y-flip
      for (let v = 0; v < 3; v++) {
         const idx = (i * 3 + v) * floatsPerVertex;
         vertexData[idx + 0] = vs[v][0];
         vertexData[idx + 1] = -vs[v][1]; // flip Y
         vertexData[idx + 2] = vs[v][2];
         vertexData[idx + 3] = normal[0];
         vertexData[idx + 4] = -normal[1]; // flip Y
         vertexData[idx + 5] = normal[2];
         vertexData[idx + 6] = frosted ? 1.0 : 0.0;
      }
   }

   return new StoneData(vertexData, triCount, facets, refractiveIndex, null);
}

function normalizeMesh(data) {
   let min = [Infinity, Infinity, Infinity];
   let max = [-Infinity, -Infinity, -Infinity];

   for (let i = 0; i < data.length; i += 7) {
      for (let a = 0; a < 3; a++) {
         if (data[i + a] < min[a]) min[a] = data[i + a];
         if (data[i + a] > max[a]) max[a] = data[i + a];
      }
   }

   const center = min.map((v, i) => (v + max[i]) / 2);
   const size = min.map((v, i) => max[i] - v);
   const maxDimension = Math.max(...size);
   const scale = 2.0 / maxDimension;

   for (let i = 0; i < data.length; i += 7) {
      data[i] = (data[i] - center[0]) * scale;
      data[i + 1] = (data[i + 1] - center[1]) * scale;
      data[i + 2] = (data[i + 2] - center[2]) * scale;
   }

   return scale;
}

// ---------------------------------------------------------------------------
// BVH Builder
// Each triangle is stored as:
// [v0x,v0y,v0z, v1x,v1y,v1z, v2x,v2y,v2z, nx,ny,nz, frosted]
// = 13 floats per triangle → triangleBuffer (storage buffer)
//
// BVH node layout (8 floats each, aligned for GPU):
//   [aabbMinX, aabbMinY, aabbMinZ, leftOrTriIdx,
//    aabbMaxX, aabbMaxY, aabbMaxZ, triCountOrRight]
//
//   Leaf:  triCountOrRight > 0  → triCount triangles starting at leftOrTriIdx
//   Inner: triCountOrRight == 0 → left child = leftOrTriIdx, right = leftOrTriIdx+1
// ---------------------------------------------------------------------------

function buildBVH(vertexData, triangleCount) {
   const floatsPerVertex = 7;
   const floatsPerTriangle = 13;
   // Pack triangles into flat array: 13 floats each
   const tris = new Float32Array(triangleCount * floatsPerTriangle);
   for (let i = 0; i < triangleCount; i++) {
      const base = i * 3 * floatsPerVertex;
      const t = i * floatsPerTriangle;
      // v0
      tris[t + 0] = vertexData[base + 0];
      tris[t + 1] = vertexData[base + 1];
      tris[t + 2] = vertexData[base + 2];
      // v1
      tris[t + 3] = vertexData[base + 7];
      tris[t + 4] = vertexData[base + 8];
      tris[t + 5] = vertexData[base + 9];
      // v2
      tris[t + 6] = vertexData[base + 14];
      tris[t + 7] = vertexData[base + 15];
      tris[t + 8] = vertexData[base + 16];
      // face normal
      tris[t + 9] = vertexData[base + 3];
      tris[t + 10] = vertexData[base + 4];
      tris[t + 11] = vertexData[base + 5];
      tris[t + 12] = vertexData[base + 6];
   }

   // Centroid per triangle for splitting
   const centroids = new Float32Array(triangleCount * 3);
   for (let i = 0; i < triangleCount; i++) {
      const t = i * floatsPerTriangle;
      centroids[i * 3 + 0] = (tris[t + 0] + tris[t + 3] + tris[t + 6]) / 3;
      centroids[i * 3 + 1] = (tris[t + 1] + tris[t + 4] + tris[t + 7]) / 3;
      centroids[i * 3 + 2] = (tris[t + 2] + tris[t + 5] + tris[t + 8]) / 3;
   }

   // Triangle index array — we'll reorder this during BVH build
   const triIndices = new Int32Array(triangleCount);
   for (let i = 0; i < triangleCount; i++) triIndices[i] = i;

   const nodes = []; // will hold {minX,minY,minZ,maxX,maxY,maxZ,left,right,triStart,triCount}

   function computeAABB(start, count) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = start; i < start + count; i++) {
         const ti = triIndices[i] * floatsPerTriangle;
         for (let v = 0; v < 3; v++) {
            const x = tris[ti + v * 3 + 0];
            const y = tris[ti + v * 3 + 1];
            const z = tris[ti + v * 3 + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
         }
      }
      return { minX, minY, minZ, maxX, maxY, maxZ };
   }

   const LEAF_MAX = 4; // max triangles per leaf

   function buildNode(start, count) {
      const nodeIdx = nodes.length;
      nodes.push(null); // placeholder

      const aabb = computeAABB(start, count);

      if (count <= LEAF_MAX) {
         nodes[nodeIdx] = { ...aabb, triStart: start, triCount: count, left: -1, right: -1 };
         return nodeIdx;
      }

      // Choose longest axis
      const dx = aabb.maxX - aabb.minX;
      const dy = aabb.maxY - aabb.minY;
      const dz = aabb.maxZ - aabb.minZ;
      const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;

      // Sort by centroid along axis
      const sub = triIndices.subarray(start, start + count);
      sub.sort((a, b) => centroids[a * 3 + axis] - centroids[b * 3 + axis]);

      const mid = Math.floor(count / 2);
      const left = buildNode(start, mid);
      const right = buildNode(start + mid, count - mid);

      nodes[nodeIdx] = { ...aabb, triStart: -1, triCount: 0, left, right };
      return nodeIdx;
   }

   buildNode(0, triangleCount);

   // Pack nodes into Float32Array: 8 floats per node
   // [minX, minY, minZ, leftOrTriStart,  maxX, maxY, maxZ, triCountOrZero]
   const nodeCount = nodes.length;
   const nodeBuffer = new Float32Array(nodeCount * 8);
   for (let i = 0; i < nodeCount; i++) {
      const n = nodes[i];
      const b = i * 8;
      nodeBuffer[b + 0] = n.minX;
      nodeBuffer[b + 1] = n.minY;
      nodeBuffer[b + 2] = n.minZ;
      nodeBuffer[b + 3] = n.triCount > 0 ? n.triStart : n.left; // leaf: triStart, inner: left child
      nodeBuffer[b + 4] = n.maxX;
      nodeBuffer[b + 5] = n.maxY;
      nodeBuffer[b + 6] = n.maxZ;
      nodeBuffer[b + 7] = n.triCount > 0 ? n.triCount : -(n.right + 1); // leaf: triCount>0, inner: -rightIdx
   }

   // Reorder triangle buffer by triIndices so leaves are contiguous
   const sortedTris = new Float32Array(triangleCount * floatsPerTriangle);
   for (let i = 0; i < triangleCount; i++) {
      const src = triIndices[i] * floatsPerTriangle;
      const dst = i * floatsPerTriangle;
      for (let j = 0; j < floatsPerTriangle; j++) sortedTris[dst + j] = tris[src + j];
   }

   return { nodeBuffer, triBuffer: sortedTris, nodeCount };
}

// ---------------------------------------------------------------------------
// Module-level state — shared across model reloads
// ---------------------------------------------------------------------------
const ui = {
   ri: presets[0][1],
   cod: presets[0][2],
   lightMode: 3,
   color: [1, 1, 1],
   exitHighlight: [0, 0, 0],
   exitStrength: 0.0,
   tiltAngleDeg: 10,
   focalLength: 200,
};

// Camera / interaction (survive model reloads)
const modelMat = mat4.create();
const viewMat = mat4.create();
const projMat = mat4.create();
const cameraPos = vec4.fromValues(0, 0, 5, 0);
let targetRotX = 0, targetRotY = 0;
let currentRotX = 0, currentRotY = 0;
let animating = false, animStartTime = 0;

// Current model GPU resources — replaced by loadModel()
let renderBundle = null; // { bindGroup, graphBindGroups, vertexBuffer, triCount }

// Reference to UI controls — set by setupApp(), used by loadModel()
let uiControls = null;

const GRAPH_SAMPLE_SIZE = 64;
const GRAPH_COLOR_FORMAT = 'rgba16float';
const GRAPH_REDUCE_SUM_SCALE = 65536;
const GRAPH_VALUE_SCALE = 100;
const GRAPH_TILT_MIN = -30;
const GRAPH_TILT_MAX = 30;
const GRAPH_TILT_STEP = 1;
const GRAPH_MODES = [
   { label: 'ISO', color: '#e8e8e8', mode: 0 },
   { label: 'COS', color: '#ff5f5f', mode: 1 },
   { label: 'SC2', color: '#59e35f', mode: 2 },
];
const GRAPH_TILT_VALUES = Array.from(
   { length: Math.floor((GRAPH_TILT_MAX - GRAPH_TILT_MIN) / GRAPH_TILT_STEP) + 1 },
   (_, i) => GRAPH_TILT_MIN + i * GRAPH_TILT_STEP,
);
const GRAPH_TILT_COUNT = GRAPH_TILT_VALUES.length;
const GRAPH_MODE_COUNT = GRAPH_MODES.length;
const GRAPH_TILE_COUNT = GRAPH_TILT_COUNT * GRAPH_MODE_COUNT;
const GRAPH_ATLAS_WIDTH = GRAPH_SAMPLE_SIZE * GRAPH_TILT_COUNT;
const GRAPH_ATLAS_HEIGHT = GRAPH_SAMPLE_SIZE * GRAPH_MODE_COUNT;
const ORIENTATION_CACHE_ANGLE_STEP_DEG = 0.05;
const ORIENTATION_CACHE_MAX_ENTRIES = 1 / ORIENTATION_CACHE_ANGLE_STEP_DEG * 30 * 2; // 30° in each direction, both axes
const ORIENTATION_CACHE_ANGLE_STEP_RAD = ORIENTATION_CACHE_ANGLE_STEP_DEG * Math.PI / 180.0;
const TILT_ANIM_STEP_SEC = 1.2;
const TILT_ANIM_CYCLE_SEC = TILT_ANIM_STEP_SEC * 2;
const TILT_PRERENDER_SAMPLE_FPS = 60;
const TILT_PRERENDER_FPS_THRESHOLD = 50;
const TILT_PRERENDER_BUDGET_PER_FRAME = 2;

// ---------------------------------------------------------------------------
// setupApp — one-time WebGPU + UI init; returns { loadModel }
// ---------------------------------------------------------------------------
async function setupApp() {
   const canvas = document.getElementById('gpuCanvas');
   const isMobileDevice =
      navigator.userAgentData?.mobile
      || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
   const adapter = await navigator.gpu?.requestAdapter(
      isMobileDevice ? { powerPreference: 'low-power' } : undefined,
   );
   const adapterSupportsTimestamps = adapter?.features?.has?.('timestamp-query') ?? false;
   let device = null;
   if (adapterSupportsTimestamps) {
      try {
         device = await adapter?.requestDevice({ requiredFeatures: ['timestamp-query'] });
      } catch {
         device = null;
      }
   }
   if (!device) {
      device = await adapter?.requestDevice();
   }

   if (!device) {
      alert('WebGPU is not supported. Try Chrome/Edge.');
      return null;
   }

   const context = canvas.getContext('webgpu');
   const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

   function bytesPerPixelForFormat(format) {
      switch (format) {
         case 'bgra8unorm':
         case 'bgra8unorm-srgb':
         case 'rgba8unorm':
         case 'rgba8unorm-srgb':
         case 'rgba8snorm':
         case 'rgba8uint':
         case 'rgba8sint':
            return 4;
         case 'rg16float':
         case 'rg16uint':
         case 'rg16sint':
            return 4;
         case 'rgba16float':
         case 'rgba16uint':
         case 'rgba16sint':
            return 8;
         case 'r16float':
         case 'r16uint':
         case 'r16sint':
            return 2;
         case 'r32float':
         case 'r32uint':
         case 'r32sint':
            return 4;
         case 'rg32float':
         case 'rg32uint':
         case 'rg32sint':
            return 8;
         case 'rgba32float':
         case 'rgba32uint':
         case 'rgba32sint':
            return 16;
         default:
            return 4;
      }
   }
   const cacheBytesPerPixel = bytesPerPixelForFormat(canvasFormat);

   function estimateCacheTextureBytes(width, height, bytesPerPixel) {
      return Math.max(0, Math.floor(width) * Math.floor(height) * bytesPerPixel);
   }
   context.configure({
      device,
      format: canvasFormat,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
   });

   // --- Pipeline (created once, reused for every model load) ---
   const shaderModule = device.createShaderModule({ code: shaderSource });

   const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
         module: shaderModule, entryPoint: 'vs_main',
         buffers: [{
            arrayStride: 7 * 4,
            attributes: [
               { shaderLocation: 0, offset: 0, format: 'float32x3' },
               { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
               { shaderLocation: 2, offset: 6 * 4, format: 'float32' },
            ],
         }],
      },
      fragment: {
         module: shaderModule, entryPoint: 'fs_main',
         targets: [{
            format: canvasFormat,
            blend: {
               color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
               alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
         }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
   });

   // --- Uniform buffer (layout matches Uniforms struct in shaders.wgsl) ---
   //   0:   modelMatrix       mat4  (64 b)
   //   64:  viewMatrix        mat4  (64 b)
   //   128: projectionMatrix  mat4  (64 b)
   //   192: cameraPosition + pad    (16 b)
   //   208: time / ri / cod / mode  (16 b)
   //   224: stoneColor + graphMode  (16 b)
   //   240: exitHighlight + str     (16 b)
   //   256: flatShading + pad        (16 b)
   const uniformBuffer = device.createBuffer({
      size: 272,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
   });

   const graphUniformBuffers = Array.from({ length: GRAPH_TILE_COUNT }, () => device.createBuffer({
      size: 272,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
   }));

   const graphPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
         module: shaderModule, entryPoint: 'vs_main',
         buffers: [{
            arrayStride: 7 * 4,
            attributes: [
               { shaderLocation: 0, offset: 0, format: 'float32x3' },
               { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
               { shaderLocation: 2, offset: 6 * 4, format: 'float32' },
            ],
         }],
      },
      fragment: {
         module: shaderModule, entryPoint: 'fs_main',
         targets: [{
            format: GRAPH_COLOR_FORMAT,
            blend: {
               color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
               alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
         }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
   });

   // Separate module loaded from compute.wgsl — only declares @group(0)
   // bindings it actually uses, so Firefox doesn't require the main
   // shader's @group(0) (uniforms/triangles/bvh) to be bound at dispatch.
   const computeReduceShaderModule = device.createShaderModule({ code: computeShaderSource });
   const graphReducePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
         module: computeReduceShaderModule,
         entryPoint: 'cs_reduce_graph',
      },
   });

   // --- Depth texture (recreated on resize) ---
   let depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
   });

   const graphColorTexture = device.createTexture({
      size: [GRAPH_ATLAS_WIDTH, GRAPH_ATLAS_HEIGHT],
      format: GRAPH_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
   });
   const graphDepthTexture = device.createTexture({
      size: [GRAPH_ATLAS_WIDTH, GRAPH_ATLAS_HEIGHT],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
   });
   const graphAtlasParamsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
   });
   new Uint32Array(graphAtlasParamsBuffer.getMappedRange()).set([
      GRAPH_SAMPLE_SIZE,
      GRAPH_SAMPLE_SIZE,
      GRAPH_TILT_COUNT,
      GRAPH_MODE_COUNT,
   ]);
   graphAtlasParamsBuffer.unmap();
   const graphReduceBuffer = device.createBuffer({
      size: GRAPH_TILE_COUNT * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
   });
   const graphReduceReadbackBuffer = device.createBuffer({
      size: GRAPH_TILE_COUNT * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
   });

   const graphReduceBindGroup = device.createBindGroup({
      layout: graphReducePipeline.getBindGroupLayout(0),
      entries: [
         { binding: 0, resource: graphColorTexture.createView() },
         { binding: 1, resource: { buffer: graphReduceBuffer } },
         { binding: 2, resource: { buffer: graphAtlasParamsBuffer } },
      ],
   });

   const hasGpuTimestamps = device.features?.has?.('timestamp-query') ?? false;
   const frameTimestampQuerySet = hasGpuTimestamps
      ? device.createQuerySet({ type: 'timestamp', count: 2 })
      : null;
   const frameTimestampResolveBuffer = hasGpuTimestamps
      ? device.createBuffer({
         size: 16,
         usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
      : null;
   const frameTimestampReadbackBuffer = hasGpuTimestamps
      ? device.createBuffer({
         size: 16,
         usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      : null;
   const queueTimestampPeriod = typeof device.queue.getTimestampPeriod === 'function'
      ? device.queue.getTimestampPeriod()
      : 1;

   // Camera looks down +Z toward the table
   mat4.lookAt(viewMat, cameraPos, [0, 0, 0], [0, 1, 0]);

   // Panels are defined in index.html — just acquire references.
   const graphPanel = document.getElementById('lightReturnPanel');
   const facetPanel = document.getElementById('facetInfoPanel');
   const graphToggleEl = document.getElementById('lightReturnToggle');
   const graphBodyEl = document.getElementById('lightReturnBody');
   const graphResizeEl = document.getElementById('lightReturnResize');
   const graphStatusEl = document.getElementById('lightReturnStatus');
   const graphCanvas = document.getElementById('lightReturnCanvas');
   const facetToggleEl = document.getElementById('facetInfoToggle');
   const facetStatusEl = document.getElementById('facetInfoStatus');
   const facetListEl = document.getElementById('facetInfoList');
   const facetResizeEl = document.getElementById('facetInfoResize');
   const graphCtx = graphCanvas.getContext('2d');
   const graphDpr = window.devicePixelRatio || 1;
   let graphCanvasWidth = 388;
   let graphCanvasHeight = 220;
   let latestGraphSeries = null;
   let latestFacetInfo = [];

   function resizeGraphCanvas() {
      const nextWidth = Math.max(220, Math.round(graphCanvas.clientWidth || graphBodyEl.clientWidth));
      const nextHeight = Math.max(140, Math.round(graphCanvas.clientHeight || 220));
      graphCanvasWidth = nextWidth;
      graphCanvasHeight = nextHeight;
      graphCanvas.width = Math.round(graphCanvasWidth * graphDpr);
      graphCanvas.height = Math.round(graphCanvasHeight * graphDpr);
      graphCtx.setTransform(graphDpr, 0, 0, graphDpr, 0, 0);
      if (latestGraphSeries && !graphPanel.classList.contains('collapsed')) drawGraph(latestGraphSeries);
   }

   resizeGraphCanvas();

   let graphUpdateTimer = null;
   let graphRequestId = 0;
   let graphBusy = false;
   let graphNeedsRerun = false;
   // DOM is the source of truth for collapsed state — no separate JS flags.
   let graphExpandedSize = { width: 420, height: 320 };
   let facetExpandedSize = { width: 420, height: 260 };

   function escapeHtml(text) {
      return String(text)
         .replaceAll('&', '&amp;')
         .replaceAll('<', '&lt;')
         .replaceAll('>', '&gt;')
         .replaceAll('"', '&quot;')
         .replaceAll("'", '&#39;');
   }


   function computeFacetAngleDeg(normal) {
      const nz = Math.max(-1, Math.min(1, Math.abs(normal[2] ?? 0)));
      return Math.acos(nz) * 180 / Math.PI;
   }

   function computeFacetGearIndex(normal) {
      const x = normal[0] ?? 0;
      const y = normal[1] ?? 0;
      if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return 'Table';

      const turns = Math.atan2(x, y) / (Math.PI * 2);
      let gear = Math.round(turns * 96);
      gear = ((gear % 96) + 96) % 96;
      if (gear === 0) gear = 96;
      return String(gear).padStart(2, '0');
   }

   function getFacetSection(name) {
      const prefix = String(name || '').trim().charAt(0).toUpperCase();
      if (prefix === 'P' || prefix === 'G') return 'PAVILION';
      if (prefix === 'C' || prefix === 'T') return 'CROWN';
      return 'OTHER';
   }

   function groupFacetInfo(facets = []) {
      const sections = new Map([
         ['PAVILION', []],
         ['CROWN', []],
         ['OTHER', []],
      ]);
      const grouped = new Map();

      for (const facet of facets) {
         const name = (facet.name || '').trim() || '?';
         const instructions = (facet.instructions || '').trim();
         const angle = computeFacetAngleDeg(facet.normal || [0, 0, 1]);
         const angleKey = angle.toFixed(2);
         const key = `${angleKey}\u0000${instructions}`;
         let entry = grouped.get(key);
         if (!entry) {
            entry = {
               section: getFacetSection(name),
               name,
               angle,
               angleLabel: `${angleKey}°`,
               indexes: [],
               instructions,
            };
            grouped.set(key, entry);
            sections.get(entry.section)?.push(entry);
         } else if ((entry.name === '?' || !entry.name) && name !== '?') {
            const nextSection = getFacetSection(name);
            if (entry.section !== nextSection) {
               const currentEntries = sections.get(entry.section);
               const currentIndex = currentEntries?.indexOf(entry) ?? -1;
               if (currentIndex >= 0) currentEntries.splice(currentIndex, 1);
               sections.get(nextSection)?.push(entry);
               entry.section = nextSection;
            }
            entry.name = name;
         }
         entry.indexes.push(computeFacetGearIndex(facet.normal || [0, 0, 1]));
      }

      for (const entries of sections.values()) {
         entries.forEach((entry) => {
            const numeric = [];
            const text = [];
            for (const index of entry.indexes) {
               if (/^\d+$/.test(index)) numeric.push(parseInt(index, 10));
               else text.push(index);
            }
            numeric.sort((a, b) => a - b);
            text.sort((a, b) => a.localeCompare(b));
            entry.indexes = [
               ...numeric.map((value) => String(value).padStart(2, '0')),
               ...text,
            ];
         });

         entries.sort((a, b) => {
            const nameCmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            if (nameCmp !== 0) return nameCmp;
            return a.angle - b.angle;
         });
      }

      return sections;
   }

   function formatFacetIndexLines(indexes) {
      if (!indexes.length) return ['—'];
      const lines = [];
      for (let i = 0; i < indexes.length; i += 6) {
         const chunk = indexes.slice(i, i + 6);
         const hasMore = i + 6 < indexes.length;
         lines.push(chunk.join('-') + (hasMore ? '-' : ''));
      }
      return lines;
   }

   function setFacetStatus(text) {
      facetStatusEl.textContent = text;
   }

   function renderFacetInfo(facets = []) {
      latestFacetInfo = facets;
      facetListEl.innerHTML = '';

      if (!facets.length) {
         facetListEl.innerHTML = '<div class="facetEmpty">No facet notes were found for this model.</div>';
         return;
      }

      const groupedSections = groupFacetInfo(facets);
      const sectionOrder = ['PAVILION', 'CROWN', 'OTHER'];
      const html = [];

      for (const sectionName of sectionOrder) {
         const entries = groupedSections.get(sectionName) || [];
         if (!entries.length) continue;

         html.push(`
            <div class="facetSection">
               <div class="facetSectionTitle">${sectionName}</div>
               ${entries.map((entry) => {
            const instruction = entry.instructions ? escapeHtml(entry.instructions) : '—';
            return `
                     <div class="facetGroup">
                        <div class="facetGroupName">${escapeHtml(entry.name)}</div>
                        <div class="facetGroupAngle">${escapeHtml(entry.angleLabel)}</div>
                        <div class="facetGroupIndexes">${escapeHtml(formatFacetIndexLines(entry.indexes).join('\n'))}</div>
                        <div class="facetGroupInst">${instruction}</div>
                     </div>
                  `;
         }).join('')}
            </div>
         `);
      }

      facetListEl.innerHTML = html.join('') || '<div class="facetEmpty">No facet notes were found for this model.</div>';
   }

   // Toggles a panel's collapsed state. DOM class is the sole source of truth.
   function togglePanel(panelEl, toggleEl, expandedSizeRef, name, onExpand) {
      const willCollapse = !panelEl.classList.contains('collapsed');
      if (window.innerWidth > 960) {
         if (willCollapse) {
            const rect = panelEl.getBoundingClientRect();
            expandedSizeRef.width = Math.max(260, Math.round(rect.width));
            expandedSizeRef.height = Math.max(120, Math.round(rect.height));
            panelEl.style.width = '200px';
            panelEl.style.height = 'auto';
         } else {
            panelEl.style.width = `${expandedSizeRef.width}px`;
            panelEl.style.height = `${expandedSizeRef.height}px`;
         }
      } else {
         panelEl.style.width = '';
         panelEl.style.height = '';
      }
      panelEl.classList.toggle('collapsed', willCollapse);
      toggleEl.textContent = willCollapse ? '+' : '−';
      toggleEl.setAttribute('aria-label', willCollapse ? `Expand ${name}` : `Minimize ${name}`);
      if (!willCollapse) onExpand?.();
   }

   facetToggleEl.addEventListener('click', () => {
      togglePanel(facetPanel, facetToggleEl, facetExpandedSize, 'facet notes');
   });

   let facetResizeDrag = null;
   let facetResizePointerId = null;
   facetResizeEl.addEventListener('pointerdown', (e) => {
      if (facetPanel.classList.contains('collapsed')) return;
      e.preventDefault();
      e.stopPropagation();
      facetResizeDrag = {
         top: facetPanel.getBoundingClientRect().top,
         right: facetPanel.getBoundingClientRect().right,
      };
      facetResizePointerId = e.pointerId;
      facetResizeEl.setPointerCapture(e.pointerId);
   });

   facetResizeEl.addEventListener('pointermove', (e) => {
      if (!facetResizeDrag) return;
      const nextWidth = Math.max(260, Math.round(facetResizeDrag.right - e.clientX));
      const nextHeight = Math.max(120, Math.round(e.clientY - facetResizeDrag.top));
      facetPanel.style.width = `${nextWidth}px`;
      facetPanel.style.height = `${nextHeight}px`;
      facetExpandedSize = { width: nextWidth, height: nextHeight };
   });

   function endFacetResize(pointerId = facetResizePointerId) {
      if (!facetResizeDrag) return;
      facetResizeDrag = null;
      if (pointerId != null && facetResizeEl.hasPointerCapture(pointerId)) {
         facetResizeEl.releasePointerCapture(pointerId);
      }
      facetResizePointerId = null;
   }

   facetResizeEl.addEventListener('pointerup', (e) => endFacetResize(e.pointerId));
   facetResizeEl.addEventListener('pointercancel', (e) => endFacetResize(e.pointerId));
   facetResizeEl.addEventListener('lostpointercapture', () => endFacetResize());
   window.addEventListener('pointerup', () => endFacetResize());
   window.addEventListener('blur', () => endFacetResize());

   const graphModelMat = mat4.create();
   const graphProjMat = mat4.create();

   function setGraphStatus(text) {
      graphStatusEl.textContent = text;
   }

   graphToggleEl.addEventListener('click', () => {
      togglePanel(graphPanel, graphToggleEl, graphExpandedSize, 'graph', resizeGraphCanvas);
   });

   let graphResizeDrag = null;
   let graphResizePointerId = null;
   graphResizeEl.addEventListener('pointerdown', (e) => {
      if (graphPanel.classList.contains('collapsed')) return;
      e.preventDefault();
      e.stopPropagation();
      graphResizeDrag = {
         top: graphPanel.getBoundingClientRect().top,
         right: graphPanel.getBoundingClientRect().right,
      };
      graphResizePointerId = e.pointerId;
      graphResizeEl.setPointerCapture(e.pointerId);
   });

   graphResizeEl.addEventListener('pointermove', (e) => {
      if (!graphResizeDrag) return;
      const nextWidth = Math.max(260, Math.round(graphResizeDrag.right - e.clientX));
      const nextHeight = Math.max(120, Math.round(e.clientY - graphResizeDrag.top));
      graphPanel.style.width = `${nextWidth}px`;
      graphPanel.style.height = `${nextHeight}px`;
      graphExpandedSize = { width: nextWidth, height: nextHeight };
      resizeGraphCanvas();
   });

   function endGraphResize(pointerId = graphResizePointerId) {
      if (!graphResizeDrag) return;
      graphResizeDrag = null;
      if (pointerId != null && graphResizeEl.hasPointerCapture(pointerId)) {
         graphResizeEl.releasePointerCapture(pointerId);
      }
      graphResizePointerId = null;
   }

   graphResizeEl.addEventListener('pointerup', (e) => endGraphResize(e.pointerId));
   graphResizeEl.addEventListener('pointercancel', (e) => endGraphResize(e.pointerId));
   graphResizeEl.addEventListener('lostpointercapture', () => endGraphResize());
   window.addEventListener('pointerup', () => endGraphResize());
   window.addEventListener('blur', () => endGraphResize());

   const graphResizeObserver = new ResizeObserver(() => {
      if (!graphPanel.classList.contains('collapsed')) resizeGraphCanvas();
   });
   graphResizeObserver.observe(graphPanel);
   graphResizeObserver.observe(graphCanvas);

   const uniformScratch = new Float32Array(272 / 4);

   function packUniformData(out, modelMatrix, projectionMatrix, time, lightMode, graphMode, flatShading) {
      out.set(modelMatrix, 0);
      out.set(viewMat, 16);
      out.set(projectionMatrix, 32);

      out[48] = cameraPos[0];
      out[49] = cameraPos[1];
      out[50] = cameraPos[2];
      out[51] = 0.0;

      out[52] = time;
      out[53] = ui.ri;
      out[54] = ui.cod;
      out[55] = lightMode;

      out[56] = ui.color[0];
      out[57] = ui.color[1];
      out[58] = ui.color[2];
      out[59] = graphMode;

      out[60] = ui.exitHighlight[0];
      out[61] = ui.exitHighlight[1];
      out[62] = ui.exitHighlight[2];
      out[63] = ui.exitStrength;

      out[64] = flatShading;
      out[65] = 0.0;
      out[66] = 0.0;
      out[67] = 0.0;
   }

   function writeUniformsToBuffer(buffer, modelMatrix, projectionMatrix, time, lightMode, graphMode = 0.0) {
      packUniformData(uniformScratch, modelMatrix, projectionMatrix, time, lightMode, graphMode, 0.0);
      device.queue.writeBuffer(buffer, 0, uniformScratch);
   }

   function drawGraph(seriesList) {
      latestGraphSeries = seriesList;
      const W = graphCanvasWidth;
      const H = graphCanvasHeight;
      const padL = 36, padR = 12, padT = 12, padB = 26;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;

      graphCtx.clearRect(0, 0, W, H);
      graphCtx.fillStyle = 'rgba(255,255,255,0.04)';
      graphCtx.fillRect(0, 0, W, H);

      graphCtx.strokeStyle = 'rgba(255,255,255,0.08)';
      graphCtx.lineWidth = 1;
      for (let y = 0; y <= 5; y++) {
         const py = padT + (plotH * y / 5);
         graphCtx.beginPath();
         graphCtx.moveTo(padL, py);
         graphCtx.lineTo(W - padR, py);
         graphCtx.stroke();
      }
      for (let x = 0; x <= 6; x++) {
         const px = padL + (plotW * x / 6);
         graphCtx.beginPath();
         graphCtx.moveTo(px, padT);
         graphCtx.lineTo(px, H - padB);
         graphCtx.stroke();
      }

      graphCtx.strokeStyle = '#cfcfcf';
      graphCtx.beginPath();
      graphCtx.moveTo(padL, padT);
      graphCtx.lineTo(padL, H - padB);
      graphCtx.lineTo(W - padR, H - padB);
      graphCtx.stroke();

      graphCtx.font = '11px system-ui';
      graphCtx.fillStyle = '#aaa';
      graphCtx.textAlign = 'right';
      graphCtx.textBaseline = 'middle';
      for (let v = 0; v <= 100; v += 20) {
         const py = padT + plotH - (v / 100) * plotH;
         graphCtx.fillText(String(v), padL - 6, py);
      }

      graphCtx.textAlign = 'center';
      graphCtx.textBaseline = 'top';
      for (let x = GRAPH_TILT_MIN; x <= GRAPH_TILT_MAX; x += 10) {
         const px = padL + ((x - GRAPH_TILT_MIN) / (GRAPH_TILT_MAX - GRAPH_TILT_MIN)) * plotW;
         graphCtx.fillText(String(x), px, H - padB + 6);
      }

      for (const series of seriesList) {
         graphCtx.strokeStyle = series.color;
         graphCtx.lineWidth = 2;
         graphCtx.beginPath();
         series.points.forEach((p, i) => {
            const px = padL + ((p.tilt - GRAPH_TILT_MIN) / (GRAPH_TILT_MAX - GRAPH_TILT_MIN)) * plotW;
            const py = padT + plotH - Math.max(0, Math.min(100, p.value)) / 100 * plotH;
            if (i === 0) graphCtx.moveTo(px, py);
            else graphCtx.lineTo(px, py);
         });
         graphCtx.stroke();
      }

      graphCtx.textAlign = 'left';
      graphCtx.textBaseline = 'middle';
      seriesList.forEach((series, i) => {
         const y = padT + 8 + i * 16;
         graphCtx.strokeStyle = series.color;
         graphCtx.beginPath();
         graphCtx.moveTo(W - padR - 82, y);
         graphCtx.lineTo(W - padR - 54, y);
         graphCtx.stroke();
         graphCtx.fillStyle = '#ddd';
         graphCtx.fillText(series.label, W - padR - 48, y);
      });
   }

   async function sampleGraphSweep(runId) {
      if (!renderBundle || runId !== graphRequestId) return null;
      const graphSweepStartMs = performance.now();

      // Graph renders at the currently selected focal length.
      const SENSOR_HALF = 5 * Math.tan(Math.PI / 8); // ≈ 2.071 — same reference as main camera
      const graphCamDist = ui.focalLength / 10;
      const graphFovY = 2 * Math.atan(SENSOR_HALF / graphCamDist);
      mat4.perspective(graphProjMat, graphFovY, GRAPH_SAMPLE_SIZE / GRAPH_SAMPLE_SIZE, 0.1, 200.0);

      // Temporarily set globals so writeUniformsToBuffer sends the correct view
      const savedViewMat = new Float32Array(viewMat);
      const savedCamPos = [cameraPos[0], cameraPos[1], cameraPos[2]];
      mat4.lookAt(viewMat, [0, 0, graphCamDist], [0, 0, 0], [0, 1, 0]);
      cameraPos[0] = 0; cameraPos[1] = 0; cameraPos[2] = graphCamDist;

      const { graphBindGroups, vertexBuffer, triCount } = renderBundle;
      const encoder = device.createCommandEncoder();
      encoder.clearBuffer(graphReduceBuffer);

      const pass = encoder.beginRenderPass({
         colorAttachments: [{
            view: graphColorTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
         }],
         depthStencilAttachment: {
            view: graphDepthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
         },
      });
      pass.setPipeline(graphPipeline);
      pass.setVertexBuffer(0, vertexBuffer);

      for (let modeIndex = 0; modeIndex < GRAPH_MODE_COUNT; modeIndex++) {
         const lightMode = GRAPH_MODES[modeIndex].mode;
         for (let tiltIndex = 0; tiltIndex < GRAPH_TILT_COUNT; tiltIndex++) {
            if (runId !== graphRequestId) {
               pass.end();
               viewMat.set(savedViewMat);
               cameraPos[0] = savedCamPos[0]; cameraPos[1] = savedCamPos[1]; cameraPos[2] = savedCamPos[2];
               return null;
            }

            const tiltDeg = GRAPH_TILT_VALUES[tiltIndex];
            const tileIndex = modeIndex * GRAPH_TILT_COUNT + tiltIndex;
            mat4.identity(graphModelMat);
            mat4.rotateX(graphModelMat, graphModelMat, tiltDeg * Math.PI / 180.0);
            writeUniformsToBuffer(graphUniformBuffers[tileIndex], graphModelMat, graphProjMat, 0, lightMode, 1.0);

            pass.setViewport(
               tiltIndex * GRAPH_SAMPLE_SIZE,
               modeIndex * GRAPH_SAMPLE_SIZE,
               GRAPH_SAMPLE_SIZE,
               GRAPH_SAMPLE_SIZE,
               0,
               1,
            );
            pass.setScissorRect(
               tiltIndex * GRAPH_SAMPLE_SIZE,
               modeIndex * GRAPH_SAMPLE_SIZE,
               GRAPH_SAMPLE_SIZE,
               GRAPH_SAMPLE_SIZE,
            );
            pass.setBindGroup(0, graphBindGroups[tileIndex]);
            pass.draw(triCount * 3);
         }
      }
      pass.end();

      const reducePass = encoder.beginComputePass();
      reducePass.setPipeline(graphReducePipeline);
      reducePass.setBindGroup(0, graphReduceBindGroup);
      reducePass.dispatchWorkgroups(
         Math.ceil(GRAPH_ATLAS_WIDTH / 8),
         Math.ceil(GRAPH_ATLAS_HEIGHT / 8),
         1,
      );
      reducePass.end();

      encoder.copyBufferToBuffer(graphReduceBuffer, 0, graphReduceReadbackBuffer, 0, GRAPH_TILE_COUNT * 8);

      device.queue.submit([encoder.finish()]);
      await graphReduceReadbackBuffer.mapAsync(GPUMapMode.READ);
      const reduced = new Uint32Array(graphReduceReadbackBuffer.getMappedRange());

      const seriesList = GRAPH_MODES.map((mode, modeIndex) => {
         const points = GRAPH_TILT_VALUES.map((tilt, tiltIndex) => {
            const tileIndex = modeIndex * GRAPH_TILT_COUNT + tiltIndex;
            const valueSum = reduced[tileIndex * 2 + 0];
            const count = reduced[tileIndex * 2 + 1];
            const value = count > 0
               ? (valueSum / (count * GRAPH_REDUCE_SUM_SCALE)) * GRAPH_VALUE_SCALE
               : 0;
            return { tilt, value };
         });
         return { label: mode.label, color: mode.color, points };
      });

      graphReduceReadbackBuffer.unmap();

      const graphSweepMs = performance.now() - graphSweepStartMs;
      graphSweepMsSmoothed = graphSweepMsSmoothed * 0.8 + graphSweepMs * 0.2;

      // Restore main-camera globals
      viewMat.set(savedViewMat);
      cameraPos[0] = savedCamPos[0]; cameraPos[1] = savedCamPos[1]; cameraPos[2] = savedCamPos[2];

      return seriesList;
   }

   async function recomputeGraph(runId) {
      if (!renderBundle) return;

      const seriesList = await sampleGraphSweep(runId);
      if (!seriesList) return;

      if (runId !== graphRequestId) return;
      drawGraph(seriesList);
      setGraphStatus(`Updated for RI ${ui.ri.toFixed(3)}, COD ${ui.cod.toFixed(3)} · sweep ${GRAPH_TILT_MIN}°…${GRAPH_TILT_MAX}°`);
   }

   function scheduleGraphUpdate(reason = 'parameter change') {
      if (!renderBundle) return;
      graphRequestId++;
      const runId = graphRequestId;
      clearTimeout(graphUpdateTimer);
      setGraphStatus(`Updating graph… (${reason})`);
      graphUpdateTimer = setTimeout(async () => {
         if (graphBusy) {
            graphNeedsRerun = true;
            return;
         }
         graphBusy = true;
         try {
            await recomputeGraph(runId);
         } finally {
            graphBusy = false;
            if (graphNeedsRerun) {
               graphNeedsRerun = false;
               scheduleGraphUpdate('latest values');
            }
         }
      }, 150);
   }

   const orientationFrameCache = new Map();
   const orientationFrameCacheBytes = new Map();
   let orientationCacheTotalBytes = 0;
   let effectiveRenderRotX = 0;
   let effectiveRenderRotY = 0;
   const prewarmModelMat = mat4.create();
   let tiltCyclePrevPhase = null;
   let tiltCycleFrameCount = 0;
   let tiltCycleAccumSec = 0;
   let tiltCycleAvgFps = 0;
   let tiltPreRenderRequested = false;
   let tiltPreRenderReady = false;
   let tiltPreRenderQueue = [];
   let tiltPreRenderIndex = 0;
   let tiltPreRenderBaseRotX = null;
   let tiltPreRenderBaseRotY = null;
   let prewarmOverlayEl = null;
   let prewarmOverlayLabelEl = null;
   let prewarmOverlayBarFillEl = null;

   function ensurePrewarmOverlayElements() {
      if (prewarmOverlayEl) return;
      prewarmOverlayEl = document.createElement('div');
      Object.assign(prewarmOverlayEl.style, {
         position: 'fixed',
         left: '16px',
         top: '16px',
         width: '148px',
         padding: '7px 8px',
         borderRadius: '6px',
         background: 'rgba(0,0,0,0.62)',
         color: '#e8e8e8',
         font: '11px/1.2 system-ui, sans-serif',
         zIndex: '205',
         pointerEvents: 'none',
         display: 'none',
      });

      prewarmOverlayLabelEl = document.createElement('div');
      prewarmOverlayLabelEl.textContent = 'Prewarming';
      prewarmOverlayLabelEl.style.marginBottom = '5px';
      prewarmOverlayEl.appendChild(prewarmOverlayLabelEl);

      const barBgEl = document.createElement('div');
      Object.assign(barBgEl.style, {
         width: '100%',
         height: '6px',
         borderRadius: '4px',
         background: 'rgba(255,255,255,0.14)',
         overflow: 'hidden',
      });
      prewarmOverlayBarFillEl = document.createElement('div');
      Object.assign(prewarmOverlayBarFillEl.style, {
         width: '0%',
         height: '100%',
         borderRadius: '4px',
         background: '#7eb8f7',
      });
      barBgEl.appendChild(prewarmOverlayBarFillEl);
      prewarmOverlayEl.appendChild(barBgEl);
      document.body.appendChild(prewarmOverlayEl);
   }

   function updatePrewarmOverlay() {
      ensurePrewarmOverlayElements();
      if (!prewarmOverlayEl || !prewarmOverlayLabelEl || !prewarmOverlayBarFillEl) return;

      const active = tiltPreRenderRequested && !tiltPreRenderReady;
      if (!active) {
         prewarmOverlayEl.style.display = 'none';
         return;
      }

      const total = Math.max(1, tiltPreRenderQueue.length);
      const done = Math.min(tiltPreRenderIndex, total);
      const pct = (done / total) * 100;
      prewarmOverlayLabelEl.textContent = `Prewarming ${done}/${total}`;
      prewarmOverlayBarFillEl.style.width = `${pct.toFixed(1)}%`;

      if (fpsEl && perfStatsVisible) {
         prewarmOverlayEl.style.top = `${16 + fpsEl.offsetHeight + 8}px`;
      } else {
         prewarmOverlayEl.style.top = '16px';
      }
      prewarmOverlayEl.style.display = 'block';
   }

   function invalidateOrientationCache() {
      for (const texture of orientationFrameCache.values()) {
         texture.destroy();
      }
      orientationFrameCache.clear();
      orientationFrameCacheBytes.clear();
      orientationCacheTotalBytes = 0;
      tiltPreRenderRequested = false;
      tiltPreRenderReady = false;
      tiltPreRenderQueue = [];
      tiltPreRenderIndex = 0;
      tiltPreRenderBaseRotX = null;
      tiltPreRenderBaseRotY = null;
      updatePrewarmOverlay();
   }

   function orientationCacheKey(rotX, rotY) {
      const xDeg = rotX * 180.0 / Math.PI;
      const yDeg = rotY * 180.0 / Math.PI;
      const qx = Math.round(xDeg / ORIENTATION_CACHE_ANGLE_STEP_DEG) * ORIENTATION_CACHE_ANGLE_STEP_DEG;
      const qy = Math.round(yDeg / ORIENTATION_CACHE_ANGLE_STEP_DEG) * ORIENTATION_CACHE_ANGLE_STEP_DEG;
      return `${qx.toFixed(2)}:${qy.toFixed(2)}`;
   }

   function quantizeOrientationAngle(angleRad) {
      return Math.round(angleRad / ORIENTATION_CACHE_ANGLE_STEP_RAD) * ORIENTATION_CACHE_ANGLE_STEP_RAD;
   }

   function sampleTiltAnimation(timeInCycleSec, ampRad) {
      const cycle = ((timeInCycleSec % TILT_ANIM_CYCLE_SEC) + TILT_ANIM_CYCLE_SEC) % TILT_ANIM_CYCLE_SEC;
      const step = Math.floor(cycle / TILT_ANIM_STEP_SEC);
      const frac = (cycle % TILT_ANIM_STEP_SEC) / TILT_ANIM_STEP_SEC;
      const bell = Math.sin(frac * Math.PI);
      return {
         x: step === 0 ? bell * ampRad : 0,
         y: step === 1 ? bell * ampRad : 0,
      };
   }

   function buildTiltPreRenderQueue(baseRotX, baseRotY, ampRad) {
      const keys = new Set();
      const queue = [];
      const addFrame = (rotX, rotY) => {
         const qx = quantizeOrientationAngle(rotX);
         const qy = quantizeOrientationAngle(rotY);
         const key = orientationCacheKey(qx, qy);
         if (keys.has(key)) return;
         keys.add(key);
         queue.push({ key, rotX: qx, rotY: qy });
      };

      const frameCount = Math.max(1, Math.round(TILT_ANIM_CYCLE_SEC * TILT_PRERENDER_SAMPLE_FPS));
      for (let i = 0; i <= frameCount; i++) {
         const tCycle = (i / frameCount) * TILT_ANIM_CYCLE_SEC;
         const animSample = sampleTiltAnimation(tCycle, ampRad);
         addFrame(baseRotX + animSample.x, baseRotY + animSample.y);
      }

      return queue;
   }

   function requestTiltPreRender() {
      if (!renderBundle) return;
      const baseRotX = quantizeOrientationAngle(currentRotX);
      const baseRotY = quantizeOrientationAngle(currentRotY);
      tiltPreRenderBaseRotX = baseRotX;
      tiltPreRenderBaseRotY = baseRotY;
      const ampRad = ui.tiltAngleDeg * Math.PI / 180.0;
      const fullQueue = buildTiltPreRenderQueue(baseRotX, baseRotY, ampRad);
      const missingQueue = fullQueue.filter(item => !orientationFrameCache.has(item.key));
      tiltPreRenderQueue = missingQueue;
      tiltPreRenderIndex = 0;
      tiltPreRenderRequested = missingQueue.length > 0;
      tiltPreRenderReady = missingQueue.length === 0;
      updatePrewarmOverlay();
      requestRender();
   }

   function writeUniformsForOrientation(rotX, rotY, time) {
      mat4.identity(prewarmModelMat);
      mat4.rotateX(prewarmModelMat, prewarmModelMat, rotX);
      mat4.rotateY(prewarmModelMat, prewarmModelMat, rotY);
      packUniformData(
         uniformScratch,
         prewarmModelMat,
         projMat,
         time,
         ui.lightMode,
         0.0,
         ui.lightMode === 4 ? 1.0 : 0.0,
      );
      device.queue.writeBuffer(uniformBuffer, 0, uniformScratch);
   }

   function renderOrientationToCache(cacheItem, time, bindGroup, vertexBuffer, triCount) {
      const cacheTexture = device.createTexture({
         size: [canvas.width, canvas.height],
         format: canvasFormat,
         usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const commandEncoder = device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
         colorAttachments: [{
            view: cacheTexture.createView(),
            clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
         }],
         depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
         },
      });
      renderPass.setPipeline(pipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.setVertexBuffer(0, vertexBuffer);
      renderPass.draw(triCount * 3);
      renderPass.end();
      device.queue.submit([commandEncoder.finish()]);

      const cacheTextureBytes = estimateCacheTextureBytes(canvas.width, canvas.height, cacheBytesPerPixel);
      putOrientationCache(cacheItem.key, cacheTexture, cacheTextureBytes);
   }

   function advanceTiltPreRender(time, bindGroup, vertexBuffer, triCount) {
      if (!tiltPreRenderRequested || tiltPreRenderReady || !renderBundle) return;
      if (tiltPreRenderIndex >= tiltPreRenderQueue.length) {
         tiltPreRenderRequested = false;
         tiltPreRenderReady = true;
         updatePrewarmOverlay();
         return;
      }
      let renderedCount = 0;
      while (renderedCount < TILT_PRERENDER_BUDGET_PER_FRAME && tiltPreRenderIndex < tiltPreRenderQueue.length) {
         const cacheItem = tiltPreRenderQueue[tiltPreRenderIndex++];
         if (orientationFrameCache.has(cacheItem.key)) continue;
         writeUniformsForOrientation(cacheItem.rotX, cacheItem.rotY, time);
         renderOrientationToCache(cacheItem, time, bindGroup, vertexBuffer, triCount);
         renderedCount++;
      }
      if (tiltPreRenderIndex >= tiltPreRenderQueue.length) {
         tiltPreRenderRequested = false;
         tiltPreRenderReady = true;
      }
      updatePrewarmOverlay();
   }

   function putOrientationCache(key, texture, bytes) {
      const existing = orientationFrameCache.get(key);
      if (existing) {
         existing.destroy();
         const prevBytes = orientationFrameCacheBytes.get(key) ?? 0;
         orientationCacheTotalBytes = Math.max(0, orientationCacheTotalBytes - prevBytes);
         orientationFrameCache.delete(key);
         orientationFrameCacheBytes.delete(key);
      }
      orientationFrameCache.set(key, texture);
      orientationFrameCacheBytes.set(key, bytes);
      orientationCacheTotalBytes += bytes;
      while (orientationFrameCache.size > ORIENTATION_CACHE_MAX_ENTRIES) {
         const oldestKey = orientationFrameCache.keys().next().value;
         const oldestTex = orientationFrameCache.get(oldestKey);
         const oldestBytes = orientationFrameCacheBytes.get(oldestKey) ?? 0;
         if (oldestTex) oldestTex.destroy();
         orientationFrameCache.delete(oldestKey);
         orientationFrameCacheBytes.delete(oldestKey);
         orientationCacheTotalBytes = Math.max(0, orientationCacheTotalBytes - oldestBytes);
      }
   }

   // -------------------------------------------------------------------------
   // loadModel — swap mesh buffers; pipeline and UI are untouched.
   // -------------------------------------------------------------------------
   async function loadModel(filename, url) {
      console.log(`Loading ${filename}...`);

      const ext = filename.toLowerCase().match(/\.\w+$/)?.[0] ?? '';
      let stone;
      switch (ext) {
         case '.gem': stone = await loadGEM(url); break;
         case '.gcs': stone = await loadGCS(url); break;
         default: stone = await loadSTL(url); break;
      }

      if (stone.refractiveIndex)
         uiControls.setRI(stone.refractiveIndex);

      normalizeMesh(stone.vertexData);

      const { nodeBuffer, triBuffer } = buildBVH(stone.vertexData, stone.triangleCount);

      const makeBuf = (data, usage) => {
         const buf = device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
         });
         new Float32Array(buf.getMappedRange()).set(data);
         buf.unmap();
         return buf;
      };

      const vertexBuffer = makeBuf(stone.vertexData, GPUBufferUsage.VERTEX);
      const triStorageBuffer = makeBuf(triBuffer, GPUBufferUsage.STORAGE);
      const bvhStorageBuffer = makeBuf(nodeBuffer, GPUBufferUsage.STORAGE);

      const bindGroup = device.createBindGroup({
         layout: pipeline.getBindGroupLayout(0),
         entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: triStorageBuffer } },
            { binding: 2, resource: { buffer: bvhStorageBuffer } },
         ],
      });

      const graphBindGroups = graphUniformBuffers.map((graphUniformBuffer) => device.createBindGroup({
         layout: graphPipeline.getBindGroupLayout(0),
         entries: [
            { binding: 0, resource: { buffer: graphUniformBuffer } },
            { binding: 1, resource: { buffer: triStorageBuffer } },
            { binding: 2, resource: { buffer: bvhStorageBuffer } },
         ],
      }));

      renderBundle = { bindGroup, graphBindGroups, vertexBuffer, triCount: stone.triangleCount };
      invalidateOrientationCache();

      // Push RI and filename into the live panel
      if (stone.refractiveIndex && stone.refractiveIndex > 1.0) {
         uiControls.setRI(stone.refractiveIndex);
      }
      if (stone.dispersion != null) {
         uiControls.setCOD(stone.dispersion);
      }

      uiControls.setFileName(filename);
      if (Array.isArray(stone.facets) && stone.facets.length > 0) {
         renderFacetInfo(stone.facets);
         setFacetStatus(`${stone.facets.length} facets parsed from ${filename}`);
      } else {
         renderFacetInfo([]);
         setFacetStatus(filename.toLowerCase().endsWith('.gem')
            ? `No named facets found in ${filename}`
            : `Facet notes are only available for .gem files`);
      }
      scheduleGraphUpdate('model load');
      requestRender();
   }

   // --- UI (built once; survives model swaps) ---
   let framePending = false;
   const ROT_EPSILON = 1e-4;

   function shouldKeepRendering() {
      const rotSettling = Math.abs(targetRotX - currentRotX) > ROT_EPSILON
         || Math.abs(targetRotY - currentRotY) > ROT_EPSILON;
      const prewarmPending = tiltPreRenderRequested && !tiltPreRenderReady;
      return animating || dragPointerId !== null || rotSettling || prewarmPending;
   }

   function requestRender() {
      if (framePending) return;
      framePending = true;
      requestAnimationFrame(frame);
   }

   uiControls = buildUI(ui, {
      onReset() {
         targetRotX = 0; targetRotY = 0;
         currentRotX = 0; currentRotY = 0;
         animating = false;
         tiltCyclePrevPhase = null;
         tiltCycleFrameCount = 0;
         tiltCycleAccumSec = 0;
         requestRender();
      },
      onTilt() {
         animating = !animating;
         if (animating) {
            animStartTime = performance.now() * 0.001;
            tiltCyclePrevPhase = null;
            tiltCycleFrameCount = 0;
            tiltCycleAccumSec = 0;
            tiltPreRenderRequested = false;
            tiltPreRenderReady = false;
            tiltPreRenderQueue = [];
            tiltPreRenderIndex = 0;
            tiltPreRenderBaseRotX = null;
            tiltPreRenderBaseRotY = null;
         } else {
            tiltCyclePrevPhase = null;
            tiltCycleFrameCount = 0;
            tiltCycleAccumSec = 0;
            tiltPreRenderRequested = false;
            tiltPreRenderReady = false;
            tiltPreRenderQueue = [];
            tiltPreRenderIndex = 0;
            tiltPreRenderBaseRotX = null;
            tiltPreRenderBaseRotY = null;
         }
         requestRender();
         return animating;
      },
      onGraphParamsChanged() {
         scheduleGraphUpdate();
         requestRender();
      },
      onRenderOutputChanged() {
         invalidateOrientationCache();
         requestRender();
      },
      onTiltAngleChanged(previousTiltDeg, nextTiltDeg) {
         if (nextTiltDeg > previousTiltDeg + 1e-6) {
            requestTiltPreRender();
         }
         requestRender();
      },
      onFileSelected(name, fileUrl) { loadModel(name, fileUrl); },
   });

   // --- Pointer (canvas rotation) ---
   // setPointerCapture ensures move/up events are delivered even when the
   // finger slides off the canvas edge. touch-action:none (CSS) prevents
   // the browser from hijacking touches for scroll/zoom.
   let dragPointerId = null, lastX = 0, lastY = 0;

   gpuCanvas.addEventListener('pointerdown', (e) => {
      if (dragPointerId !== null) return;          // ignore extra fingers
      dragPointerId = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      gpuCanvas.setPointerCapture(e.pointerId);
      requestRender();
   });

   function endDrag(e) {
      if (e.pointerId !== dragPointerId) return;
      dragPointerId = null;
      requestRender();
   }
   gpuCanvas.addEventListener('pointerup', endDrag);
   gpuCanvas.addEventListener('pointercancel', endDrag);

   gpuCanvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragPointerId) return;
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events) {
         const dx = ((ev.clientX - lastX) / 500) * Math.PI;
         const dy = ((ev.clientY - lastY) / 500) * Math.PI * 0.5;
         targetRotY = quantizeOrientationAngle(targetRotY + dx);
         targetRotX = quantizeOrientationAngle(targetRotX + dy);
         lastX = ev.clientX; lastY = ev.clientY;
      }
      requestRender();
   });

   // --- Axis indicator (created once) ---
   const axisCanvas = document.createElement('canvas');
   axisCanvas.id = 'axisCanvas';
   Object.assign(axisCanvas.style, {
      position: 'fixed', bottom: '16px', left: '16px',
      width: '120px', height: '120px',
      borderRadius: '8px', background: 'rgba(0,0,0,0)', pointerEvents: 'none',
   });
   document.body.appendChild(axisCanvas);
   const axCtx = axisCanvas.getContext('2d');
   const dpr = window.devicePixelRatio || 1;
   axisCanvas.width = 120 * dpr;
   axisCanvas.height = 120 * dpr;
   axCtx.scale(dpr, dpr);

   function drawAxes() {
      const cx = 60, cy = 60, len = 40;
      axCtx.clearRect(0, 0, 120, 120);
      const axes = [
         { label: 'X', color: '#f55', dx: modelMat[0], dy: modelMat[1] },
         { label: 'Y', color: '#5f5', dx: modelMat[4], dy: modelMat[5] },
         { label: 'Z', color: '#58f', dx: modelMat[8], dy: modelMat[9] },
      ];
      axes.sort((a, b) => a.dy - b.dy);
      axCtx.font = 'bold 11px system-ui';
      axCtx.textAlign = 'center';
      axCtx.textBaseline = 'middle';
      for (const ax of axes) {
         const ex = cx + ax.dx * len;
         const ey = cy - ax.dy * len;
         axCtx.beginPath(); axCtx.moveTo(cx, cy); axCtx.lineTo(ex, ey);
         axCtx.strokeStyle = ax.color; axCtx.lineWidth = 2; axCtx.stroke();
         axCtx.beginPath(); axCtx.arc(ex, ey, 3, 0, Math.PI * 2);
         axCtx.fillStyle = ax.color; axCtx.fill();
         axCtx.fillText(ax.label, cx + ax.dx * (len + 11), cy - ax.dy * (len + 11));
      }
      axCtx.beginPath(); axCtx.arc(cx, cy, 3, 0, Math.PI * 2);
      axCtx.fillStyle = '#fff'; axCtx.fill();
   }

   // --- FPS overlay (debug only) ---
   const fpsEl = document.getElementById('fpsOverlay');
   const FRAME_PLOT_WINDOW_SEC = 5.0;
   const FRAME_PLOT_WIDTH = 180;
   const FRAME_PLOT_HEIGHT = 48;
   let perfStatsVisible = false;
   let perfStatsTextEl = null;
   let perfStatsPlotCanvas = null;
   let perfStatsPlotCtx = null;
   const frameTimeHistory = [];

   let fpsSmoothed = 60, lastFpsUpdate = 0, lastFrameTime = performance.now() * 0.001;
   let frameCpuTotalMsSmoothed = 0;
   let frameCpuUpdateMsSmoothed = 0;
   let frameCpuDrawMsSmoothed = 0;
   let frameCpuSubmitMsSmoothed = 0;
   let cachePresentSubmitMsSmoothed = 0;
   let shaderSubmitMsSmoothed = 0;
   let graphSweepMsSmoothed = 0;
   let frameGpuMsSmoothed = 0;
   let frameGpuReadPending = false;
   let lastGpuSampleTime = 0;
   let refreshHzEstimate = 60;

   function setPerfStatsVisible(visible) {
      perfStatsVisible = visible;
      if (!fpsEl) return;
      ensurePerfOverlayElements();
      fpsEl.style.display = perfStatsVisible ? 'block' : 'none';
      if (!perfStatsVisible) {
         if (perfStatsTextEl) perfStatsTextEl.textContent = '';
         if (perfStatsPlotCtx) {
            perfStatsPlotCtx.clearRect(0, 0, FRAME_PLOT_WIDTH, FRAME_PLOT_HEIGHT);
         }
      }
      updatePrewarmOverlay();
      lastFpsUpdate = performance.now() * 0.001;
   }

   function ensurePerfOverlayElements() {
      if (!fpsEl) return;
      if (!perfStatsTextEl) {
         perfStatsTextEl = document.createElement('div');
         fpsEl.appendChild(perfStatsTextEl);
      }
      if (!perfStatsPlotCanvas) {
         perfStatsPlotCanvas = document.createElement('canvas');
         perfStatsPlotCanvas.width = FRAME_PLOT_WIDTH;
         perfStatsPlotCanvas.height = FRAME_PLOT_HEIGHT;
         perfStatsPlotCanvas.style.display = 'block';
         perfStatsPlotCanvas.style.marginTop = '6px';
         perfStatsPlotCanvas.style.width = `${FRAME_PLOT_WIDTH}px`;
         perfStatsPlotCanvas.style.height = `${FRAME_PLOT_HEIGHT}px`;
         perfStatsPlotCanvas.style.borderRadius = '3px';
         perfStatsPlotCanvas.style.background = 'rgba(255,255,255,0.04)';
         fpsEl.appendChild(perfStatsPlotCanvas);
         perfStatsPlotCtx = perfStatsPlotCanvas.getContext('2d');
      }
   }

   function pushFrameTimeSample(timeSec, deltaSec) {
      frameTimeHistory.push({ t: timeSec, ms: deltaSec * 1000.0 });
      const cutoff = timeSec - FRAME_PLOT_WINDOW_SEC;
      while (frameTimeHistory.length > 0 && frameTimeHistory[0].t < cutoff) {
         frameTimeHistory.shift();
      }
   }

   function drawFrameTimePlot(nowSec) {
      if (!perfStatsPlotCtx || !perfStatsPlotCanvas) return;

      const w = FRAME_PLOT_WIDTH;
      const h = FRAME_PLOT_HEIGHT;
      const ctx = perfStatsPlotCtx;
      ctx.clearRect(0, 0, w, h);

      if (frameTimeHistory.length < 2) return;

      let maxMs = 0;
      for (const s of frameTimeHistory) maxMs = Math.max(maxMs, s.ms);
      const yMax = Math.max(16.7, Math.min(80.0, maxMs * 1.1));

      const ms16 = 16.7;
      const ms33 = 33.3;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      if (ms16 <= yMax) {
         const y16 = h - (ms16 / yMax) * h;
         ctx.beginPath(); ctx.moveTo(0, y16); ctx.lineTo(w, y16); ctx.stroke();
      }
      if (ms33 <= yMax) {
         const y33 = h - (ms33 / yMax) * h;
         ctx.beginPath(); ctx.moveTo(0, y33); ctx.lineTo(w, y33); ctx.stroke();
      }

      const minT = nowSec - FRAME_PLOT_WINDOW_SEC;
      const pointForSample = (sample) => ({
         x: ((sample.t - minT) / FRAME_PLOT_WINDOW_SEC) * w,
         y: h - (Math.min(sample.ms, yMax) / yMax) * h,
      });

      const colorForMs = (ms) => {
         if (ms < 17) return '#59e35f';
         if (ms < 34) return '#f5c842';
         return '#ff5f5f';
      };

      ctx.lineWidth = 1.5;
      for (let i = 1; i < frameTimeHistory.length; i++) {
         const prev = pointForSample(frameTimeHistory[i - 1]);
         const currSample = frameTimeHistory[i];
         const curr = pointForSample(currSample);
         ctx.strokeStyle = colorForMs(currSample.ms);
         ctx.beginPath();
         ctx.moveTo(prev.x, prev.y);
         ctx.lineTo(curr.x, curr.y);
         ctx.stroke();
      }
   }

   if (DEBUG) {
      setPerfStatsVisible(false);
      const perfStatsToggle = document.getElementById('perfStatsToggle');
      if (perfStatsToggle instanceof HTMLInputElement) {
         perfStatsToggle.checked = false;
         perfStatsToggle.addEventListener('change', () => {
            setPerfStatsVisible(perfStatsToggle.checked);
            requestRender();
         });
      }
   }
   updatePrewarmOverlay();

   // --- Uniforms ---
   function updateUniforms(time) {
      let animX = 0, animY = 0;
      if (animating) {
         let elapsed = time - animStartTime;
         if (tiltPreRenderReady) {
            elapsed = Math.round(elapsed * TILT_PRERENDER_SAMPLE_FPS) / TILT_PRERENDER_SAMPLE_FPS;
         }
         const animSample = sampleTiltAnimation(elapsed, ui.tiltAngleDeg * Math.PI / 180.0);
         const amp = ui.tiltAngleDeg * Math.PI / 180.0;
         animX = Math.min(Math.max(animSample.x, 0), amp);
         animY = Math.min(Math.max(animSample.y, 0), amp);
      }

      currentRotX += (targetRotX - currentRotX) * 0.1;
      currentRotY += (targetRotY - currentRotY) * 0.1;

      const baseRotX = (animating && tiltPreRenderReady && tiltPreRenderBaseRotX !== null)
         ? tiltPreRenderBaseRotX
         : currentRotX;
      const baseRotY = (animating && tiltPreRenderReady && tiltPreRenderBaseRotY !== null)
         ? tiltPreRenderBaseRotY
         : currentRotY;

      effectiveRenderRotX = quantizeOrientationAngle(baseRotX + animX);
      effectiveRenderRotY = quantizeOrientationAngle(baseRotY + animY);

      mat4.identity(modelMat);
      mat4.rotateX(modelMat, modelMat, effectiveRenderRotX);
      mat4.rotateY(modelMat, modelMat, effectiveRenderRotY);

      const aspect = canvas.width / canvas.height;
      // Focal length: maintain stone size by scaling camera distance proportionally.
      // Reference: fl=50mm → d=5 units, fov=45°. For other focal lengths:
      //   d = fl/10  (same angular size because fov narrows as d grows)
      //   fov = 2·atan(SENSOR_HALF / d)  where SENSOR_HALF = d_ref·tan(fov_ref/2)
      const SENSOR_HALF = 5 * Math.tan(Math.PI / 8); // ≈ 2.071, constant across all fl
      const camDist = ui.focalLength / 10;
      cameraPos[2] = camDist;
      mat4.lookAt(viewMat, [0, 0, camDist], [0, 0, 0], [0, 1, 0]);
      const fovY = 2 * Math.atan(SENSOR_HALF / camDist);
      mat4.perspective(projMat, fovY, aspect, 0.1, 200.0);

      packUniformData(
         uniformScratch,
         modelMat,
         projMat,
         time,
         ui.lightMode,
         0.0,
         ui.lightMode === 4 ? 1.0 : 0.0,
      );
      device.queue.writeBuffer(uniformBuffer, 0, uniformScratch);
   }

   // --- Render loop ---
   function frame() {
      framePending = false;
      const frameStartMs = performance.now();
      const time = performance.now() * 0.001;

      const dt = time - lastFrameTime;
      lastFrameTime = time;
      pushFrameTimeSample(time, dt);
      const instantFps = dt > 0 ? (1 / dt) : refreshHzEstimate;
      const clampedFps = Math.min(240, Math.max(10, instantFps));
      fpsSmoothed = fpsSmoothed * 0.9 + clampedFps * 0.1;
      refreshHzEstimate = Math.max(clampedFps, refreshHzEstimate * 0.995);

      if (animating) {
         const elapsed = time - animStartTime;
         const phase = ((elapsed % TILT_ANIM_CYCLE_SEC) + TILT_ANIM_CYCLE_SEC) % TILT_ANIM_CYCLE_SEC;
         if (tiltCyclePrevPhase !== null && phase < tiltCyclePrevPhase) {
            if (tiltCycleAccumSec > 0) {
               tiltCycleAvgFps = tiltCycleFrameCount / tiltCycleAccumSec;
               if (tiltCycleAvgFps < TILT_PRERENDER_FPS_THRESHOLD && !tiltPreRenderRequested && !tiltPreRenderReady) {
                  requestTiltPreRender();
               }
            }
            tiltCycleFrameCount = 0;
            tiltCycleAccumSec = 0;
         }
         tiltCyclePrevPhase = phase;
         tiltCycleFrameCount += 1;
         tiltCycleAccumSec += Math.max(dt, 0);
      } else {
         tiltCyclePrevPhase = null;
      }

      const useTiltCache = animating && tiltPreRenderReady;

      if (perfStatsVisible && fpsEl) {
         // smoothed FPS is computed every frame for cache gating.
      }

      const updateStartMs = performance.now();
      updateUniforms(time);
      const updateEndMs = performance.now();

      const drawStartMs = performance.now();
      drawAxes();
      const drawEndMs = performance.now();

      if (renderBundle) {
         const { bindGroup, vertexBuffer, triCount } = renderBundle;
         const canvasTexture = context.getCurrentTexture();
         const cacheKey = useTiltCache ? orientationCacheKey(effectiveRenderRotX, effectiveRenderRotY) : null;
         const cachedTexture = cacheKey ? orientationFrameCache.get(cacheKey) : null;

         if (cachedTexture) {
            const copyEncoder = device.createCommandEncoder();
            copyEncoder.copyTextureToTexture(
               { texture: cachedTexture },
               { texture: canvasTexture },
               [canvas.width, canvas.height, 1],
            );
            const submitStartMs = performance.now();
            device.queue.submit([copyEncoder.finish()]);
            const submitEndMs = performance.now();
            const submitMs = submitEndMs - submitStartMs;
            frameCpuSubmitMsSmoothed = frameCpuSubmitMsSmoothed * 0.8 + submitMs * 0.2;
            cachePresentSubmitMsSmoothed = cachePresentSubmitMsSmoothed * 0.8 + submitMs * 0.2;
         } else {
            const commandEncoder = device.createCommandEncoder();
            const useGpuTimestampSample = perfStatsVisible && hasGpuTimestamps
               && !frameGpuReadPending
               && (time - lastGpuSampleTime) >= 0.25;
            const renderPassDescriptor = {
               colorAttachments: [{
                  view: canvasTexture.createView(),
                  clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
                  loadOp: 'clear',
                  storeOp: 'store',
               }],
               depthStencilAttachment: {
                  view: depthTexture.createView(),
                  depthClearValue: 1.0,
                  depthLoadOp: 'clear',
                  depthStoreOp: 'store',
               },
            };
            if (useGpuTimestampSample && frameTimestampQuerySet) {
               renderPassDescriptor.timestampWrites = {
                  querySet: frameTimestampQuerySet,
                  beginningOfPassWriteIndex: 0,
                  endOfPassWriteIndex: 1,
               };
            }
            const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
            renderPass.setPipeline(pipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.setVertexBuffer(0, vertexBuffer);
            renderPass.draw(triCount * 3);
            renderPass.end();

            if (cacheKey) {
               const cacheTexture = device.createTexture({
                  size: [canvas.width, canvas.height],
                  format: canvasFormat,
                  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
               });
               const cacheTextureBytes = estimateCacheTextureBytes(canvas.width, canvas.height, cacheBytesPerPixel);
               commandEncoder.copyTextureToTexture(
                  { texture: canvasTexture },
                  { texture: cacheTexture },
                  [canvas.width, canvas.height, 1],
               );
               putOrientationCache(cacheKey, cacheTexture, cacheTextureBytes);
            }

            if (useGpuTimestampSample && frameTimestampQuerySet && frameTimestampResolveBuffer && frameTimestampReadbackBuffer) {
               commandEncoder.resolveQuerySet(frameTimestampQuerySet, 0, 2, frameTimestampResolveBuffer, 0);
               commandEncoder.copyBufferToBuffer(frameTimestampResolveBuffer, 0, frameTimestampReadbackBuffer, 0, 16);
            }

            const submitStartMs = performance.now();
            device.queue.submit([commandEncoder.finish()]);
            const submitEndMs = performance.now();
            const submitMs = submitEndMs - submitStartMs;
            frameCpuSubmitMsSmoothed = frameCpuSubmitMsSmoothed * 0.8 + submitMs * 0.2;
            shaderSubmitMsSmoothed = shaderSubmitMsSmoothed * 0.8 + submitMs * 0.2;

            if (useGpuTimestampSample && frameTimestampReadbackBuffer) {
               frameGpuReadPending = true;
               lastGpuSampleTime = time;
               frameTimestampReadbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
                  const data = new BigUint64Array(frameTimestampReadbackBuffer.getMappedRange());
                  const deltaTicks = Number(data[1] - data[0]);
                  frameTimestampReadbackBuffer.unmap();
                  const gpuMs = (deltaTicks * queueTimestampPeriod) / 1e6;
                  frameGpuMsSmoothed = frameGpuMsSmoothed * 0.8 + gpuMs * 0.2;
                  frameGpuReadPending = false;
               }).catch(() => {
                  frameGpuReadPending = false;
               });
            }
         }

         advanceTiltPreRender(time, bindGroup, vertexBuffer, triCount);

         packUniformData(
            uniformScratch,
            modelMat,
            projMat,
            time,
            ui.lightMode,
            0.0,
            ui.lightMode === 4 ? 1.0 : 0.0,
         );
         device.queue.writeBuffer(uniformBuffer, 0, uniformScratch);
      }

      if (perfStatsVisible) {
         frameCpuUpdateMsSmoothed = frameCpuUpdateMsSmoothed * 0.8 + (updateEndMs - updateStartMs) * 0.2;
         frameCpuDrawMsSmoothed = frameCpuDrawMsSmoothed * 0.8 + (drawEndMs - drawStartMs) * 0.2;
         frameCpuTotalMsSmoothed = frameCpuTotalMsSmoothed * 0.8 + (performance.now() - frameStartMs) * 0.2;
      }

      if (perfStatsVisible && fpsEl && (time - lastFpsUpdate > 0.2)) {
         const gpuLabel = hasGpuTimestamps
            ? `${frameGpuMsSmoothed.toFixed(2)} ms`
            : 'n/a';
         const cacheFill = (orientationFrameCache.size / ORIENTATION_CACHE_MAX_ENTRIES) * 100;
         const cacheMiB = orientationCacheTotalBytes / (1024 * 1024);
         ensurePerfOverlayElements();
         perfStatsTextEl.innerHTML = [
            `FPS: ${Math.round(fpsSmoothed)}`,
            `Refresh est: ${Math.round(refreshHzEstimate)}`,
            `CPU total: ${frameCpuTotalMsSmoothed.toFixed(2)} ms`,
            `CPU update: ${frameCpuUpdateMsSmoothed.toFixed(2)} ms`,
            `CPU axes: ${frameCpuDrawMsSmoothed.toFixed(2)} ms`,
            `CPU submit: ${frameCpuSubmitMsSmoothed.toFixed(2)} ms`,
            `Cache present: ${cachePresentSubmitMsSmoothed.toFixed(2)} ms`,
            `Shader submit: ${shaderSubmitMsSmoothed.toFixed(2)} ms`,
            `GPU render: ${gpuLabel}`,
            `Graph sweep: ${graphSweepMsSmoothed.toFixed(1)} ms`,
            `Cache fill: ${orientationFrameCache.size}/${ORIENTATION_CACHE_MAX_ENTRIES} (${cacheFill.toFixed(1)}%)`,
            `Cache memory (raw est.): ${cacheMiB.toFixed(1)} MiB`,
            `Tilt cycle avg: ${tiltCycleAvgFps.toFixed(1)} FPS`,
            `Tilt prewarm: ${tiltPreRenderReady ? 'ready' : (tiltPreRenderRequested ? `${tiltPreRenderIndex}/${tiltPreRenderQueue.length}` : 'idle')}`,
         ].join('<br>');
         drawFrameTimePlot(time);
         lastFpsUpdate = time;
      }

      if (shouldKeepRendering()) {
         requestRender();
      }
   }

   // --- Resize ---
   function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const cssWidth = Math.max(1, canvas.clientWidth || window.innerWidth);
      const cssHeight = Math.max(1, canvas.clientHeight || window.innerHeight);
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));

      if (canvas.width === nextWidth && canvas.height === nextHeight) {
         return;
      }

      canvas.width = nextWidth;
      canvas.height = nextHeight;
      invalidateOrientationCache();
      depthTexture = device.createTexture({
         size: [canvas.width, canvas.height],
         format: 'depth24plus',
         usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      requestRender();
   }
   window.addEventListener('resize', resize);
   resize();
   requestRender();

   return { loadModel };
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
const app = await setupApp();
if (app) app.loadModel('stone.gem', 'stone.gem');
