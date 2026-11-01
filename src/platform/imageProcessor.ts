import ImageResizer from '@bam.tech/react-native-image-resizer';
import type { ImageProcessor } from '../delivery/ports';

export const nativeImageProcessor: ImageProcessor = {
  async resizeJpeg(sourcePath, maxEdge, quality, outputDir) {
    const uri = sourcePath.startsWith('file://') ? sourcePath : `file://${sourcePath}`;
    // Decoding is subsampled and EXIF rotation is applied, natively, off the JS thread.
    const r = await ImageResizer.createResizedImage(uri, maxEdge, maxEdge, 'JPEG', quality, 0, outputDir, false, {
      mode: 'contain',
      onlyScaleDown: true,
    });
    return { path: r.path, bytes: r.size, width: r.width, height: r.height };
  },
};
