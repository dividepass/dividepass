const DEFAULTS = {
  icon: { maxWidth: 256, quality: 0.80, format: 'image/webp' },
  avatar: { maxWidth: 512, quality: 0.80, format: 'image/webp' },
  support: { maxWidth: 1200, quality: 0.75, format: 'image/webp' },
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function optimizeImage(file, preset = 'support', customOptions = {}) {
  const opts = { ...DEFAULTS[preset], ...customOptions };

  const bitmap = await loadImage(URL.createObjectURL(file));

  let { width, height } = bitmap;
  if (width > opts.maxWidth) {
    height = Math.round((height / width) * opts.maxWidth);
    width = opts.maxWidth;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);

  const mimeType = opts.format;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, opts.quality));

  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const optimizedFile = new File([blob], `${baseName}.${ext}`, { type: mimeType });

  const ratio = ((1 - optimizedFile.size / file.size) * 100).toFixed(0);
  if (file.size > 50 * 1024) {
    console.log(`[Optimizer] ${file.name}: ${(file.size / 1024).toFixed(0)}KB → ${(optimizedFile.size / 1024).toFixed(0)}KB (-${ratio}%)`);
  }

  return optimizedFile;
}

export function getOptimizedFileExtension(file) {
  return file.name.split('.').pop() || 'jpg';
}
