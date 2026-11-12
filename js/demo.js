/**
 * 演示图库：仅用于首次体验、截图与自动化验收。
 * 通过 ?demo=1 触发，生成 6 组抽象图片及变体，不包含任何真实照片。
 */

const WIDTH = 640;
const HEIGHT = 480;
const BASE_TIME = Date.UTC(2025, 0, 1, 8, 0, 0);

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width, height) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function toBlob(element, type, quality) {
  return new Promise((resolve) => element.toBlob(resolve, type, quality));
}

function drawBase(seed) {
  const element = canvas(WIDTH, HEIGHT);
  const ctx = element.getContext("2d");
  const random = mulberry32(seed * 97 + 13);
  const hue = (seed * 47 + 205) % 360;

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, `hsl(${hue} 72% 64%)`);
  gradient.addColorStop(0.55, `hsl(${(hue + 28) % 360} 68% 52%)`);
  gradient.addColorStop(1, `hsl(${(hue + 64) % 360} 62% 38%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 大色块
  for (let i = 0; i < 5; i += 1) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    const r = 70 + random() * 150;
    ctx.beginPath();
    ctx.fillStyle = `hsla(${(hue + 150 + i * 24) % 360} 78% 66% / ${0.16 + random() * 0.3})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 半透明几何体
  ctx.save();
  ctx.translate(WIDTH * (0.3 + random() * 0.4), HEIGHT * (0.35 + random() * 0.3));
  ctx.rotate((random() - 0.5) * 0.6);
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  const boxW = 150 + random() * 170;
  const boxH = 90 + random() * 120;
  ctx.beginPath();
  ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 22);
  ctx.fill();
  ctx.restore();

  // 细线
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(random() * WIDTH, random() * HEIGHT);
    ctx.lineTo(random() * WIDTH, random() * HEIGHT);
    ctx.stroke();
  }

  // 顶部高光
  const light = ctx.createRadialGradient(WIDTH * 0.78, 40, 0, WIDTH * 0.78, 40, 420);
  light.addColorStop(0, "rgba(255,255,255,0.35)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  return element;
}

function variant(source, mode) {
  if (mode === "resize") {
    const target = canvas(400, 300);
    target.getContext("2d").drawImage(source, 0, 0, 400, 300);
    return target;
  }
  if (mode === "crop") {
    const target = canvas(WIDTH, HEIGHT);
    const cropX = WIDTH * 0.06;
    const cropY = HEIGHT * 0.06;
    target
      .getContext("2d")
      .drawImage(source, cropX, cropY, WIDTH - cropX * 2, HEIGHT - cropY * 2, 0, 0, WIDTH, HEIGHT);
    return target;
  }
  const target = canvas(WIDTH, HEIGHT);
  const ctx = target.getContext("2d");
  if (mode === "bright") {
    ctx.filter = "brightness(1.12) saturate(1.06)";
  } else if (mode === "hue") {
    ctx.filter = "hue-rotate(11deg)";
  }
  ctx.drawImage(source, 0, 0);
  return target;
}

async function makeFile(element, name, index) {
  const blob = await toBlob(element, "image/jpeg", 0.9);
  return new File([blob], name, {
    type: "image/jpeg",
    lastModified: BASE_TIME + index * 1000,
  });
}

export async function createDemoFiles() {
  const files = [];
  let index = 0;
  for (let group = 1; group <= 6; group += 1) {
    const base = drawBase(group);
    const prefix = `demo-${String(group).padStart(2, "0")}`;
    files.push(await makeFile(base, `${prefix}-original.jpg`, index));
    index += 1;
    for (const mode of ["resize", "crop", "bright", "hue"]) {
      const element = variant(base, mode);
      files.push(await makeFile(element, `${prefix}-${mode}.jpg`, index));
      index += 1;
    }
  }
  return files;
}
