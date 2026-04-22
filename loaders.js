"use strict";

const TABLE_FACET_MAX_ANGLE_DEG = 1.5;
const EPS = 1e-9;
const VERTEX_EPS = 1e-6;

class StoneData {
   constructor(vertexData, triangleCount, facets = [], refractiveIndex = null, dispersion = null, sourceGear) {
      this.vertexData = vertexData;
      this.triangleCount = triangleCount;
      this.facets = facets;
      this.refractiveIndex = refractiveIndex;
      this.dispersion = dispersion;
      this.sourceGear = sourceGear;
      console.debug('StoneData created:', this);
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
// Y axis uses the same coordinate convention as the renderer (Z = table = up).
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

   const sourceGear = parseInt(doc.querySelector('index')?.getAttribute('gear'), 10);

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
         const planeDistanceSamples = verts.map(([x, y, z]) => x * normal[0] + y * normal[1] + z * normal[2]);
         const finitePlaneDistanceSamples = planeDistanceSamples.filter((value) => Number.isFinite(value));
         const meanPlaneDistance = finitePlaneDistanceSamples.length
            ? (finitePlaneDistanceSamples.reduce((sum, value) => sum + value, 0) / finitePlaneDistanceSamples.length)
            : null;
         const facetDistance = Number.isFinite(meanPlaneDistance) ? Math.abs(meanPlaneDistance) : null;

         const normalized = normalizeFacetMetadata(tierName, tierInst);

         const triangleCount = verts.length - 2;
         facets.push({
            name: normalized.name,
            instructions: normalized.instructions,
            frosted: normalized.frosted,
            normal,
            d: facetDistance,
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

   return new StoneData(vertexData, triCount, facets, refractiveIndex, dispersion, sourceGear);
}

function convertGCSTextToGEMBuffer(gcsText) {
   const parser = new DOMParser();
   const doc = parser.parseFromString(String(gcsText || ''), 'application/xml');
   if (doc.querySelector('parsererror')) {
      throw new Error('GCS: XML parse error');
   }

   class BinaryWriter {
      constructor(initialSize = 1024) {
         this.buffer = new ArrayBuffer(initialSize);
         this.view = new DataView(this.buffer);
         this.offset = 0;
      }

      ensure(size) {
         if (this.offset + size <= this.buffer.byteLength) return;
         let nextSize = this.buffer.byteLength;
         while (this.offset + size > nextSize) nextSize *= 2;
         const nextBuffer = new ArrayBuffer(nextSize);
         new Uint8Array(nextBuffer).set(new Uint8Array(this.buffer));
         this.buffer = nextBuffer;
         this.view = new DataView(this.buffer);
      }

      writeFloat64(v) {
         this.ensure(8);
         this.view.setFloat64(this.offset, v, true);
         this.offset += 8;
      }

      writeInt32(v) {
         this.ensure(4);
         this.view.setInt32(this.offset, v, true);
         this.offset += 4;
      }

      writeUint8(v) {
         this.ensure(1);
         this.view.setUint8(this.offset, v);
         this.offset += 1;
      }

      writeBytes(bytes) {
         this.ensure(bytes.length);
         new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes);
         this.offset += bytes.length;
      }

      finish() {
         return this.buffer.slice(0, this.offset);
      }
   }

   const writer = new BinaryWriter();
   const encoder = new TextEncoder();
   const SILLY = -99999.0;

   const indexEl = doc.querySelector('index');
   const symmetry = parseInt(indexEl?.getAttribute('symmetry') || '0', 10) || 0;
   const mirror = parseInt(indexEl?.getAttribute('mirror') || '0', 10) || 0;
   const gear = parseInt(indexEl?.getAttribute('gear') || '0', 10) || 0;

   let refractiveIndex = 1.76;
   const renderEl = doc.querySelector('render');
   if (renderEl) {
      const ri = parseFloat(renderEl.getAttribute('refractive_index'));
      if (isFinite(ri)) refractiveIndex = ri;
   }

   for (const tierEl of doc.querySelectorAll('tier')) {
      const tierName = (tierEl.getAttribute('name') || '').trim();
      const tierInst = (tierEl.getAttribute('instructions') || '').trim();
      const normalizedTier = normalizeFacetMetadata(tierName, tierInst);

      for (const facetEl of tierEl.querySelectorAll('facet')) {
         const vertEls = Array.from(facetEl.querySelectorAll('vertex'));
         if (vertEls.length < 3) continue;

         const verts = vertEls.map((v) => [
            parseFloat(v.getAttribute('x') || '0'),
            parseFloat(v.getAttribute('y') || '0'),
            parseFloat(v.getAttribute('z') || '0'),
         ]);

         let nx = parseFloat(facetEl.getAttribute('nx') || '0');
         let ny = parseFloat(facetEl.getAttribute('ny') || '0');
         let nz = parseFloat(facetEl.getAttribute('nz') || '0');
         const nLen = Math.hypot(nx, ny, nz);
         if (!isFinite(nLen) || nLen < EPS) continue;
         nx /= nLen;
         ny /= nLen;
         nz /= nLen;

         let cx = 0;
         let cy = 0;
         let cz = 0;
         for (const [x, y, z] of verts) {
            cx += x;
            cy += y;
            cz += z;
         }
         cx /= verts.length;
         cy /= verts.length;
         cz /= verts.length;

         let d0 = nx * cx + ny * cy + nz * cz;
         if (d0 < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
            d0 = -d0;
         }
         if (!isFinite(d0) || d0 < EPS) continue;

         const rawLen = 0.9 / d0;
         const aRaw = nx * rawLen;
         const bRaw = ny * rawLen;
         const cRaw = nz * rawLen;

         writer.writeFloat64(aRaw);
         // Flip Y component of the normal to match Y-flipped vertices
         writer.writeFloat64(-bRaw);
         writer.writeFloat64(cRaw);
         writer.writeInt32(0);

         const labelParts = [];
         if (normalizedTier.name) labelParts.push(normalizedTier.name);
         let label = labelParts.join('');
         if (normalizedTier.instructions) label = `${label}\t${normalizedTier.instructions}`;
         const labelBytes = encoder.encode(label);
         const safeLabelBytes = labelBytes.length > 255 ? labelBytes.slice(0, 255) : labelBytes;
         writer.writeUint8(safeLabelBytes.length);
         writer.writeBytes(safeLabelBytes);
         // console.log(`${label},${aRaw.toFixed(6)},${bRaw.toFixed(6)},${cRaw.toFixed(6)},${d0.toFixed(6)}`);

         for (const [x, y, z] of verts) {
            writer.writeInt32(1);
            writer.writeFloat64(x);
            // Flip Y axis when writing vertices
            writer.writeFloat64(-y);
            writer.writeFloat64(z);
         }
         writer.writeInt32(0);
      }
   }

   writer.writeFloat64(SILLY);
   writer.writeInt32(symmetry);
   writer.writeInt32(mirror);
   writer.writeInt32(gear);
   writer.writeFloat64(refractiveIndex);

   return writer.finish();
}

function mirrorIndex(index, gear) {
   const idx = wrapGearIndex(index, gear);
   if (idx === gear) return gear;
   return wrapGearIndex(gear - idx, gear);
}


function intersect3Planes(p0, p1, p2) {
   const { a: a0, b: b0, c: c0, d: d0 } = p0;
   const { a: a1, b: b1, c: c1, d: d1 } = p1;
   const { a: a2, b: b2, c: c2, d: d2 } = p2;

   const det = a0 * (b1 * c2 - b2 * c1) - b0 * (a1 * c2 - a2 * c1) + c0 * (a1 * b2 - a2 * b1);
   if (Math.abs(det) < EPS) return null;

   const x = (d0 * (b1 * c2 - b2 * c1) - b0 * (d1 * c2 - d2 * c1) + c0 * (d1 * b2 - d2 * b1)) / det;
   const y = (a0 * (d1 * c2 - d2 * c1) - d0 * (a1 * c2 - a2 * c1) + c0 * (a1 * d2 - a2 * d1)) / det;
   const z = (a0 * (b1 * d2 - b2 * d1) - b0 * (a1 * d2 - a2 * d1) + d0 * (a1 * b2 - a2 * b1)) / det;
   return [x, y, z];
}

function insideAllPlanes(pt, planes) {
   const [x, y, z] = pt;
   for (const p of planes) {
      if (p.a * x + p.b * y + p.c * z > p.d + EPS) return false;
   }
   return true;
}

function orderFacetVerts(planeIdx, vindices, planes, allVerts) {
   if (vindices.length < 3) return vindices;
   const p = planes[planeIdx];
   const normal = [p.a, p.b, p.c];

   let cx = 0, cy = 0, cz = 0;
   for (const vi of vindices) {
      cx += allVerts[vi][0];
      cy += allVerts[vi][1];
      cz += allVerts[vi][2];
   }
   cx /= vindices.length;
   cy /= vindices.length;
   cz /= vindices.length;

   let t0 = [1, 0, 0];
   if (Math.abs(normal[0]) > 0.9) t0 = [0, 1, 0];
   const t1 = [
      normal[1] * t0[2] - normal[2] * t0[1],
      normal[2] * t0[0] - normal[0] * t0[2],
      normal[0] * t0[1] - normal[1] * t0[0],
   ];
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

function buildStoneFromHalfSpacePlanes(planes, refractiveIndex = null, sourceGear) {

   const allVerts = [];
   function addVertex(pt) {
      for (let i = 0; i < allVerts.length; i++) {
         const v = allVerts[i];
         if (Math.abs(v[0] - pt[0]) + Math.abs(v[1] - pt[1]) + Math.abs(v[2] - pt[2]) < VERTEX_EPS)
            return i;
      }
      allVerts.push(pt);
      return allVerts.length - 1;
   }

   const n = planes.length;
   const facetVerts = planes.map(() => []);

   for (let i = 0; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
         for (let k = j + 1; k < n; k++) {
            const pt = intersect3Planes(planes[i], planes[j], planes[k]);
            if (!pt || !insideAllPlanes(pt, planes)) continue;
            const vi = addVertex(pt);
            for (const pi of [i, j, k]) {
               if (!facetVerts[pi].includes(vi)) facetVerts[pi].push(vi);
            }
         }
      }
   }

   const triangles = [];
   const facets = [];

   for (let pi = 0; pi < n; pi++) {
      const verts = orderFacetVerts(pi, facetVerts[pi], planes, allVerts);
      if (verts.length < 3) continue;

      const p = planes[pi];
      const triangleCount = verts.length - 2;
      facets.push({
         index: pi + 1,
         name: p.name || '',
         instructions: p.instructions || '',
         frosted: Boolean(p.frosted),
         normal: [p.a, p.b, p.c],
         d: p.d,
         vertexCount: verts.length,
         triangleCount,
      });

      for (let i = 1; i < verts.length - 1; i++) {
         triangles.push({
            v0: allVerts[verts[0]],
            v1: allVerts[verts[i]],
            v2: allVerts[verts[i + 1]],
            normal: [p.a, p.b, p.c],
            frosted: Boolean(p.frosted),
         });
      }
   }

   const triCount = triangles.length;
   const floatsPerVertex = 7;
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

   return new StoneData(vertexData, triCount, facets, refractiveIndex, null, sourceGear);
}

function stretchStoneByVertices(stone, scaleFactor, crown = true) {
   const s = Number(scaleFactor) || 1;
   if (!stone || !stone.vertexData || !Array.isArray(stone.facets) || s === 1) return stone;

   const floatsPerVertex = 7;
   const vertsPerTri = 3;
   const vertexData = stone.vertexData;
   const facets = stone.facets;

   // Build per-facet vertex lists by walking triangles in order
   const facetVertexLists = [];
   let triOffset = 0;
   for (let fi = 0; fi < facets.length; fi++) {
      const triCountForFacet = Math.max(0, Math.round(facets[fi].triangleCount || 0));
      const pts = [];
      for (let t = 0; t < triCountForFacet; t++) {
         const triIdx = triOffset + t;
         const base = triIdx * vertsPerTri * floatsPerVertex;
         for (let v = 0; v < vertsPerTri; v++) {
            const idx = base + v * floatsPerVertex;
            const x = vertexData[idx + 0];
            const y = vertexData[idx + 1];
            const z = vertexData[idx + 2];
            pts.push([x, y, z]);
         }
      }
      triOffset += triCountForFacet;
      // deduplicate
      const uniq = [];
      const seen = new Set();
      for (const p of pts) {
         const key = `${p[0].toFixed(6)}:${p[1].toFixed(6)}:${p[2].toFixed(6)}`;
         if (!seen.has(key)) {
            seen.add(key);
            uniq.push(p);
         }
      }
      facetVertexLists.push(uniq);
   }

   // compute girdle top/bottom from girdle facets (if present)
   let girdleTop = null;
   let girdleBottom = null;
   for (let i = 0; i < facets.length; i++) {
      const f = facets[i];
      if (!isGirdleFacet(f)) continue;
      for (const p of facetVertexLists[i]) {
         girdleTop = girdleTop === null ? p[2] : Math.max(girdleTop, p[2]);
         girdleBottom = girdleBottom === null ? p[2] : Math.min(girdleBottom, p[2]);
      }
   }

   // classify facets and compute z0. For crown use girdleTop, for pavilion use girdleBottom.
   let z0 = null;
   const ANG_EPS = 1e-4;
   if (crown) {
      if (girdleTop !== null) z0 = girdleTop;
      else {
         // fallback: lowest point among positive-angle facets (exclude girdle)
         for (let i = 0; i < facets.length; i++) {
            const f = facets[i];
            const angle = computeSignedFacetAngleDeg(f.normal);
            if (angle > ANG_EPS) {
               for (const p of facetVertexLists[i]) z0 = z0 === null ? p[2] : Math.min(z0, p[2]);
            }
         }
      }
   } else {
      if (girdleBottom !== null) z0 = girdleBottom;
      else {
         for (let i = 0; i < facets.length; i++) {
            const f = facets[i];
            const angle = computeSignedFacetAngleDeg(f.normal);
            if (angle < -ANG_EPS) {
               for (const p of facetVertexLists[i]) z0 = z0 === null ? p[2] : Math.max(z0, p[2]);
            }
         }
      }
   }
   if (z0 === null) return stone;

   // apply scaling to vertices in targeted facets
   const newFacetVerts = facetVertexLists.map((list, i) => list.map(p => p.slice()));
   for (let i = 0; i < facets.length; i++) {
      const f = facets[i];
      const angle = computeSignedFacetAngleDeg(f.normal);
      const isG = isGirdleFacet(f);
      // include table in crown scaling (table ~ angle ~= 0 with normal.z > 0)
      const isTable = Math.abs(angle) <= ANG_EPS && ((f.normal?.[2] ?? 1) > 0);
      const isTarget = !isG && (crown ? (angle > ANG_EPS || isTable) : (angle < -ANG_EPS));
      if (!isTarget) continue;
      for (const p of newFacetVerts[i]) {
         p[2] = z0 + s * (p[2] - z0);
      }
   }

   // helper to compute plane from polygon vertices
   const planes = [];
   for (let i = 0; i < facets.length; i++) {
      const pts = newFacetVerts[i];
      if (!pts || pts.length < 3) continue;
      const orig = facets[i].normal || [0, 0, 1];
      const isG = isGirdleFacet(facets[i]);
      const angle = computeSignedFacetAngleDeg(orig);
      const isTable = Math.abs(angle) <= ANG_EPS && (orig[2] ?? 1) > 0;
      const isTarget = !isG && (crown ? (angle > ANG_EPS || isTable) : (angle < -ANG_EPS));
      const effectiveS = isTarget ? s : 1;
      let normal;
      if (isG) {
         const lenXY = Math.hypot(orig[0], orig[1]);
         if (lenXY > 1e-8) {
            normal = [orig[0] / lenXY, orig[1] / lenXY, 0];
         } else {
            // fallback: derive XY direction from polygon centroid
            let cx = 0, cy = 0;
            for (const q of pts) { cx += q[0]; cy += q[1]; }
            cx /= pts.length; cy /= pts.length;
            const v0x = pts[0][0] - cx; const v0y = pts[0][1] - cy;
            const vlen = Math.hypot(v0x, v0y);
            if (vlen > 1e-8) {
               normal = [v0x / vlen, v0y / vlen, 0];
            } else {
               // ultimate fallback: align with +X
               normal = [1, 0, 0];
            }
         }
         // ensure same hemisphere as original facet normal
         const dot = orig[0] * normal[0] + orig[1] * normal[1];
         if (dot < 0) normal = [-normal[0], -normal[1], -normal[2]];
      } else {
         const nx = orig[0];
         const ny = orig[1];
         const nz = orig[2] / effectiveS;
         const nlen = Math.hypot(nx, ny, nz);
         normal = nlen > EPS ? [nx / nlen, ny / nlen, nz / nlen] : orig.slice();
      }

      // compute d using first vertex
      const p = pts[0];
      const d = normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2];
      planes.push({
         a: normal[0],
         b: normal[1],
         c: normal[2],
         d,
         name: facets[i].name || '',
         instructions: facets[i].instructions || '',
         frosted: facets[i].frosted
      });
   }

   if (!planes.length) return stone;

   // Ensure plane normals point inward/define correct half-spaces by testing
   // against centroid of all scaled vertices. Flip normals/d when centroid
   // does not satisfy plane inequality.
   const allPts = [];
   for (const list of newFacetVerts) for (const p of list) allPts.push(p);
   let cx = 0, cy = 0, cz = 0;
   if (allPts.length) {
      for (const p of allPts) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= allPts.length; cy /= allPts.length; cz /= allPts.length;
   }
   let flipCount = 0;
   for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      // normalize
      const nlen = Math.hypot(p.a, p.b, p.c) || 1;
      p.a /= nlen; p.b /= nlen; p.c /= nlen; p.d /= nlen;
      const val = p.a * cx + p.b * cy + p.c * cz;
      if (val > p.d + EPS) {
         p.a = -p.a; p.b = -p.b; p.c = -p.c; p.d = -p.d; flipCount++;
      }
   }
   if (flipCount) console.debug('stretchStoneByVertices: flipped', flipCount, 'planes to match centroid');

