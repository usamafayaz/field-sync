import * as RNFS from '@dr.pogodin/react-native-fs';
import type { FileSystem } from '../delivery/ports';

const strip = (p: string) => p.replace(/^file:\/\//, '');

export const nativeFileSystem: FileSystem = {
  documentDir: RNFS.DocumentDirectoryPath,

  exists: path => RNFS.exists(strip(path)),

  mkdir: async path => {
    await RNFS.mkdir(strip(path));
  },

  readText: path => RNFS.readFile(strip(path), 'utf8'),

  writeTextAtomic: async (path, content) => {
    // rename() is atomic: a crash leaves the old file or the new one, never half.
    const tmp = `${strip(path)}.tmp`;
    await RNFS.writeFile(tmp, content, 'utf8');
    await RNFS.moveFile(tmp, strip(path));
  },

  readChunk: (path, length, position) => RNFS.read(strip(path), length, position, 'ArrayBuffer'),

  copy: async (from, to) => {
    const dest = strip(to);
    if (await RNFS.exists(dest)) await RNFS.unlink(dest);
    // Picker results can be content:// URIs; RNFS copies those natively.
    await RNFS.copyFile(from.startsWith('content://') ? from : strip(from), dest);
  },

  move: async (from, to) => {
    await RNFS.moveFile(strip(from), strip(to));
  },

  remove: async path => {
    const p = strip(path);
    if (await RNFS.exists(p)) await RNFS.unlink(p);
  },

  size: async path => Number((await RNFS.stat(strip(path))).size),

  sha256: path => RNFS.hash(strip(path), 'sha256'),

  list: async dir => {
    const p = strip(dir);
    if (!(await RNFS.exists(p))) return [];
    return (await RNFS.readDir(p)).map(e => e.name);
  },
};

export const cachesDir = RNFS.CachesDirectoryPath;
