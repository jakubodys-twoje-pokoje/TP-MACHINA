/**
 * archiver 8 nie dowozi własnych typów, a @types/archiver opisuje starsze,
 * funkcyjne API (archiver('zip')). Deklarujemy więc tylko to, z czego
 * faktycznie korzystamy.
 */
declare module 'archiver' {
  import type { Writable } from 'node:stream';

  export class ZipArchive {
    constructor(options?: { zlib?: { level: number } });
    on(event: 'error' | 'warning', handler: (error: Error) => void): this;
    pipe(destination: Writable): Writable;
    append(source: Buffer | string, options: { name: string }): this;
    /** Dokłada plik z dysku strumieniowo - bez wciągania go do pamięci. */
    file(path: string, options: { name: string }): this;
    finalize(): Promise<void>;
  }
}
