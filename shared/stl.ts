/** Parsed STL ready for rendering. Positions/normals are non-indexed, Y-up (STL Z-up is rotated). */
export interface StlMesh {
  format: "binary" | "ascii";
  triangles: number;
  /** xyz per vertex, 9 floats per triangle, centered at the origin, Y-up. */
  positions: Float32Array;
  /** Flat face normal repeated per vertex, Y-up. */
  normals: Float32Array;
  /** Bounding box in the file's own coordinates/units. */
  min: [number, number, number];
  max: [number, number, number];
  /** Radius of the bounding sphere around the center (render space). */
  radius: number;
  /** Sum of facet areas in file units². */
  area: number;
  /** Signed volume in file units³; meaningful only for closed meshes. */
  volume: number;
}

export function parseStl(bytes: Uint8Array): StlMesh {
  const raw = isBinary(bytes) ? readBinary(bytes) : readAscii(bytes);
  return finish(raw.vertices, raw.format);
}

function isBinary(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (84 + count * 50 === bytes.byteLength) return true;
  // Not an exact binary size: treat as ASCII only when it really looks like one.
  const head = latin1(bytes.subarray(0, Math.min(bytes.byteLength, 1024))).trimStart().toLowerCase();
  return !(head.startsWith("solid") && head.includes("facet"));
}

function readBinary(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(80, true);
  const count = Math.min(declared, Math.floor((bytes.byteLength - 84) / 50));
  const vertices = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12; // skip the stored normal, it is often wrong
    for (let j = 0; j < 9; j++) vertices[i * 9 + j] = view.getFloat32(base + j * 4, true);
  }
  return { vertices, format: "binary" as const };
}

function readAscii(bytes: Uint8Array) {
  const text = latin1(bytes);
  const out: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) out.push(+match[1], +match[2], +match[3]);
  const usable = out.length - (out.length % 9);
  if (usable === 0) throw new Error("No facets found: this does not look like an STL file.");
  return { vertices: Float32Array.from(out.slice(0, usable)), format: "ascii" as const };
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
  }
  return s;
}

function finish(v: Float32Array, format: "binary" | "ascii"): StlMesh {
  const triangles = v.length / 9;
  if (triangles === 0) throw new Error("The STL file contains no triangles.");
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = v[i + k];
      if (!Number.isFinite(value)) continue;
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;

  const positions = new Float32Array(v.length);
  const normals = new Float32Array(v.length);
  let radius2 = 0;
  let area = 0;
  let volume = 0;
  for (let t = 0; t < v.length; t += 9) {
    const ax = v[t], ay = v[t + 1], az = v[t + 2];
    const bx = v[t + 3], by = v[t + 4], bz = v[t + 5];
    const qx = v[t + 6], qy = v[t + 7], qz = v[t + 8];
    // Face normal in file coordinates.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = qx - ax, wy = qy - ay, wz = qz - az;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    area += len / 2;
    volume += (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    for (let k = 0; k < 3; k++) {
      const o = t + k * 3;
      // Center, then Z-up -> Y-up: (x, y, z) -> (x, z, -y).
      const x = v[o] - cx, y = v[o + 1] - cy, z = v[o + 2] - cz;
      positions[o] = x;
      positions[o + 1] = z;
      positions[o + 2] = -y;
      normals[o] = nx;
      normals[o + 1] = nz;
      normals[o + 2] = -ny;
      const d = x * x + y * y + z * z;
      if (d > radius2) radius2 = d;
    }
  }
  return {
    format,
    triangles,
    positions,
    normals,
    min,
    max,
    radius: Math.sqrt(radius2) || 1,
    area,
    volume: Math.abs(volume),
  };
}

/** Wireframe edges: 2 vertices per edge, 3 edges per triangle. */
export function buildEdges(positions: Float32Array): Float32Array {
  const triangles = positions.length / 9;
  const out = new Float32Array(triangles * 18);
  for (let t = 0; t < triangles; t++) {
    const p = t * 9;
    const o = t * 18;
    const corners = [0, 3, 3, 6, 6, 0];
    for (let e = 0; e < 6; e++) {
      out[o + e * 3] = positions[p + corners[e]];
      out[o + e * 3 + 1] = positions[p + corners[e] + 1];
      out[o + e * 3 + 2] = positions[p + corners[e] + 2];
    }
  }
  return out;
}
