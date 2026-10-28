import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Journal, Snapshot } from './safety';
import { z } from 'zod';
export class FileJournal implements Journal {
  constructor(private directory: string) {}
  async claim(id: string) {
    z.uuid().parse(id);
    await mkdir(join(this.directory,'claims'), { recursive: true, mode: 0o700 });
    try { const file = await open(join(this.directory,'claims',id), 'wx',0o600); await file.sync(); await file.close(); return true; }
    catch(e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
  }
  async save(snapshot: Snapshot) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory,'snapshot.tmp');
    const file = await open(temporary,'w',0o600);
    try { await file.writeFile(JSON.stringify(snapshot)); await file.sync(); } finally { await file.close(); }
    await rename(temporary,join(this.directory,'snapshot.json'));
  }
  async load(): Promise<Snapshot | null> {
    try { return JSON.parse(await readFile(join(this.directory,'snapshot.json'),'utf8')); }
    catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
}