   try {
      const result = buildStoneFromHalfSpacePlanes(planes, stone.refractiveIndex, stone.sourceGear);
      if (!result || !(result.vertexData instanceof Float32Array) || result.triangleCount === 0) {
         console.warn('stretchStoneByVertices: rebuild produced empty mesh; aborting.', 'z0=', z0, 'scale=', s, 'planes=', planes.length);
         return stone;
      }
      return result;
   } catch (err) {
      console.warn('stretchStoneByVertices: rebuild threw, aborting.', err);
      return stone;
   }
}

const polarPlane = (angle, index, gear, gearOff = 0) => {
   const incl = angle * Math.PI / 180;
   const azi = (index - gearOff) * 2 * Math.PI / gear;
   let c = Math.cos(incl);
   let s = Math.sin(incl);
   if (angle < 0) {
      c *= -1;
      s *= -1;
   }
   const a = s * Math.sin(azi);
   const b = -s * Math.cos(azi);
   return [a, b, c];
};

async function loadASC(url) {
   const response = await fetch(url);
   const text = await response.text();

   // Pre-process: join continuation lines (lines that start with whitespace)
   // back onto the previous non-empty line. This handles the pc01006 pattern
   // where " G First" appears on its own line after an `a` line.
   const rawLines = text.split(/\r?\n/);
   const lines = [];
   for (const raw of rawLines) {
      // A continuation line starts with whitespace and is not blank
      if (raw.length > 0 && /^\s/.test(raw) && lines.length > 0) {
         lines[lines.length - 1] += ' ' + raw.trim();
      } else {
         lines.push(raw);
      }
   }

   let igear = 96;
   let gearOff = 0;
   let refractiveIndex = 1.54;

   const planes = [];
   let sawHeader = false;

   for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) continue;
      if (line.startsWith(';') || line.startsWith('#') || line.startsWith('//')) continue;

      const parts = line.split(/\s+/);
      if (!parts.length || !parts[0]) continue;

      // ── Header ──────────────────────────────────────────────────────────────
      if (!sawHeader) {
         if (parts[0] !== 'GemCad') throw new Error('ASC: missing GemCad header');
         sawHeader = true;
         continue;
      }

      const ch = parts[0];

      // ── g  gear <count> <offset> ────────────────────────────────────────────
      // Gear count may be negative (e.g. "g -64 32.0"); use Math.abs for igear.
      if (ch === 'g') {
         const raw = parseInt(parts[1], 10);
         if (isFinite(raw) && raw !== 0) igear = Math.abs(raw);
         const nextOff = parseFloat(parts[2]);
         if (isFinite(nextOff)) gearOff = nextOff;
         continue;
      }

      // ── I  refractive index ─────────────────────────────────────────────────
      if (ch === 'I') {
         const ri = parseFloat(parts[1]);
         if (isFinite(ri) && ri > 1.0) refractiveIndex = ri;
         continue;
      }

      // ── H / F / y  — title / footnote / symmetry — skip ────────────────────
      if (ch === 'H' || ch === 'F' || ch === 'y') continue;

      // ── a  facet line ────────────────────────────────────────────────────────
      if (ch !== 'a') continue;

      const angle = parseFloat(parts[1]);
      const rho = parseFloat(parts[2]);
      if (!isFinite(angle) || !isFinite(rho)) continue;

      // Scan tokens from index 3 onwards, collecting:
      //   - numeric index tokens (before, between, or after name segments)
      //   - name (last `n <token>` pair wins, matching GemCad behaviour)
      //   - instructions (everything after the first `G` token)
      const gearIndices = [];  // all numeric gear index tokens
      let currentName = '';
      let instructions = '';
      let awaitingName = false;

      for (let i = 3; i < parts.length; i++) {
         const tok = parts[i];

         // `G` ends index/name scanning; everything after is the instruction text
         if (tok === 'G') {
            instructions = parts.slice(i + 1).join(' ');
            break;
         }

         // `n` signals that the very next token is a facet name
         if (tok === 'n') {
            awaitingName = true;
            continue;
         }

         if (awaitingName) {
            currentName = tok;
            awaitingName = false;
            continue;
         }

         // Numeric token — gear index (may be negative, e.g. -64)
         const idx = parseFloat(tok);
         if (isFinite(idx)) {
            gearIndices.push(idx);
         }
      }

      // Emit one half-space plane per gear index.
      // If there are no gear indices at all (e.g. `a 0.000000 0.201 96 n T`)
      // the single index is already consumed as part of rho — GemCad convention
      // is that `a <angle> <rho> <singleIndex> n <name>` with no further indices
      // still produces one plane.  Handle that by rechecking parts[3] when the
      // index list is empty after the scan.
      let indicesToProcess = gearIndices;
      if (indicesToProcess.length === 0) {
         // parts[3] might be the sole index that was skipped because we started
         // scanning at 3 but immediately hit 'n'.  Re-check explicitly.
         const sole = parseFloat(parts[3]);
         if (isFinite(sole) && parts[3] !== 'n' && parts[3] !== 'G') {
            indicesToProcess = [sole];
         } else {
            // e.g. `a 0.000000 0.418 64 n D` — index is parts[3], name skipped it
            // already handled above; just skip this plane.
            continue;
         }
      }

      for (const rawIdx of indicesToProcess) {
         // Negative indices are a GemCad notation for "offset by gearOff";
         // the physical position is the absolute value.
         const index = Math.abs(rawIdx);

         let normal;
         let d;

         if (angle === 0) {
            // Flat table / culet
            normal = rho >= 0 ? [0, 0, 1] : [0, 0, -1];
            d = Math.abs(rho);
         } else {
            normal = polarPlane(Math.abs(angle), index, igear);
            d = Math.abs(rho);
            // Negative angle → pavilion (below girdle) → flip Z
            if (angle < 0) normal[2] = -normal[2];
         }

         const len = Math.hypot(normal[0], normal[1], normal[2]);
         if (!isFinite(len) || len < 1e-9 || !isFinite(d) || Math.abs(d) <= 1e-12) continue;

         const normalizedFacet = normalizeFacetMetadata(currentName, instructions);
         planes.push({
            a: normal[0] / len,
            b: normal[1] / len,
            c: normal[2] / len,
            d,
            name: normalizedFacet.name,
            instructions: normalizedFacet.instructions,
            frosted: normalizedFacet.frosted,
         });
      }
   }

   if (!sawHeader) throw new Error('ASC: missing GemCad header');
   if (!planes.length) throw new Error('ASC: no facets found');

   return buildStoneFromHalfSpacePlanes(planes, refractiveIndex, igear);
}

