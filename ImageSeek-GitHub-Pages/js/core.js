/**
 * 图搜移动端核心算法（不依赖 DOM，可在浏览器和 Node 中运行）。
 *
 * 特征与桌面版保持一致：
 *   pHash / dHash / aHash（各 64 bit）+ 4x4x4 RGB 直方图 + 4x4 网格颜色布局
 *
 * 哈希用两个 32 位整数 [hi, lo] 表示，避免 BigInt 在部分旧浏览器上的性能问题。
 */

export const HASH_BITS = 64;
export const DEFAULT_THRESHOLD = 0.7;

export const WEIGHTS = {
  phash: 0.5,
  dhash: 0.3,
  ahash: 0.2,
  hashTotal: 0.54,
  color: 0.26,
  layout: 0.2,
};

const N = 32;
const DCT = buildDctMatrix(N);
const COLOR_BINS = 4;
const COLOR_DIM = COLOR_BINS ** 3;
const LAYOUT_CELLS = 4;

function buildDctMatrix(size) {
  const matrix = new Float32Array(size * size);
  for (let k = 0; k < size; k += 1) {
    const scale = k === 0 ? Math.sqrt(1 / size) : Math.sqrt(2 / size);
    for (let n = 0; n < size; n += 1) {
      matrix[k * size + n] =
        scale * Math.cos((Math.PI * (2 * n + 1) * k) / (2 * size));
    }
  }
  return matrix;
}

function dct2d(gray) {
  const temp = new Float32Array(N * N);
  const coeff = new Float32Array(N * N);
  for (let u = 0; u < N; u += 1) {
    const row = u * N;
    for (let x = 0; x < N; x += 1) {
      let sum = 0;
      for (let y = 0; y < N; y += 1) sum += DCT[row + y] * gray[y * N + x];
      temp[row + x] = sum;
    }
  }
  for (let u = 0; u < N; u += 1) {
    for (let v = 0; v < N; v += 1) {
      let sum = 0;
      for (let x = 0; x < N; x += 1) {
        sum += temp[u * N + x] * DCT[v * N + x];
      }
      coeff[u * N + v] = sum;
    }
  }
  return coeff;
}

function median(values) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function packBits(bits) {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < HASH_BITS; i += 1) {
    if (!bits[i]) continue;
    if (i < 32) hi = (hi | (1 << (31 - i))) >>> 0;
    else lo = (lo | (1 << (63 - i))) >>> 0;
  }
  return [hi, lo];
}

export function popcount32(value) {
  let x = value >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

export function hamming(a, b) {
  return popcount32((a[0] ^ b[0]) >>> 0) + popcount32((a[1] ^ b[1]) >>> 0);
}

function grayArray(data, width, height) {
  if (data.length !== width * height * 4) {
    throw new Error(`像素尺寸不匹配：期望 ${width}x${height}x4`);
  }
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

function colorHistogram(rgba) {
  const counts = new Float32Array(COLOR_DIM);
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] >> 6;
    const g = rgba[i + 1] >> 6;
    const b = rgba[i + 2] >> 6;
    counts[(r * COLOR_BINS + g) * COLOR_BINS + b] += 1;
    total += 1;
  }
  if (total > 0) {
    for (let i = 0; i < counts.length; i += 1) counts[i] /= total;
  }
  return counts;
}

function layoutFeature(rgba32) {
  const cell = 32 / LAYOUT_CELLS;
  const layout = new Float32Array(LAYOUT_CELLS * LAYOUT_CELLS * 3);
  for (let gy = 0; gy < LAYOUT_CELLS; gy += 1) {
    for (let gx = 0; gx < LAYOUT_CELLS; gx += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < cell; y += 1) {
        for (let x = 0; x < cell; x += 1) {
          const index = ((gy * cell + y) * 32 + (gx * cell + x)) * 4;
          r += rgba32[index];
          g += rgba32[index + 1];
          b += rgba32[index + 2];
        }
      }
      const denominator = cell * cell * 255;
      const offset = (gy * LAYOUT_CELLS + gx) * 3;
      layout[offset] = r / denominator;
      layout[offset + 1] = g / denominator;
      layout[offset + 2] = b / denominator;
    }
  }
  return layout;
}

