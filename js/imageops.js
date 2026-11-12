/**
 * 图片解码、缩略图与特征提取（浏览器端）。
 */

import { computeFeatures } from "./core.js";

const THUMB_MAX = 420;

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawPixels(source, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

function toGrayscale(rgba) {
  const gray = new Float32Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return gray;
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return { source: await createImageBitmap(file), revoke: null };
    } catch (error) {
      console.warn("createImageBitmap 失败，改用 <img> 解码", error);
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("无法解码这张图片"));
    image.src = url;
  });
  return { source: image, revoke: url };
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function makeThumbnail(source, width, height) {
  const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
  const thumbWidth = Math.max(1, Math.round(width * scale));
  const thumbHeight = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(thumbWidth, thumbHeight);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, thumbWidth, thumbHeight);

  let blob = await toBlob(canvas, "image/webp", 0.78);
  if (!blob || blob.type !== "image/webp") {
    const jpeg = await toBlob(canvas, "image/jpeg", 0.82);
    if (jpeg) blob = jpeg;
  }
  if (!blob) throw new Error("无法生成缩略图");
  return blob;
}

export async function extractImage(file) {
  const { source, revoke } = await decode(file);
  try {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("无法读取图片尺寸");

    const rgba64 = drawPixels(source, 64, 64);
    const rgba32 = drawPixels(source, 32, 32);
    const features = computeFeatures({
      gray32: toGrayscale(drawPixels(source, 32, 32)),
      gray9x8: toGrayscale(drawPixels(source, 9, 8)),
      gray8: toGrayscale(drawPixels(source, 8, 8)),
      rgba64,
      rgba32,
    });
    const thumb = await makeThumbnail(source, width, height);
    return { features, width, height, thumb };
  } finally {
    if (typeof source.close === "function") source.close();
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
