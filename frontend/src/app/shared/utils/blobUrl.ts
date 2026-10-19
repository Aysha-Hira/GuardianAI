export function assignBlobToImage(
  img: HTMLImageElement | null,
  url: string,
  prevRef: { current: string | null },
  onLoaded?: () => void,
): void {
  const prev = prevRef.current
  if (prev === url) return

  if (!img) {
    if (prev) URL.revokeObjectURL(prev)
    prevRef.current = url
    onLoaded?.()
    return
  }

  const revokePrev = () => {
    if (prev && prev !== url) URL.revokeObjectURL(prev)
    prevRef.current = url
    onLoaded?.()
  }

  img.onload = () => {
    revokePrev()
    img.onload = null
    img.onerror = null
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    if (prevRef.current === url) prevRef.current = prev
    img.onload = null
    img.onerror = null
  }
  img.src = url
}