/**
 * 从准备好的像素数组计算特征。
 * @param {{gray32: Float32Array, gray9x8: Float32Array, gray8: Float32Array,
 *          rgba64: Uint8ClampedArray, rgba32: Uint8ClampedArray}} input
 */
export function computeFeatures(input) {
  const { gray32, gray9x8, gray8, rgba64, rgba32 } = input;
  if (gray32.length !== 32 * 32 || gray9x8.length !== 9 * 8 || gray8.length !== 8 * 8) {
    throw new Error("灰度图尺寸不正确");
  }

  const coeff = dct2d(gray32);
  const low = new Float32Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) low[y * 8 + x] = coeff[y * N + x];
  }
  const threshold = median(low);
  const phash = packBits(Array.from(low, (value) => value > threshold));

  let sum = 0;
  for (let i = 0; i < gray8.length; i += 1) sum += gray8[i];
  const mean = sum / gray8.length;
  const ahash = packBits(Array.from(gray8, (value) => value > mean));

  const dhashBits = new Uint8Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      dhashBits[y * 8 + x] =
        gray9x8[y * 9 + x + 1] > gray9x8[y * 9 + x] ? 1 : 0;
    }
  }
  const dhash = packBits(dhashBits);

  return {
    phash,
    dhash,
    ahash,
    color: colorHistogram(rgba64),
    layout: layoutFeature(rgba32),
  };
}

/** 直接由一张 RGBA（任意尺寸，建议 >= 64x64）计算特征，主要用于测试。 */
export function featuresFromRGBA(rgba, width, height) {
  if (width < 64 || height < 64) {
    throw new Error("测试图像至少需要 64x64");
  }
  const sample = (targetW, targetH) => {
    const out = new Uint8ClampedArray(targetW * targetH * 4);
    for (let y = 0; y < targetH; y += 1) {
      const sy = Math.min(height - 1, Math.floor((y * height) / targetH));
      for (let x = 0; x < targetW; x += 1) {
        const sx = Math.min(width - 1, Math.floor((x * width) / targetW));
        const src = (sy * width + sx) * 4;
        const dst = (y * targetW + x) * 4;
        out[dst] = rgba[src];
        out[dst + 1] = rgba[src + 1];
        out[dst + 2] = rgba[src + 2];
        out[dst + 3] = 255;
      }
    }
    return out;
  };
  const rgba64 = sample(64, 64);
  const rgba32 = sample(32, 32);
  return computeFeatures({
    gray32: grayArray(sample(32, 32), 32, 32),
    gray9x8: grayArray(sample(9, 8), 9, 8),
    gray8: grayArray(sample(8, 8), 8, 8),
    rgba64,
    rgba32,
  });
}

export function similarity(a, b) {
  const ph = 1 - hamming(a.phash, b.phash) / HASH_BITS;
  const dh = 1 - hamming(a.dhash, b.dhash) / HASH_BITS;
  const ah = 1 - hamming(a.ahash, b.ahash) / HASH_BITS;
  const hash = WEIGHTS.phash * ph + WEIGHTS.dhash * dh + WEIGHTS.ahash * ah;

  let intersection = 0;
  for (let i = 0; i < a.color.length; i += 1) {
    intersection += Math.min(a.color[i], b.color[i]);
  }

  let difference = 0;
  for (let i = 0; i < a.layout.length; i += 1) {
    difference += Math.abs(a.layout[i] - b.layout[i]);
  }
  const layout = 1 - difference / a.layout.length;

  const score =
    WEIGHTS.hashTotal * hash + WEIGHTS.color * intersection + WEIGHTS.layout * layout;
  return Math.max(0, Math.min(1, score));
}

/** 把特征记录转成紧凑的调试字符串。 */
export function hashHex(hash) {
  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}
