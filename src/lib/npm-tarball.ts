import { gunzipSync } from 'node:zlib';

/**
 * Extract a single entry from a gzipped npm package tarball. Shared by the two
 * runtime-download paths (agent-sdk-assets.ts and runtime-assets.ts).
 *
 * Minimal ustar reader: npm tarballs are flat `package/…` archives well within
 * ustar limits, so pax/GNU long-name extensions never apply to the entries we
 * want — unknown entry types are skipped by the generic size-based walk.
 *
 * `maxUncompressedBytes` caps gunzip output so a compromised or corrupted
 * response can't expand a gzip bomb in memory before the caller's checksum
 * gate gets a chance to reject it.
 */
export function extractTarEntry(tarGz: Buffer, entryName: string, maxUncompressedBytes: number): Buffer {
  const raw = gunzipSync(tarGz, { maxOutputLength: maxUncompressedBytes });
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim(), 8);
    if (Number.isNaN(size) || size < 0) {
      throw new Error(`Malformed tar header at offset ${offset}`);
    }
    const dataStart = offset + 512;
    if (fullName === entryName) {
      if (dataStart + size > raw.length) {
        throw new Error(`Truncated tar entry ${entryName}`);
      }
      return Buffer.from(raw.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Entry ${entryName} not found in tarball`);
}
