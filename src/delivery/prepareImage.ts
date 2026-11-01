import { IMAGE_LADDER, IMAGE_TARGET_BYTES, MAX_IMAGE_BYTES } from '../config';
import { PermanentError } from './errors';
import type { FileSystem, ImageProcessor } from './ports';
import type { PreparedImage, SourceImage } from './types';

const isJpeg = (mime: string) => mime === 'image/jpeg' || mime === 'image/jpg';

/** Returns a JPEG under the size limit, re-encoding only when it has to. */
export async function prepareImage(
  source: SourceImage,
  outputPath: string,
  workDir: string,
  fs: FileSystem,
  images: ImageProcessor,
): Promise<PreparedImage> {
  if (!(await fs.exists(source.path))) {
    throw new PermanentError('A photo in this report is missing from the phone’s storage.');
  }

  const longEdge = Math.max(source.width, source.height);
  const fitsAsIs =
    isJpeg(source.mime) && source.bytes <= IMAGE_TARGET_BYTES && longEdge > 0 && longEdge <= IMAGE_LADDER[0].maxEdge;

  if (fitsAsIs) {
    await fs.copy(source.path, outputPath);
    return finish(outputPath, source.width, source.height, fs);
  }

  await fs.mkdir(workDir);
  for (const step of IMAGE_LADDER) {
    let result;
    try {
      result = await images.resizeJpeg(source.path, step.maxEdge, step.quality, workDir);
    } catch (err) {
      throw new PermanentError(`A photo in this report couldn’t be read (${(err as Error).message}).`);
    }
    if (result.bytes <= IMAGE_TARGET_BYTES) {
      await fs.move(result.path, outputPath);
      return finish(outputPath, result.width, result.height, fs);
    }
    await fs.remove(result.path);
  }
  throw new PermanentError('A photo couldn’t be made small enough to send.');
}

async function finish(path: string, width: number, height: number, fs: FileSystem): Promise<PreparedImage> {
  // Trust the file on disk, not the encoder's report of it.
  const bytes = await fs.size(path);
  if (bytes > MAX_IMAGE_BYTES) {
    await fs.remove(path);
    throw new PermanentError('A photo came out over the 5 MB limit.');
  }
  return { path, bytes, width, height, sha256: await fs.sha256(path) };
}
