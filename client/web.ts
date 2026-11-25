// Web/Electron-only WebGL viewer. Every export is gated on Platform.OS === "web".
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Platform } from "react-native";
import { buildEdges, type StlMesh } from "../shared/stl";

declare const document: any;
declare const window: any;
declare const ResizeObserver: any;

export const canRender = Platform.OS === "web";

export type ViewPreset = "iso" | "front" | "top" | "right";

export interface ViewerColors {
  background: string;
  model: string;
  edges: string;
}

export interface Viewer {
  setView(preset: ViewPreset): void;
  setWireframe(on: boolean): void;
  setColors(colors: ViewerColors): void;
  setMesh(mesh: StlMesh): void;
  dispose(): void;
}

const PRESETS: Record<ViewPreset, { yaw: number; pitch: number }> = {
  iso: { yaw: -Math.PI / 4, pitch: 0.55 },
  front: { yaw: 0, pitch: 0 },
  top: { yaw: 0, pitch: Math.PI / 2 - 0.0001 },
  right: { yaw: -Math.PI / 2, pitch: 0 },
};

const MAX_WIREFRAME_TRIANGLES = 600_000;

const VERTEX = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uMvp;
uniform mat3 uNormalMat;
varying vec3 vNormal;
void main() {
  vNormal = uNormalMat * aNormal;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec3 vNormal;
uniform vec3 uColor;
uniform float uLit;
void main() {
  if (uLit < 0.5) { gl_FragColor = vec4(uColor, 1.0); return; }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float head = max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0);
  float key = max(dot(n, normalize(vec3(-0.5, 0.8, 0.6))), 0.0);
  float shade = 0.28 + 0.5 * head + 0.32 * key;
  gl_FragColor = vec4(uColor * shade, 1.0);
}`;

export function mountViewer(container: any, mesh: StlMesh, colors: ViewerColors): Viewer {
  if (!canRender) throw new Error("3D preview is only available in the desktop and web app.");

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;";
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const gl: any = canvas.getContext("webgl", { antialias: true }) || canvas.getContext("experimental-webgl");
  if (!gl) {
    canvas.remove();
    throw new Error("WebGL is not available in this window.");
  }

  const program = linkProgram(gl, VERTEX, FRAGMENT);
  const loc = {
    pos: gl.getAttribLocation(program, "aPos"),
    normal: gl.getAttribLocation(program, "aNormal"),
    mvp: gl.getUniformLocation(program, "uMvp"),
    normalMat: gl.getUniformLocation(program, "uNormalMat"),
    color: gl.getUniformLocation(program, "uColor"),
    lit: gl.getUniformLocation(program, "uLit"),
  };

  let current = mesh;
  let positionBuffer: any = null;
  let normalBuffer: any = null;
  let edgeBuffer: any = null;
  let edgeCount = 0;
  let wireframe = false;
  let palette = parseColors(colors);

  let yaw = PRESETS.iso.yaw;
  let pitch = PRESETS.iso.pitch;
  let distance = 1;
  let target = [0, 0, 0];

  function upload() {
    for (const b of [positionBuffer, normalBuffer, edgeBuffer]) if (b) gl.deleteBuffer(b);
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, current.positions, gl.STATIC_DRAW);
    normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, current.normals, gl.STATIC_DRAW);
    edgeBuffer = null;
    edgeCount = 0;
  }

  function ensureEdges() {
    if (edgeBuffer || current.triangles > MAX_WIREFRAME_TRIANGLES) return;
    const edges = buildEdges(current.positions);
    edgeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, edges, gl.STATIC_DRAW);
    edgeCount = edges.length / 3;
  }

  function fit() {
    const fov = Math.PI / 4;
    distance = (current.radius / Math.sin(fov / 2)) * 1.05;
    target = [0, 0, 0];
  }

  let frame = 0;
  function requestRender() {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const [br, bg, bb] = palette.background;
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const rotation = multiply(rotateX(pitch), rotateY(yaw));
    const view = multiply(translate(0, 0, -distance), multiply(rotation, translate(-target[0], -target[1], -target[2])));
    const near = Math.max(distance - current.radius * 2, distance * 0.001, 1e-4);
    const far = distance + current.radius * 2;
    const projection = perspective(Math.PI / 4, width / height, near, far);
    const mvp = multiply(projection, view);
    const normalMat = new Float32Array([
      rotation[0], rotation[1], rotation[2],
      rotation[4], rotation[5], rotation[6],
      rotation[8], rotation[9], rotation[10],
    ]);

    gl.useProgram(program);
    gl.uniformMatrix4fv(loc.mvp, false, mvp);
    gl.uniformMatrix3fv(loc.normalMat, false, normalMat);

    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.enableVertexAttribArray(loc.normal);
    gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(loc.color, palette.model);
    gl.uniform1f(loc.lit, 1);
    gl.drawArrays(gl.TRIANGLES, 0, current.triangles * 3);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    if (wireframe) {
      ensureEdges();
      if (edgeBuffer) {
        gl.disableVertexAttribArray(loc.normal);
        gl.vertexAttrib3f(loc.normal, 0, 0, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
        gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
        gl.uniform3fv(loc.color, palette.edges);
        gl.uniform1f(loc.lit, 0);
        gl.drawArrays(gl.LINES, 0, edgeCount);
      }
    }
  }

  // --- Interaction: left drag rotates, right/middle/shift drag pans, wheel zooms, double click resets.
  let drag: { id: number; x: number; y: number; pan: boolean } | null = null;
  const onPointerDown = (e: any) => {
    canvas.focus();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button === 1 || e.button === 2 || e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: any) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) {
      const rotation = multiply(rotateX(pitch), rotateY(yaw));
      const scale = (2 * distance * Math.tan(Math.PI / 8)) / Math.max(1, canvas.clientHeight);
      // Camera right/up in world space = rows of the rotation matrix.
      for (let k = 0; k < 3; k++) {
        target[k] += -dx * scale * rotation[k * 4] + dy * scale * rotation[k * 4 + 1];
      }
    } else {
      yaw += dx * 0.01;
      pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, pitch + dy * 0.01));
    }
    requestRender();
  };
  const onPointerUp = (e: any) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  const onWheel = (e: any) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    distance = Math.min(current.radius * 200, Math.max(current.radius * 0.02, distance * factor));
    requestRender();
  };
  const onDoubleClick = () => {
    api.setView("iso");
  };
  const onContextMenu = (e: any) => e.preventDefault();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDoubleClick);
  canvas.addEventListener("contextmenu", onContextMenu);

  const resizeObserver = new ResizeObserver(() => requestRender());
  resizeObserver.observe(canvas);

  upload();
  fit();
  requestRender();

  const api: Viewer = {
    setView(preset) {
      yaw = PRESETS[preset].yaw;
      pitch = PRESETS[preset].pitch;
      fit();
      requestRender();
    },
    setWireframe(on) {
      wireframe = on;
      requestRender();
    },
    setColors(next) {
      palette = parseColors(next);
      requestRender();
    },
    setMesh(next) {
      const sameScale = Math.abs(next.radius - current.radius) / current.radius < 0.01;
      current = next;
      upload();
      if (!sameScale) fit();
      requestRender();
    },
    dispose() {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
      for (const b of [positionBuffer, normalBuffer, edgeBuffer]) if (b) gl.deleteBuffer(b);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
  return api;
}

function linkProgram(gl: any, vs: string, fs: string) {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program error: ${gl.getProgramInfoLog(program)}`);
  return program;
}

// --- Colors

function parseColors(colors: ViewerColors) {
  return {
    background: parseColor(colors.background, [0.1, 0.1, 0.1]),
    model: parseColor(colors.model, [0.6, 0.65, 0.75]),
    edges: parseColor(colors.edges, [0, 0, 0]),
  };
}

function parseColor(input: string, fallback: number[]): Float32Array {
  const value = input.trim();
  let hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex) {
    if (hex.length <= 4) hex = hex.split("").map((c) => c + c).join("");
    return new Float32Array([0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16) / 255));
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value)?.[1];
  if (rgb) {
    const parts = rgb.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) return new Float32Array(parts.map((p) => p / 255));
  }
  return new Float32Array(fallback);
}

// --- Column-major 4x4 matrix helpers

type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function translate(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function rotateX(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotateY(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
