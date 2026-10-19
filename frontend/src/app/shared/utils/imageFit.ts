export function fitInBox(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  if (imgW <= 0 || imgH <= 0) return { width: maxW, height: maxH }
  const scale = Math.min(maxW / imgW, maxH / imgH, 1)
  return { width: imgW * scale, height: imgH * scale }
}

export function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}
