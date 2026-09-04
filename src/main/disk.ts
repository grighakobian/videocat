import { statfs } from 'node:fs/promises'
import type { DiskSpace } from '@shared/types'

/** Free/total bytes on the volume holding `path`. Null if the path is unreadable. */
export async function readDiskSpace(path: string): Promise<DiskSpace | null> {
  try {
    const stats = await statfs(path)
    return {
      freeBytes: Number(stats.bavail) * Number(stats.bsize),
      totalBytes: Number(stats.blocks) * Number(stats.bsize)
    }
  } catch {
    return null
  }
}
