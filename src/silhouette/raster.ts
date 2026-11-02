export type Mask = { width: number; height: number; data: Uint8Array };

type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

/** 알파<250 픽셀이 5% 이상이면 투명 배경이 있는 이미지로 본다. */
export function hasMeaningfulAlpha(img: ImageData): boolean {
  const { width, height, data } = img as RgbaImage;
  const total = width * height;
  if (total === 0) return false;
  let transparent = 0;
  for (let i = 0; i < total; i++) if (data[i * 4 + 3] < 250) transparent++;
  return transparent / total >= 0.05;
}

export function alphaToMask(img: ImageData, threshold = 128): Mask {
  const { width, height, data } = img as RgbaImage;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
  return { width, height, data: out };
}

/**
 * 정사각 구조요소(반지름 r) 분리형 min/max 필터.
 * 침식은 영역 밖을 1, 팽창은 0으로 취급해서 가장자리에 닿은 도형이 깎이지 않게 한다.
 */
function morph(mask: Mask, r: number, erode: boolean): Mask {
  const { width: w, height: h } = mask;
  const outside = erode ? 1 : 0;
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const dst = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = erode ? 1 : 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const s = xx < 0 || yy < 0 || xx >= w || yy >= h ? outside : src[yy * w + xx];
          if (erode ? s === 0 : s === 1) {
            v = erode ? 0 : 1;
            break;
          }
        }
        dst[y * w + x] = v;
      }
    }
    return dst;
  };
  return { width: w, height: h, data: pass(pass(mask.data, true), false) };
}

export function morphClose(mask: Mask, r: number): Mask {
  if (r <= 0) return mask;
  return morph(morph(mask, r, false), r, true);
}

export function morphOpen(mask: Mask, r: number): Mask {
  if (r <= 0) return mask;
  return morph(morph(mask, r, true), r, false);
}

/** 4-연결 최대 덩어리만 남긴다. */
export function largestComponent(mask: Mask): Mask {
  const { width: w, height: h, data } = mask;
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0 || label[i] !== 0) continue;
    next++;
    let size = 0;
    label[i] = next;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && data[p - 1] && !label[p - 1]) { label[p - 1] = next; stack.push(p - 1); }
      if (x < w - 1 && data[p + 1] && !label[p + 1]) { label[p + 1] = next; stack.push(p + 1); }
      if (y > 0 && data[p - w] && !label[p - w]) { label[p - w] = next; stack.push(p - w); }
      if (y < h - 1 && data[p + w] && !label[p + w]) { label[p + w] = next; stack.push(p + w); }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  const out = new Uint8Array(w * h);
  if (best) for (let i = 0; i < out.length; i++) if (label[i] === best) out[i] = 1;
  return { width: w, height: h, data: out };
}
