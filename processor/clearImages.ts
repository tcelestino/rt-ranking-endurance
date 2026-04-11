import * as path from 'path';
import { getImageFiles, deleteImagesFiles } from './imageFiles';

function main() {
  const imagesDir = path.resolve('images');
  const imageFiles = getImageFiles(imagesDir);

  if (imageFiles.length === 0) {
    console.log('Nenhuma imagem encontrada em images/');
    return;
  }

  deleteImagesFiles(imageFiles);
}

main();
