'use strict';

import {
   loadSTL,
   loadGCS,
   loadASC,
   loadGEM,
   convertGCSTextToGEMBuffer,
   normalizeMesh,
   computeMeshBoundsRadius,
   buildBVH,
   buildStoneFromFacetDesign,
   hasUniqueTableFacet,
   groupFacetInfo,
   formatFacetIndexLines,
   groupExternalFacetsForDesign,
   normalizeDesignFacet,
   computeFacetNotesSummary,
   stretchStoneByVertices,
   generateFacesFromFacetList,
} from './loaders.js';

// list all files in models folder
import fs from 'fs';
import path from 'path';

function dumpStoneInfo(stone) {
   const summary = computeFacetNotesSummary(stone);
   const groupedSections = groupFacetInfo(stone.facets, summary.gearUsed);
   const sectionOrder = ['PAVILION', 'CROWN', 'OTHER'];
   const result = {};

   for (const sectionName of sectionOrder) {
      const entries = groupedSections.get(sectionName) || [];
      if (!entries.length) continue;
      result[sectionName] = entries.map(entry => {
         return {
            name: entry.name,
            angle: entry.angle.toFixed(2),
            indexes: entry.indexes.join('-'),
            instructions: entry.instructions,
            frosted: entry.frosted,
            d: entry.d.toFixed(4),
         };
      }
      );
   }
   result.summary = summary;
   for (const [key, value] of Object.entries(result.summary)) {
      if (typeof value === 'number' && !Number.isInteger(value)) {
         result.summary[key] = value.toFixed(4);
      }
   }
   return result;
}

function diff(a, b, path = '') {
   for (const [key, value] of Object.entries(a)) {
      const newPath = `${path}.${key}`;
      if (typeof value === 'object' && value !== null) {
         if (diff(value, b[key], newPath)) {
            return true;
         }
      } else {
         if (value !== b[key]) {
            console.log(`${newPath}: ${value} !== ${b[key]}`);
            return true;
         }
      }
   }
   return false;
}


async function test() {
   const args = process.argv.slice(2);
   const files = fs.readdirSync('./models');
   let results = {};
   for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const filePath = path.join('./models', file);
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
      const info = dumpStoneInfo(stone);
      const jsonPath = path.join('./results', `${path.basename(file)}.json`);
      if (args.includes('--save')) {
         fs.writeFileSync(jsonPath, JSON.stringify(info, null, 2));
      } else {
         // Compare with existing JSON if it exists
         if (!fs.existsSync(jsonPath)) {
            throw new Error(`No existing JSON to compare for ${file}`);
         }
         const existingInfo = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
         if (diff(existingInfo, info)) {
            results[file] = { passed: false, info };
         } else {
            results[file] = { passed: true };
         }
      }
   }
   if (args.includes('--save')) {
      return;
   }
   console.log('Test results:');
   for (const [file, result] of Object.entries(results)) {
      if (result.passed) {
         console.log(`${file}: PASSED`);
      } else {
         console.log(`${file}: FAILED`);
         console.log(`Info: ${JSON.stringify(result.info, null, 2)}`);
      }
   }
   const failedCount = Object.values(results).filter(r => !r.passed).length;
   console.log(`Total: ${Object.keys(results).length}, Passed: ${Object.keys(results).length - failedCount}, Failed: ${failedCount}`);

   if (failedCount > 0) {
      process.exit(1);
   }
}

test();

