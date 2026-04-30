'use strict';

import {
   loadSTL,
   loadGCS,
   loadASC,
   loadGEM,
   computeMeshBoundsRadius,
   groupExternalFacetsForDesign,
   generateFacesFromFacetList,
} from './loaders.js';
import { renderOrtho } from './ortho.js';

import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';
import sharp from 'sharp';


async function makePreview(filePath) {
   const ext = path.extname(filePath).toLowerCase();
   const raw = fs.readFileSync(filePath);
   const data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
   let stone;
   if (ext === '.stl') {
      stone = await loadSTL(data);
   } else if (ext === '.gcs') {
      stone = await loadGCS(data);
   } else if (ext === '.asc') {
      stone = await loadASC(data);
   } else if (ext === '.gem') {
      stone = await loadGEM(data);
   } else {
      throw new Error(`Unsupported file type: ${ext}`);
   }
   const width = 600;
   const height = 600;
   const gear = stone.sourceGear;

   const modelBoundsRadius = computeMeshBoundsRadius(stone.vertexData);
   const grouped = groupExternalFacetsForDesign(stone.facets, gear);
   const faces = generateFacesFromFacetList(grouped, gear);

   const views = {
      top: [0, 0, 1],
      right: [-1, 0, 0],
      back: [0, 0, -1],
      front: [0, 1, 0],
   };
   const finalCanvas = createCanvas(width, height);
   const ctx = finalCanvas.getContext('2d');
   ctx.fillStyle = 'white';
   ctx.fillRect(0, 0, width, height);

   for (const viewName in views) {
      const view = views[viewName];
      const canvas = createCanvas(width / 2, height / 2);
      renderOrtho(faces, view, canvas, 1 / modelBoundsRadius, gear);

      const x = viewName === 'top' || viewName === 'back' ? 0 : width / 2;
      const y = viewName === 'top' || viewName === 'right' ? 0 : height / 2;
      ctx.drawImage(canvas, x, y);
   }

   // const bufferPng = finalCanvas.toBuffer('image/png');
   // const outputPath = `${filePath}.png`;
   // fs.writeFileSync(outputPath, bufferPng);

   const buffer = finalCanvas.toBuffer();
   sharp(buffer)
      .avif({ quality: 25, lossless: false })
      .toFile(`${filePath}.avif`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
   console.error('Usage: node preview.js <path_to_model_file>');
   process.exit(1);
}

// for every arg, if directory, get all files in directory
let filesToProcess = [];
for (const arg of args) {
   if (fs.existsSync(arg)) {
      const stat = fs.statSync(arg);
      if (stat.isDirectory()) {
         const files = fs.readdirSync(arg).map(f => path.join(arg, f));
         filesToProcess.push(...files);
      } else if (stat.isFile()) {
         filesToProcess.push(arg);
      }
   } else {
      console.error(`File or directory does not exist: ${arg}`);
   }
}

// filter files to only supported types
filesToProcess = filesToProcess.filter(f => {
   const ext = path.extname(f).toLowerCase();
   return ['.gcs', '.asc', '.gem'].includes(ext);
});

(async () => {
   for (const filePath of filesToProcess) {
      try {
         await makePreview(filePath);
         console.log(`Generated preview for ${filePath}`);
      } catch (err) {
         console.error(`Error processing ${filePath}: ${err.message}`);
      }
   }
})();
