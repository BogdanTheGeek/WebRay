
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize3(v) { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }

// orthographic project vertices: drop z of camera-space coords
function projectOrtho(verts, viewVec, up = [0, 1, 0]) {
   const fwd = normalize3(viewVec);
   let r = normalize3(cross3(fwd, up));
   if (Math.hypot(...r) < 0.001) r = normalize3(cross3(fwd, [0, 0, 1]));
   const u2 = normalize3(cross3(r, fwd));
   return verts.map(v => [dot3(v, r), dot3(v, u2)]);
}

function gearRingStep(gear) {
   for (let d = 5; d <= gear; d++) {
      if (gear % d === 0) return d;
   }
   return 5; // fallback: label every vertex
}

function drawGearIndices(ctx, gear, cx, cy, radius) {
   let pts = [];
   const step = gearRingStep(gear);
   for (let i = 0; i < gear; i += step) {
      const angle = (i / gear) * 2 * Math.PI;
      const name = i === 0 ? gear : i; // label 0 as gear count for easier reading
      pts.push({ index: name, x: Math.sin(angle), y: -Math.cos(angle) });
   }

   console.log(`Drawing gear indices at radius ${radius} with step ${step}...`, pts);

   ctx.font = `12px sans-serif`;
   ctx.textAlign = 'center';
   ctx.textBaseline = 'middle';

   pts.forEach(p => {
      const lx = cx + p.x * radius;
      const ly = cy - p.y * radius;

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.lineJoin = 'round';
      ctx.strokeText(p.index, lx, ly);
      ctx.fillStyle = '#000000';
      ctx.fillText(p.index, lx, ly);
   });
}

function drawDimension(ctx, x1, y1, x2, y2, label, { offset = 0, color = '#000', fontSize = 11 } = {}) {
   const dx = x2 - x1, dy = y2 - y1;
   const len = Math.hypot(dx, dy);
   const nx = -dy / len, ny = dx / len; // normal (perpendicular)

   // offset positions
   const ax = x1 + nx * offset, ay = y1 + ny * offset;
   const bx = x2 + nx * offset, by = y2 + ny * offset;

   const barSize = 10;

   ctx.save();
   ctx.strokeStyle = color;
   ctx.fillStyle = color;
   ctx.lineWidth = 1;

   // main dimension line
   ctx.beginPath();
   ctx.moveTo(ax, ay);
   ctx.lineTo(bx, by);
   ctx.stroke();

   // end bars (perpendicular ticks)
   [[ax, ay], [bx, by]].forEach(([px, py]) => {
      ctx.beginPath();
      ctx.moveTo(px - nx * barSize, py - ny * barSize);
      ctx.lineTo(px + nx * barSize, py + ny * barSize);
      ctx.stroke();
   });

   // leader lines from original points to offset line
   ctx.setLineDash([2, 3]);
   ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ax, ay); ctx.stroke();
   ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(bx, by); ctx.stroke();
   ctx.setLineDash([]);

   // label in the middle
   const mx = (ax + bx) / 2, my = (ay + by) / 2;

   ctx.font = `${fontSize}px var(--font-sans)`;
   ctx.textAlign = 'center';
   ctx.textBaseline = 'middle';

   // white knockout
   ctx.lineWidth = 3;
   ctx.strokeStyle = '#ffffff';
   ctx.lineJoin = 'round';
   ctx.save();
   ctx.translate(mx, my);
   // ctx.rotate(angle);
   ctx.strokeText(label, 0, -6);
   ctx.fillStyle = color;
   ctx.fillText(label, 0, -6);
   ctx.restore();

   ctx.restore();
}

function renderOrtho(faces, view, canvas, scale = 1.0, gear) {

   const visible = faces.filter(f => dot3(f.normal, view) > 0.01);
   // only pick the first facet of eatch type for labeling, to avoid duplicates
   const visibleUnique = new Map();
   for (const f of visible) {
      const key = `${f.name}:${f.signedAngleDeg.toFixed(2)}`;
      if (!visibleUnique.has(key)) visibleUnique.set(key, f);
   }
   const labels = Array.from(visibleUnique.values());

   let viewIndex = '';
   if (view[0] === 0 && view[1] === 0 && view[2] === 1) viewIndex = 'top';
   else if (view[0] === -1 && view[1] === 0 && view[2] === 0) viewIndex = 'right';
   else if (view[0] === 0 && view[1] === 0 && view[2] === -1) viewIndex = 'back';
   else if (view[0] === 0 && view[1] === 1 && view[2] === 0) viewIndex = 'front';

   const ctx = canvas.getContext('2d');
   const W = canvas.width, H = canvas.height;
   // ctx.scale(dpr, dpr);
   ctx.clearRect(0, 0, W, H);
   // ctx.fillStyle = '#ff0000';
   // ctx.fillRect(0, 0, W, H);

   console.log(`Rendering ${canvas.id} view of size ${W}x${H}...`);

   const edgeCol = `#000000`;

   const scaled = Math.min(W, H) / 2 * scale * 0.8;
   const cx = W / 2, cy = H / 2;

   ctx.lineJoin = 'round';

   function drawFace(face, strokeStyle, fillStyle, lw = 1) {
      const pts = projectOrtho(face.vertices, view);
      ctx.beginPath();
      ctx.moveTo(cx + pts[0][0] * scaled, cy - pts[0][1] * scaled);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(cx + pts[i][0] * scaled, cy - pts[i][1] * scaled);
      ctx.closePath();
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lw;
      ctx.stroke();
   }

   // draw visible faces
   visible.forEach(f => {
      const fill = `#ffffff`;
      drawFace(f, edgeCol, fill, 1.5);
   });

   // face labels
   const fontSize = 12;
   ctx.font = `${fontSize}px sans-serif`;
   ctx.textAlign = 'center';
   ctx.textBaseline = 'middle';
   ctx.strokeStyle = '#ffffff';
   ctx.fillStyle = '#000000';
   ctx.lineWidth = 3;
   labels.forEach(f => {
      const pts = projectOrtho(f.vertices, view);
      const cx2 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy2 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      ctx.lineJoin = 'round'; // prevents spiky corners on sharp letters
      const [x, y] = [cx + cx2 * scaled, cy - cy2 * scaled];
      ctx.strokeText(f.name, x, y);
      ctx.fillText(f.name, x, y);
   });

   ctx.textAlign = 'left';
   ctx.textBaseline = 'alphabetic';

   const edgeOffset = 50;
   const vertLeft = [edgeOffset, edgeOffset * 2, edgeOffset, H - edgeOffset * 2];
   const vertRight = [W - edgeOffset, edgeOffset * 2, W - edgeOffset, H - edgeOffset * 2];
   const horizTop = [edgeOffset * 2, edgeOffset, W - edgeOffset * 2, edgeOffset];
   const horizBottom = [edgeOffset * 2, H - edgeOffset, W - edgeOffset * 2, H - edgeOffset];


   if (viewIndex === 'top') {
      console.log('Drawing gear indices for top view...');
      drawGearIndices(ctx, gear, cx, cy, Math.min(W, H) / 2 - 12);
   }
   else if (viewIndex === 'right') {
      drawDimension(ctx, ...vertRight, 'L');
   } else if (viewIndex === 'front') {
      drawDimension(ctx, ...horizBottom, 'W');
   }
}

export {
   renderOrtho,
};

