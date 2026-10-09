import { gzipSync } from 'node:zlib';

/** Build a minimal ustar header for a regular-file entry. */
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'utf8');
  header.write('0', 156, 'utf8'); // typeflag: regular file
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');
  header.fill(' ', 148, 156); // checksum field counts as spaces while summing
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8');
  return header;
}

/** Build a gzipped npm-style tarball from `[entryName, content]` pairs. */
export function makeTarball(entries: Array<[string, Buffer]>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, content] of entries) {
    parts.push(tarHeader(name, content.length), content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024)); // end-of-archive
  return gzipSync(Buffer.concat(parts));
}
