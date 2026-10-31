// Procedural walnut texture for the board.

import * as THREE from "three";
import { Noise, type RGB, hex, mix, smoothstep } from "./noise";

function canvasTexture(size: number, paint: (img: ImageData) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  paint(img);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function put(img: ImageData, i: number, c: RGB) {
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = 255;
}

/** Flat-sawn walnut, mapped across the whole board (u, v in board-plane units / 11). */
export function walnutTextures(size = 1024): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const n = new Noise(7);
  const dark = hex("#4a2816"), mid = hex("#74442a"), light = hex("#94603e");
  const grain = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = (x / size - 0.5) * 11, Y = (y / size - 0.5) * 11;
      // Growth rings: stretched along X, wobbling, like a plank cut through the trunk.
      const warp = n.fbm(X * 0.12, Y * 0.35, 0.5, 4) * 2.4;
      const ring = Math.sqrt((Y * 1.6 + warp) ** 2 + (X * 0.22 + 9) ** 2) * 4.2;
      const band = ring - Math.floor(ring);
      const late = smoothstep(0.55, 0.85, band) * (1 - smoothstep(0.9, 1, band));
      // Fine pores and streaks running with the grain.
      const streak = n.noise(X * 0.6, Y * 26 + warp * 6, 3.3) * 0.5 + 0.5;
      const pores = n.noise(X * 9, Y * 60, 9.1) > 0.45 ? 0.18 : 0;
      grain[y * size + x] = Math.min(1, late * 0.45 + (1 - streak) * 0.4 + pores);
    }
  }
  const map = canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      const g = grain[i];
      const base = mix(light, mid, smoothstep(0.0, 0.5, g));
      put(img, i * 4, mix(base, dark, smoothstep(0.45, 1, g)));
    }
  });
  const roughness = canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      const v = 120 + grain[i] * 90;
      put(img, i * 4, [v, v, v]);
    }
  }, false);
  return { map, roughness };
}
