"use strict";

class StoneData {
   constructor(vertexData, triangleCount, facets = [], refractiveIndex = null, dispersion = null, sourceGear = null) {
      this.vertexData = vertexData;
      this.triangleCount = triangleCount;
      this.facets = facets;
      this.refractiveIndex = refractiveIndex;
      this.dispersion = dispersion;
      this.sourceGear = sourceGear;
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

   const sourceGearRaw = parseInt(doc.querySelector('index')?.getAttribute('gear') || '', 10);
   const sourceGear = Number.isFinite(sourceGearRaw) && sourceGearRaw > 0 ? sourceGearRaw : null;

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
   const EPSILON = 1e-9;

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
         if (!isFinite(nLen) || nLen < EPSILON) continue;
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
         if (!isFinite(d0) || d0 < EPSILON) continue;

         const rawLen = 0.9 / d0;
         const aRaw = nx * rawLen;
         const bRaw = ny * rawLen;
         const cRaw = nz * rawLen;

         writer.writeFloat64(aRaw);
         writer.writeFloat64(bRaw);
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

         for (const [x, y, z] of verts) {
            writer.writeInt32(1);
            writer.writeFloat64(x);
            writer.writeFloat64(y);
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

function buildStoneFromHalfSpacePlanes(planes, refractiveIndex = null, sourceGear = null) {
   const EPSILON = 1e-8;
   const VERTEX_EPS = 1e-6;

   function intersect3Planes(p0, p1, p2) {
      const { a: a0, b: b0, c: c0, d: d0 } = p0;
      const { a: a1, b: b1, c: c1, d: d1 } = p1;
      const { a: a2, b: b2, c: c2, d: d2 } = p2;

      const det = a0 * (b1 * c2 - b2 * c1) - b0 * (a1 * c2 - a2 * c1) + c0 * (a1 * b2 - a2 * b1);
      if (Math.abs(det) < EPSILON) return null;

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
            if (!pt || !insideAllPlanes(pt)) continue;
            const vi = addVertex(pt);
            for (const pi of [i, j, k]) {
               if (!facetVerts[pi].includes(vi)) facetVerts[pi].push(vi);
            }
         }
      }
   }

   function orderFacetVerts(planeIdx, vindices) {
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

   const triangles = [];
   const facets = [];

   for (let pi = 0; pi < n; pi++) {
      const verts = orderFacetVerts(pi, facetVerts[pi]);
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

async function loadASC(url) {
   const response = await fetch(url);
   const text = await response.text();
   const lines = text.split(/\r?\n/);

   let igear = 96;
   let gearOff = 0;
   let currentAngle = 0;
   let currentRho = 0;
   let currentName = '';
   let currentInstructions = '';
   let refractiveIndex = 1.54;

   const planes = [];

   const polarPlane = (angle, index) => {
      const incl = angle * Math.PI / 180;
      const azi = (index - gearOff) * 2 * Math.PI / igear;
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

   let sawHeader = false;

   for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) continue;
      if (line.startsWith(';') || line.startsWith('#') || line.startsWith('//')) continue;

      const parts = line.split(/\s+/);
      if (!parts.length || !parts[0]) continue;

      if (!sawHeader) {
         if (parts[0] !== 'GemCad') throw new Error('ASC: missing GemCad header');
         sawHeader = true;
         continue;
      }

      let i = 0;
      while (i < parts.length) {
         const tok = parts[i];
         if (!tok) {
            i++;
            continue;
         }

         const ch = tok.charAt(0);

         if (ch === 'a') {
            if (i + 2 < parts.length) {
               const angle = parseFloat(parts[i + 1]);
               const rho = parseFloat(parts[i + 2]);
               if (isFinite(angle) && isFinite(rho)) {
                  currentAngle = angle;
                  currentRho = rho * 0.9;
               }
               i += 3;
               continue;
            }
            i++;
            continue;
         }

         if (ch === 'n') {
            currentName = i + 1 < parts.length ? parts[i + 1] : '';
            i += 2;
            continue;
         }

         if (ch === 'G') {
            currentInstructions = line.slice(line.indexOf(tok) + tok.length).trim();
            break;
         }

         if (ch === 'g') {
            if (i + 1 < parts.length) {
               const nextGear = parseInt(parts[i + 1], 10);
               if (isFinite(nextGear) && nextGear > 0) igear = nextGear;
            }
            if (i + 2 < parts.length) {
               const nextOff = parseFloat(parts[i + 2]);
               if (isFinite(nextOff)) gearOff = nextOff;
            }
            i += 3;
            continue;
         }

         if (ch === 'I') {
            if (i + 1 < parts.length) {
               const ri = parseFloat(parts[i + 1]);
               if (isFinite(ri) && ri > 1.0) refractiveIndex = ri;
            }
            i += 2;
            continue;
         }

         if (ch === 'H' || ch === 'F' || ch === 'y') {
            break;
         }

         const index = parseFloat(tok);
         if (!isFinite(index)) {
            i++;
            continue;
         }

         let normal;
         let d;
         if (currentAngle === 0) {
            if (currentRho > 0) {
               normal = [0, 0, 1];
               d = currentRho;
            } else {
               normal = [0, 0, -1];
               d = -currentRho;
            }
         } else {
            normal = polarPlane(currentAngle, index);
            d = currentRho;
         }

         const len = Math.hypot(normal[0], normal[1], normal[2]);
         if (!isFinite(len) || len < 1e-9 || !isFinite(d) || Math.abs(d) <= 1e-12) {
            i++;
            continue;
         }

         if (d < 0) {
            normal = [-normal[0], -normal[1], -normal[2]];
            d = -d;
         }

         const normalizedFacet = normalizeFacetMetadata(currentName, currentInstructions);
         planes.push({
            a: normal[0] / len,
            b: normal[1] / len,
            c: normal[2] / len,
            d,
            name: normalizedFacet.name,
            instructions: normalizedFacet.instructions,
            frosted: normalizedFacet.frosted,
         });
         i++;
      }
   }

   if (!sawHeader) {
      throw new Error('ASC: missing GemCad header');
   }
   if (!planes.length) {
      throw new Error('ASC: no facets found');
   }

   return buildStoneFromHalfSpacePlanes(planes, refractiveIndex, igear);
}

function buildStoneFromFacetDesign(definition = {}) {
   const gearDefault = parseInt(definition.gear, 10);
   const defaultGear = Number.isFinite(gearDefault) && gearDefault > 0 ? gearDefault : 96;
   const facets = Array.isArray(definition.facets) ? definition.facets : [];
   const ri = parseFloat(definition.refractiveIndex);
   const refractiveIndex = Number.isFinite(ri) && ri > 1.0 ? ri : 1.54;

   const planes = [];
   const wrapIndex = (value, gear) => {
      const g = Math.max(1, gear);
      let wrapped = Math.round(value);
      wrapped = ((wrapped - 1) % g + g) % g + 1;
      return wrapped;
   };

   const computeNormalFromPolar = (angleDeg, index, gear, gearOffset = 0) => {
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

   facets.forEach((facet, idx) => {
      const facetName = String(facet?.name || `F${idx + 1}`).trim();
      const instructions = String(facet?.instructions || '').trim();
      const normalized = normalizeFacetMetadata(facetName, instructions);

      const gearValue = parseInt(facet?.gear, 10);
      const gear = Number.isFinite(gearValue) && gearValue > 0 ? gearValue : defaultGear;

      const symmetryValue = parseInt(facet?.symmetry, 10);
      const symmetry = Math.max(1, Number.isFinite(symmetryValue) ? symmetryValue : 1);

      const angle = parseFloat(facet?.angleDeg);
      const angleDeg = Number.isFinite(angle) ? Math.max(-90.0, Math.min(90.0, angle)) : 0;

      const startRaw = parseFloat(facet?.startIndex);
      const startIndex = Number.isFinite(startRaw) ? wrapIndex(startRaw, gear) : 1;

      const distanceRaw = parseFloat(facet?.distance);
      const d = Number.isFinite(distanceRaw) ? Math.max(1e-5, Math.abs(distanceRaw)) : 1.0;

      const mirror = Boolean(facet?.mirror);
      const step = gear / symmetry;
      const indexSet = new Set();

      const mirrorIndex = (index) => {
         const idx = wrapIndex(index, gear);
         if (idx === gear) return gear;
         return wrapIndex(gear - idx, gear);
      };

      const explicitIndexes = Array.isArray(facet?.indexes)
         ? [...new Set(
            facet.indexes
               .map((value) => parseInt(value, 10))
               .filter((value) => Number.isFinite(value) && value >= 0)
               .map((value) => (value === 0 ? gear : value))
               .map((value) => wrapIndex(value, gear)),
         )]
         : [];

      const indexDistanceOverrides = facet?.indexDistances && typeof facet.indexDistances === 'object'
         ? Object.entries(facet.indexDistances)
            .map(([index, value]) => [wrapIndex(parseInt(index, 10), gear), parseFloat(value)])
            .filter(([index, value]) => Number.isFinite(index) && Number.isFinite(value) && value >= 0)
            .reduce((acc, [index, value]) => {
               acc.set(index, Math.max(1e-5, Math.abs(value)));
               return acc;
            }, new Map())
         : new Map();

      if (explicitIndexes.length > 0) {
         explicitIndexes.forEach((value) => indexSet.add(value));
      } else {
         for (let i = 0; i < symmetry; i++) {
            const offset = i * step;
            const primary = wrapIndex(startIndex + offset, gear);
            indexSet.add(primary);
            if (mirror) {
               indexSet.add(mirrorIndex(primary));
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
         let planeD = indexDistanceOverrides.get(index) ?? d;
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

   return buildStoneFromHalfSpacePlanes(planes, refractiveIndex, defaultGear);
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
   let sourceGear = null;
   if (offset + I32 * 3 + F64 <= buffer.byteLength) {
      offset += I32; // nsym
      offset += I32; // mirror_sym
      const tailGear = view.getInt32(offset, true); offset += I32; // igear
      if (Number.isFinite(tailGear) && tailGear > 0) sourceGear = tailGear;
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
};

