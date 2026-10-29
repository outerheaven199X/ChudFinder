/* Local fingerprints of user-selected media. No uploading and no generative detection. */
export function differenceHash(pixels: Uint8ClampedArray): string {
  if (pixels.length !== 9 * 8 * 4) throw new Error('Fingerprint needs a 9x8 RGBA sample');
  const grey = (i: number) => 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  let hash = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      hash <<= 1n;
      if (grey((y * 9 + x) * 4) > grey((y * 9 + x + 1) * 4)) hash |= 1n;
    }
  return hash.toString(16).padStart(16, '0');
}
export async function fingerprint(
  file: File,
): Promise<{ hash: string; frameSeconds: number | null; metadata: Record<string, string> }[]> {
  if (file.size > 100_000_000) throw new Error('Media exceeds the 100 MB local processing limit');
  const url = URL.createObjectURL(file),
    canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const read = (source: CanvasImageSource) => {
    context.drawImage(source, 0, 0, 9, 8);
    return differenceHash(context.getImageData(0, 0, 9, 8).data);
  };
  const header = new TextDecoder('latin1').decode(await file.slice(0, 1_000_000).arrayBuffer());
  const metadata = {
    type: file.type,
    bytes: String(file.size),
    c2pa: header.includes('c2pa')
      ? 'C2PA marker observed in first MB; signature NOT verified'
      : 'No marker observed in first MB; absence is inconclusive',
  };
  try {
    if (file.type.startsWith('image/')) {
      const image = new Image();
      image.src = url;
      await image.decode();
      return [
        {
          hash: read(image),
          frameSeconds: null,
          metadata: {
            ...metadata,
            width: String(image.naturalWidth),
            height: String(image.naturalHeight),
          },
        },
      ];
    }
    if (!file.type.startsWith('video/')) throw new Error('Unsupported media type');
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    const wait = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Media decode timeout')), 10000);
        video.addEventListener(
          event,
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        video.addEventListener(
          'error',
          () => {
            clearTimeout(timer);
            reject(new Error('Media decode failed'));
          },
          { once: true },
        );
      });
    await wait('loadeddata');
    if (!Number.isFinite(video.duration)) throw new Error('Video duration unavailable');
    const frames: {
      hash: string;
      frameSeconds: number | null;
      metadata: Record<string, string>;
    }[] = [];
    for (const ratio of [0, 0.25, 0.5, 0.75]) {
      const seconds = Math.max(0.001, video.duration * ratio);
      const done = wait('seeked');
      video.currentTime = seconds;
      await done;
      frames.push({
        hash: read(video),
        frameSeconds: seconds,
        metadata: {
          ...metadata,
          width: String(video.videoWidth),
          height: String(video.videoHeight),
          duration: String(video.duration),
        },
      });
    }
    video.removeAttribute('src');
    video.load();
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}