function computeNormalFromPolar(angleDeg, index, gear, gearOffset = 0) {
   if (Math.abs(angleDeg) <= 1e-8) {
      return [0, 0, angleDeg >= 0 ? 1 : -1];
   }
   const incl = angleDeg * Math.PI / 180;
   const azi = (index - gearOffset) * 2 * Math.PI / gear;
   let c = Math.cos(incl);
   let s = Math.sin(incl);
   if (angleDeg < 0) {
      c *= -1;
      s *= -1;
   }
   const a = s * Math.sin(azi);
   const b = -s * Math.cos(azi);
   return [a, b, c];
};

function buildStoneFromFacetDesign(definition = {}) {
   const facets = Array.isArray(definition.facets) ? definition.facets : [];
   const ri = parseFloat(definition.refractiveIndex);
   const refractiveIndex = Number.isFinite(ri) && ri > 1.0 ? ri : 1.54;
   const gear = definition.gear;

   const planes = [];

   facets.forEach((facet, idx) => {
      const facetName = String(facet?.name || `F${idx + 1}`).trim();
      const instructions = String(facet?.instructions || '').trim();
      const normalized = normalizeFacetMetadata(facetName, instructions);


      const symmetryValue = parseInt(facet?.symmetry, 10);
      const symmetry = Math.max(1, Number.isFinite(symmetryValue) ? symmetryValue : 1);

      const angle = parseFloat(facet?.angleDeg);
      const angleDeg = Number.isFinite(angle) ? Math.max(-90.0, Math.min(90.0, angle)) : 0;

      const startRaw = parseFloat(facet?.startIndex);
      const startIndex = Number.isFinite(startRaw) ? wrapGearIndex(startRaw, gear) : 1;

      const distanceRaw = parseFloat(facet?.distance);
      const d = Number.isFinite(distanceRaw) ? Math.max(1e-5, Math.abs(distanceRaw)) : 1.0;

      const mirror = Boolean(facet?.mirror);
      const step = gear / symmetry;
      const indexSet = new Set();

      const explicitIndexes = Array.isArray(facet?.indexes)
         ? [...new Set(
            facet.indexes
               .map((value) => parseInt(value, 10))
               .filter((value) => Number.isFinite(value) && value >= 0)
               .map((value) => (value === 0 ? gear : value))
               .map((value) => wrapGearIndex(value, gear)),
         )]
         : [];

      if (explicitIndexes.length > 0) {
         explicitIndexes.forEach((value) => indexSet.add(value));
      } else {
         for (let i = 0; i < symmetry; i++) {
            const offset = i * step;
            const primary = wrapGearIndex(startIndex + offset, gear);
            indexSet.add(primary);
            if (mirror) {
               indexSet.add(mirrorIndex(primary, gear));
            }
         }
      }

      if (Math.abs(angleDeg) <= 1e-8) {
         const normal = [0, 0, angleDeg >= 0 ? 1 : -1];
         planes.push({
            a: normal[0],
            b: normal[1],
            c: normal[2],
            d,
            name: normalized.name,
            instructions: normalized.instructions,
            frosted: normalized.frosted,
         });
         return;
      }

      for (const index of indexSet) {
         let normal = computeNormalFromPolar(angleDeg, index, gear, 0);
         let planeD = d;
         const len = Math.hypot(normal[0], normal[1], normal[2]);
         if (!Number.isFinite(len) || len < 1e-9) continue;

         normal = [normal[0] / len, normal[1] / len, normal[2] / len];
         if (planeD < 0) {
            normal = [-normal[0], -normal[1], -normal[2]];
            planeD = -planeD;
         }

         planes.push({
            a: normal[0],
            b: normal[1],
            c: normal[2],
            d: planeD,
            name: normalized.name,
            instructions: normalized.instructions,
            frosted: normalized.frosted,
         });
      }
   });

   if (!planes.length) {
      throw new Error('Design: no facets defined');
   }

   return buildStoneFromHalfSpacePlanes(planes, refractiveIndex, gear);
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

   function readFacetLabel(nameView) {
      const byteLength = nameView.byteLength;
      const bytes = new Uint8Array(nameView.buffer, nameView.byteOffset, byteLength);
      const str = new TextDecoder().decode(bytes);

      // match "name\tinstructions" with optional tab. If no tab, all goes to name and instructions is empty.
      const match = (/^([^\t]*)\t?(.*)$/).exec(str) || ['', '', ''];
      return {
         name: match[1].trim(),
         instructions: match[2].trim(),
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
      const angle = Math.acos(c_raw / len) * 180 / Math.PI;

      const plane = {
         a: a_raw / len,
         b: b_raw / len,
         c: c_raw / len,
         d: 0.9 / len,   // matches stone.cpp: d = 1/len * 0.9
         angleDeg: angle,
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
      const nameView = new DataView(buffer, offset, nameLen);
      if (nameLen > 0) {
         const label = readFacetLabel(nameView);
         const normalized = normalizeFacetMetadata(label.name, label.instructions);
         planes[planes.length - 1].name = normalized.name;
         planes[planes.length - 1].instructions = normalized.instructions;
         planes[planes.length - 1].frosted = normalized.frosted;
         offset += nameLen;
      }

      // skip cached vertex data: read int32 tags until tag != 1
      while (offset + I32 <= buffer.byteLength) {
         const tag = view.getInt32(offset, true); offset += I32;
         if (tag !== 1) break;
         offset += F64 * 3; // skip x, y, z
      }
   }

   // Find facets with a name and use that name for all planes that match the angle and d within epsilon. This is a heuristic to recover facet labels that some versions of GemCad omit from planes other than the first in a group of parallel planes.
   const NAMING_EPS = 1e-4;
   for (const p of planes) {
      if (!p.name) {
         for (const q of planes) {
            if (q.name && Math.abs(p.angleDeg - q.angleDeg) < NAMING_EPS && Math.abs(p.d - q.d) < NAMING_EPS) {
               p.name = q.name;
               p.instructions = q.instructions;
               p.frosted = q.frosted;
               break;
            }
         }
      }
   }

   // ── 2. Read optional tail ────────────────────────────────────────────────
   let refractiveIndex = 1.77; // default: corundum, reasonable fallback
   let sourceGear = null;
   let sym = 0, mirrorSym = 0;
   if (offset + I32 * 3 + F64 <= buffer.byteLength) {
      sym = view.getInt32(offset, true); offset += I32; // nsym
      mirrorSym = view.getInt32(offset, true); offset += I32; // mirror_sym
      const tailGear = view.getInt32(offset, true); offset += I32; // igear
      sourceGear = Math.abs(tailGear); // For some reason, gear is sometimes negative.
      refractiveIndex = view.getFloat64(offset, true);
   }

   // ── 3. Reconstruct vertices by 3-plane intersection ──────────────────────
   // For a convex polyhedron defined by half-spaces ax+by+cz <= d, every
   // vertex is the intersection of exactly 3 planes. We try all C(n,3)
   // combinations and keep points that satisfy ALL planes (within epsilon).


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
            if (!pt || !insideAllPlanes(pt, planes)) continue;

            const vi = addVertex(pt);

            // This vertex belongs to planes i, j, k
            for (const pi of [i, j, k]) {
               if (!facetVerts[pi].includes(vi))
                  facetVerts[pi].push(vi);
            }
         }
      }
   }
   // ── 5. Tessellate and pack ────────────────────────────────────────────────
   const triangles = [];
   const facets = [];

   for (let pi = 0; pi < n; pi++) {
      const verts = orderFacetVerts(pi, facetVerts[pi], planes, allVerts);
      if (verts.length < 3) continue;

      const p = planes[pi];
      const nx = p.a, ny = p.b, nz = p.c;
      const triangleCount = verts.length - 2;
      facets.push({
         index: pi + 1,
         name: p.name,
         instructions: p.instructions,
         frosted: Boolean(p.frosted),
         normal: [nx, -ny, nz],
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
   // GEM format flips the Y axis compared to our convention.
   const triCount = triangles.length;
   const floatsPerVertex = 7;
   const vertexData = new Float32Array(triCount * 3 * floatsPerVertex);

   for (let i = 0; i < triCount; i++) {
      const { v0, v1, v2, normal, frosted } = triangles[i];
      const vs = [v0, v2, v1];
      for (let v = 0; v < 3; v++) {
         const idx = (i * 3 + v) * floatsPerVertex;
         vertexData[idx + 0] = vs[v][0];
         vertexData[idx + 1] = -vs[v][1];
         vertexData[idx + 2] = vs[v][2];
         vertexData[idx + 3] = normal[0];
         vertexData[idx + 4] = -normal[1];
         vertexData[idx + 5] = normal[2];
         vertexData[idx + 6] = frosted ? 1.0 : 0.0;
      }
   }

   return new StoneData(vertexData, triCount, facets, refractiveIndex, null, sourceGear);
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

   return { scale, center };
}

function computeMeshBoundsRadius(data) {
   let maxRadiusSq = 0;
   for (let i = 0; i < data.length; i += 7) {
      const x = data[i + 0];
      const y = data[i + 1];
      const z = data[i + 2];
      const radiusSq = x * x + y * y + z * z;
      if (radiusSq > maxRadiusSq) maxRadiusSq = radiusSq;
   }
   return Math.sqrt(maxRadiusSq);
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

function computeFacetAngleDeg(normal) {
   const nz = Math.max(-1, Math.min(1, Math.abs(normal[2])));
   return Math.acos(nz) * 180 / Math.PI;
}

function computeFacetAngleFromUpDeg(normal) {
   const x = normal[0];
   const y = normal[1];
   const z = normal[2];
   const len = Math.hypot(x, y, z);
   if (len <= 1e-8) return 180;
   const nz = Math.max(-1, Math.min(1, z / len));
   return Math.acos(nz) * 180 / Math.PI;
}

function hasUniqueTableFacet(facets = []) {
   for (const facet of facets) {
      const angle = computeFacetAngleFromUpDeg(facet?.normal || [0, 0, 0]);
      if (angle <= TABLE_FACET_MAX_ANGLE_DEG) {
         return true;
      }
   }
   return false;
}

function computeFacetGearIndex(normal, gear) {
   const x = normal[0] ?? 0;
   const y = normal[1] ?? 0;
   if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return 'Table';

   const g = gear;
   const turns = Math.atan2(x, -y) / (Math.PI * 2);
   let gearIndex = Math.round(turns * g);
   gearIndex = ((gearIndex % g) + g) % g;
   if (gearIndex === 0) gearIndex = g;
   return String(gearIndex).padStart(Math.max(2, String(g).length), '0');
}

function getFacetSection(angle) {
   if (angle < -1 || angle > 89) return 'PAVILION';
   return 'CROWN';
}

function groupFacetInfo(facets = [], gear) {
   const sections = new Map([
      ['PAVILION', []],
      ['CROWN', []],
      ['OTHER', []],
   ]);
   const grouped = new Map();

   for (const facet of facets) {
      const name = (facet.name || '').trim() || '?';
      const instructions = (facet.instructions || '').trim();
      const angle = computeSignedFacetAngleDeg(facet.normal);
      const angleLabel = Math.abs(angle).toFixed(2);
      const key = makeKeyFromFacet(facet);
      let entry = grouped.get(key);
      if (!entry) {
         entry = {
            ...facet,
            section: getFacetSection(angle),
            name,
            angle,
            angleLabel: `${angleLabel}°`,
            indexes: [],
            instructions,
         };
         grouped.set(key, entry);
         sections.get(entry.section)?.push(entry);
      } else if ((entry.name === '?' || !entry.name) && name !== '?') {
         const nextSection = getFacetSection(angle);
         if (entry.section !== nextSection) {
            const currentEntries = sections.get(entry.section);
            const currentIndex = currentEntries?.indexOf(entry) ?? -1;
            if (currentIndex >= 0) currentEntries.splice(currentIndex, 1);
            sections.get(nextSection)?.push(entry);
            entry.section = nextSection;
         }
         entry.name = name;
      }
      entry.indexes.push(computeFacetGearIndex(facet.normal, gear));
   }

   for (const entries of sections.values()) {
      entries.forEach((entry) => {
         const seen = new Set();
         const out = [];
         for (const index of entry.indexes) {
            let formatted;
            if (/^\d+$/.test(index)) {
               formatted = String(parseInt(index, 10)).padStart(2, '0');
            } else {
               formatted = index;
            }
            if (!seen.has(formatted)) {
               seen.add(formatted);
               out.push(formatted);
            }
         }
         entry.indexes = out.sort((a, b) => {
            return (a % gear) - (b % gear);
         });
      });
   }

   return sections;
}

function formatFacetIndexLines(indexes) {
   if (!indexes.length) return ['\u2014'];
   return indexes.join('-')
}

function parseFacetGearIndex(normal, gear) {
   const raw = computeFacetGearIndex(normal, gear);
   const parsed = parseInt(raw, 10);
   return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function wrapGearIndex(value, gear) {
   return value % gear;
}

function generatePatternIndexSet(startIndex, symmetry, mirror, gear) {
   const g = gear;
   const sym = Math.max(1, Math.min(g, Math.round(symmetry) || 1));
   const step = g / sym;
   const indexSet = new Set();

   for (let i = 0; i < sym; i++) {
      const offset = i * step;
      const primary = wrapGearIndex(startIndex + offset, g);
      indexSet.add(primary);
      if (mirror) indexSet.add(mirrorIndex(primary, g));
   }
   return [...indexSet].sort((a, b) => a - b);
}

function inferSymmetryMirrorFromIndexes(indexes, gear) {
   const g = gear;
   const normalized = [...new Set(
      (indexes || [])
         .map((value) => parseInt(value, 10))
         .filter((value) => Number.isFinite(value) && value >= 0)
         .map((value) => (value === 0 ? g : value))
         .map((value) => wrapGearIndex(value, g)),
   )].sort((a, b) => a - b);

   if (!normalized.length) return { startIndex: 0, symmetry: 1, mirror: false };
   if (normalized.length === 1) return { startIndex: normalized[0] === g ? 0 : normalized[0], symmetry: 1, mirror: false };

   // Compute deltas between consecutive indexes (wrap around)
   const deltas = [];
   for (let i = 0; i < normalized.length; i++) {
      const curr = normalized[i];
      const next = normalized[(i + 1) % normalized.length];
      const delta = (next - curr + g) % g;
      if (delta <= 0) {
         deltas.push(null);
      } else {
         deltas.push(delta);
      }
   }

   const allEqual = deltas.every((d) => d !== null && Math.abs(d - deltas[0]) < 1e-6);

   if (allEqual) {
      // Even spacing → no mirror, symmetry equals number of positions
      return { startIndex: normalized[0] === g ? 0 : normalized[0], symmetry: normalized.length, mirror: false };
   }

   // Otherwise assume mirrored pattern: mirror doubles the unique positions
   const inferredSymmetry = Math.max(1, Math.min(g, Math.floor(normalized.length / 2)));
   return { startIndex: normalized[0] === g ? 0 : normalized[0], symmetry: inferredSymmetry, mirror: true };
}

function computeSignedFacetAngleDeg(normal) {
   const absAngle = computeFacetAngleDeg(normal);
   return normal[2] >= 0 ? absAngle : -absAngle;
}

function getFacetDistanceValue(facet) {
   if (Number.isFinite(facet?.d)) return Math.abs(facet.d);
   return 1;
}

const makeKeyFromFacet = (facet) => {
   const angle = computeSignedFacetAngleDeg(facet.normal);
   const angleKey = angle.toFixed(2);
   const name = String(facet?.name || '').trim();
   const dKey = Number.isFinite(facet?.d) ? Math.abs(facet.d).toFixed(4) : 'NaN';
   // const section = getFacetSection(angle);
   // const instructions = String(facet?.instructions || '').trim();
   const key = `${name}\u0000${angleKey}\u0000${dKey}`;
   return key;
};

function groupExternalFacetsForDesign(facets = [], gear) {
   const sourceByKey = new Map();
   facets.forEach((facet) => {
      const key = makeKeyFromFacet(facet);
      if (!sourceByKey.has(key)) sourceByKey.set(key, []);
      sourceByKey.get(key).push(facet);
   });

   const groupedSections = groupFacetInfo(facets, gear);
   console.log('Grouped Sections:', groupedSections);
   const sectionOrder = ['PAVILION', 'CROWN', 'OTHER'];
   const groupedFacets = [];

   for (const sectionName of sectionOrder) {
      const entries = groupedSections.get(sectionName) || [];
      for (const entry of entries) {
         const key = makeKeyFromFacet(entry);
         const sourceFacets = sourceByKey.get(key) || [];
         const entryNameUpper = String(entry.name || '').trim().toUpperCase();
         const nameMatchedFacets = entryNameUpper
            ? sourceFacets.filter((facet) => String(facet?.name || '').trim().toUpperCase() === entryNameUpper)
            : [];
         const preferredFacets = nameMatchedFacets.length ? nameMatchedFacets : sourceFacets;
         const sampleFacet = preferredFacets[0] || sourceFacets[0] || null;

         const indexedFromSource = preferredFacets
            .map((facet) => parseFacetGearIndex(facet.normal, gear))
            .filter((value) => Number.isFinite(value));

         const indexedFromNotes = (entry.indexes || [])
            .map((value) => parseInt(value, 10))
            .filter((value) => Number.isFinite(value));

         const indexes = indexedFromNotes.length ? indexedFromNotes : indexedFromSource;
         const inferred = inferSymmetryMirrorFromIndexes(indexes, gear);

         groupedFacets.push({
            id: `${Date.now()}-${groupedFacets.length}-${Math.random().toString(36).slice(2, 8)}`,
            name: String(entry.name || sampleFacet?.name || `F${groupedFacets.length + 1}`),
            instructions: String(entry.instructions || sampleFacet?.instructions || ''),
            symmetry: inferred.symmetry,
            mirror: inferred.mirror,
            angleDeg: sampleFacet
               ? computeSignedFacetAngleDeg(sampleFacet.normal)
               : entry.angle,
            startIndex: inferred.startIndex,
            distance: entry.d,
            indexes: indexes.length ? [...new Set(indexes)] : undefined,
         });
      }
   }

   return groupedFacets;
}

function normalizeDesignFacet(inputFacet = {}, fallbackIndex = 0) {
   const parsedSymmetry = parseFloat(inputFacet.symmetry);
   const parsedAngleDeg = parseFloat(inputFacet.angleDeg);
   const parsedStartIndex = parseFloat(inputFacet.startIndex);
   const parsedDistance = parseFloat(inputFacet.distance);
   const parsedIndexes = Array.isArray(inputFacet.indexes)
      ? [...new Set(
         inputFacet.indexes
            .map((value) => parseInt(value, 10))
            .filter((value) => Number.isFinite(value) && value > 0),
      )].sort((a, b) => a - b)
      : null;
   const next = {
      id: inputFacet.id || `${Date.now()}-${fallbackIndex}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(inputFacet.name || `F${fallbackIndex + 1}`).trim() || `F${fallbackIndex + 1}`,
      instructions: String(inputFacet.instructions || '').trim(),
      symmetry: parsedSymmetry,
      mirror: Boolean(inputFacet.mirror),
      angleDeg: Math.max(-90, Math.min(90, Number.isFinite(parsedAngleDeg) ? parsedAngleDeg : 0)),
      startIndex: Math.max(0, Math.min(360, Math.round(Number.isFinite(parsedStartIndex) ? parsedStartIndex : 0))),
      distance: Math.max(0, Number.isFinite(parsedDistance) ? parsedDistance : 0),
      indexes: parsedIndexes && parsedIndexes.length ? parsedIndexes : undefined,
   };
   return next;
}

// Generate polygonal faces (ordered vertices, normal and angles) from
// a list of design-style facets (as produced by groupExternalFacetsForDesign
// or similar). Returns an array of faces: { name, instructions, normal, vertices:[ [x,y,z], ... ], angleDeg, signedAngleDeg, azimuthDeg }
function generateFacesFromFacetList(facetList = [], gear = 96) {

   const normalizedInput = (facetList || []).map((f, i) => normalizeDesignFacet(f, i));
   // Hardcoded toggle: when true, reverse polygon winding for all generated faces.
   const FORCE_REVERSE_WINDING = true;

   // Build plane half-spaces from facet definitions (one plane per patterned index)
   const planes = [];
   for (const facet of normalizedInput) {
      const symmetry = Math.min(gear, Math.round(Number(facet.symmetry) || gear));
      const step = Math.max(1, gear) / symmetry;
      const mirror = Boolean(facet.mirror);

      const explicit = Array.isArray(facet.indexes) ? facet.indexes.map(v => wrapGearIndex(Math.round(v), gear)) : [];

      const indexSet = new Set();
      if (explicit.length) {
         for (const idx of explicit) indexSet.add(idx);
      } else {
         const start = wrapGearIndex(facet.startIndex, gear);
         for (let i = 0; i < symmetry; i++) {
            const off = Math.round(i * step);
            const primary = wrapGearIndex(start + off, gear);
            indexSet.add(primary);
            if (mirror) indexSet.add(mirrorIndex(primary, gear));
         }
      }

      const angleDeg = Number.isFinite(Number(facet.angleDeg)) ? Number(facet.angleDeg) : 0;
      for (const idx of indexSet) {
         let normal = computeNormalFromPolar(angleDeg, idx, gear, 0);
         let d = facet.distance;
         const len = Math.hypot(normal[0], normal[1], normal[2]);
         if (!Number.isFinite(len) || len < EPS) continue;
         normal = [normal[0] / len, normal[1] / len, normal[2] / len];
         if (!Number.isFinite(d)) d = 1.0;
         if (d < 0) { normal = [-normal[0], -normal[1], -normal[2]]; d = -d; }

         planes.push({ a: normal[0], b: normal[1], c: normal[2], d, name: facet.name, instructions: facet.instructions, frosted: Boolean(facet.frosted), index: idx });
      }
   }

   if (!planes.length) return [];

   // Normalize plane coefficients
   for (const p of planes) {
      const l = Math.hypot(p.a, p.b, p.c) || 1;
      p.a /= l; p.b /= l; p.c /= l; p.d /= l;
   }

   const allVerts = [];
   function addVertex(pt) {
      for (let i = 0; i < allVerts.length; i++) {
         const v = allVerts[i];
         if (Math.abs(v[0] - pt[0]) + Math.abs(v[1] - pt[1]) + Math.abs(v[2] - pt[2]) < 1e-6) return i;
      }
      allVerts.push(pt);
      return allVerts.length - 1;
   }

   const n = planes.length;
   const facetVerts = planes.map(() => []);
   for (let i = 0; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
         for (let k = j + 1; k < n; k++) {
            const pt = intersect3Planes(planes[i], planes[j], planes[k]);
            if (!pt || !insideAllPlanes(pt, planes)) continue;
            const vi = addVertex(pt);
            for (const pi of [i, j, k]) if (!facetVerts[pi].includes(vi)) facetVerts[pi].push(vi);
         }
      }
   }

   // Flip plane normals if centroid violates half-space (match orientation used elsewhere)
   if (allVerts.length) {
      let cx = 0, cy = 0, cz = 0;
      for (const v of allVerts) { cx += v[0]; cy += v[1]; cz += v[2]; }
      cx /= allVerts.length; cy /= allVerts.length; cz /= allVerts.length;
      let flipCount = 0;
      for (const p of planes) {
         const val = p.a * cx + p.b * cy + p.c * cz;
         if (val > p.d + 1e-8) { p.a = -p.a; p.b = -p.b; p.c = -p.c; p.d = -p.d; flipCount++; }
      }
      if (flipCount) console.debug('generateFacesFromFacetList: flipped', flipCount, 'planes to match centroid');
   }

   const faces = [];
   for (let pi = 0; pi < n; pi++) {
      const ordered = orderFacetVerts(pi, facetVerts[pi], planes, allVerts);
      if (!ordered || ordered.length < 3) continue;
      let verts = ordered.map(vi => allVerts[vi]);
      if (FORCE_REVERSE_WINDING) verts = verts.reverse();
      const p = planes[pi];
      const n = [p.a, p.b, p.c];
      const angleDeg = computeFacetAngleDeg(n);
      const isGirdle = Math.abs(angleDeg - 90) <= 1.0;
      const normal = isGirdle ? [-n[0], n[1], n[2]] : n; // NOTE: no idea why i have to do that
      const signedAngleDeg = computeSignedFacetAngleDeg(n);
      const azimuth = (Math.atan2(n[0], -n[1]) * 180 / Math.PI) || 0;
      const azimuthDeg = ((azimuth % 360) + 360) % 360;
      // derive index_angle from the original pattern index when available to avoid mirrored pavilion angles
      let indexAngle = 0;
      if (Number.isFinite(Number(p.index))) {
         const idx = Number(p.index);
         // Map index -> angle step
         const step = 360 / Math.max(1, gear);
         let base = (idx * step) % 360;
         // For pavilion facets (signedAngleDeg < 0) that are NOT girdle facets, reverse rotation direction
         if (signedAngleDeg < 0 && !isGirdle) base = (360 - base) % 360;
         indexAngle = base;
         if (indexAngle < 0) indexAngle += 360;
      } else {
         const azimuth = (Math.atan2(n[0], -n[1]) * 180 / Math.PI) || 0;
         indexAngle = ((azimuth % 360) + 360) % 360;
      }

      const faceObj = {
         name: p.name || '',
         instructions: p.instructions || '',
         normal: normal,
         vertices: verts,
         angleDeg,
         signedAngleDeg,
         azimuthDeg,
         indexAngle,
      };
      // Heuristic: ensure girdle facets are laterally aligned with expected polar direction.
      if (isGirdle && Number.isFinite(Number(p.index))) {
         const expected = computeNormalFromPolar(angleDeg, Number(p.index), gear, 0);
         const ex = expected[0] || 0;
         if (ex * faceObj.normal[0] < 0) {
            // mirror vertices across X to align with expected side and flip normal
            faceObj.vertices = faceObj.vertices.map(v => (Array.isArray(v) ? [-v[0], v[1], v[2]] : v));
            faceObj.normal = [-faceObj.normal[0], -faceObj.normal[1], -faceObj.normal[2]];
         }
      }
      faces.push(faceObj);
   }

   return faces;
}

const GIRDLE_ANGLE_EPS_DEG = 1.0;
const isGirdleFacet = (facet) => {
   const angleDeg = computeFacetAngleDeg(facet.normal);
   return Math.abs(angleDeg - 90) <= GIRDLE_ANGLE_EPS_DEG;
};

function computeFacetNotesSummary(stone) {
   const facets = Array.isArray(stone?.facets) ? stone.facets : [];
   const vertexData = stone?.vertexData;
   if (!facets.length || !(vertexData instanceof Float32Array) || vertexData.length < 3) return null;

   let minX = Infinity; let maxX = -Infinity;
   let minY = Infinity; let maxY = -Infinity;
   let minZ = Infinity; let maxZ = -Infinity;
   for (let i = 0; i < vertexData.length; i += 7) {
      const x = vertexData[i + 0];
      const y = vertexData[i + 1];
      const z = vertexData[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
   }

   const xSpan = maxX - minX;
   const ySpan = maxY - minY;
   const length = Math.max(xSpan, ySpan);
   const width = Math.max(1e-9, Math.min(xSpan, ySpan));
   const lw = length / width;

   const girdleCount = facets.filter((facet) => isGirdleFacet(facet)).length;
   const totalCount = facets.length;
   const nonGirdleCount = Math.max(0, totalCount - girdleCount);

   const girdleZSlices = [];
   const floatsPerVertex = 7;
   const verticesPerTriangle = 3;
   let triOffset = 0;
   for (const facet of facets) {
      const triCount = Math.max(0, Math.round(facet?.triangleCount || 0));
      if (isGirdleFacet(facet)) {
         for (let t = 0; t < triCount; t++) {
            const triBase = (triOffset + t) * verticesPerTriangle * floatsPerVertex;
            for (let v = 0; v < verticesPerTriangle; v++) {
               const base = triBase + v * floatsPerVertex;
               if (base + 2 >= vertexData.length) continue;
               const z = vertexData[base + 2];
               if (Number.isFinite(z)) girdleZSlices.push(z);
            }
         }
      }
      triOffset += triCount;
   }

   let girdleTop = 0;
   let girdleBottom = 0;
   if (girdleZSlices.length) {
      girdleZSlices.sort((a, b) => a - b);
      const loIdx = Math.floor((girdleZSlices.length - 1) * 0.1);
      const hiIdx = Math.floor((girdleZSlices.length - 1) * 0.9);
      girdleBottom = girdleZSlices[Math.max(0, Math.min(girdleZSlices.length - 1, loIdx))];
      girdleTop = girdleZSlices[Math.max(0, Math.min(girdleZSlices.length - 1, hiIdx))];
   } else {
      const mid = (minZ + maxZ) * 0.5;
      girdleBottom = mid;
      girdleTop = mid;
   }

   const pavilionDepth = Math.max(0, girdleBottom - minZ);
   const crownHeight = Math.max(0, maxZ - girdleTop);
   const pw = pavilionDepth / width;
   const cw = crownHeight / width;

   const gearUsed = parseInt(stone.sourceGear, 10);

   return {
      lw,
      pw,
      cw,
      gearUsed,
      nonGirdleCount,
      girdleCount,
      totalCount,
   };
}

export {
   loadSTL,
   loadGCS,
   loadASC,
   loadGEM,
   convertGCSTextToGEMBuffer,
   normalizeMesh,
   computeMeshBoundsRadius,
   buildBVH,
   buildStoneFromFacetDesign,
   computeFacetAngleDeg,
   computeFacetAngleFromUpDeg,
   hasUniqueTableFacet,
   computeFacetGearIndex,
   groupFacetInfo,
   formatFacetIndexLines,
   parseFacetGearIndex,
   generatePatternIndexSet,
   inferSymmetryMirrorFromIndexes,
   computeSignedFacetAngleDeg,
   getFacetDistanceValue,
   groupExternalFacetsForDesign,
   normalizeDesignFacet,
   computeFacetNotesSummary,
   stretchStoneByVertices,
   computeNormalFromPolar,
   generateFacesFromFacetList,
};

