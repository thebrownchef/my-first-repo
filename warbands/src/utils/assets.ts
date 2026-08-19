const images = import.meta.glob('../assets/**/*.{png,svg}', { eager: true });

export function getAssetUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  
  let globKey = path;
  if (path.startsWith('/assets/')) {
    globKey = '../assets/' + path.slice(8);
  } else if (path.startsWith('assets/')) {
    globKey = '../assets/' + path.slice(7);
  } else if (!path.startsWith('../assets/')) {
    globKey = '../assets/' + path;
  }

  const asset = images[globKey] as { default: string } | undefined;
  return asset?.default;
}
