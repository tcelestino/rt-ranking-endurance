import * as fs from 'fs';
import * as path from 'path';

export function deleteImagesFiles(imageFiles: string[]) {
  console.log(`Removendo ${imageFiles.length} imagens...`);
  imageFiles.forEach((f) => fs.unlinkSync(f));
  console.log(` ✓ (${imageFiles.length} imagens removidas)`);
}

export function getImageFiles(imagesDir: string): string[] {
  if (!fs.existsSync(imagesDir)) {
    throw new Error(`Pasta "${imagesDir}" não encontrada`);
  }

  const supported = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  return fs
    .readdirSync(imagesDir)
    .filter((f) => supported.includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(imagesDir, f));
}
