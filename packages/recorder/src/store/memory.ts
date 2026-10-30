import type { ChunkMeta, ChunkStore, StoredChunk, TrackInfo } from "../types.js";

/** Non-durable store. For tests, and as a last resort when IndexedDB is unavailable. */
export class MemoryChunkStore implements ChunkStore {
  private tracks = new Map<string, TrackInfo>();
  private chunks = new Map<string, StoredChunk>();

  async putTrack(info: TrackInfo) {
    this.tracks.set(trackKey(info.sessionId, info.trackId), { ...info });
  }

  async getTrack(sessionId: string, trackId: string) {
    const t = this.tracks.get(trackKey(sessionId, trackId));
    return t && { ...t };
  }

  async listTracks() {
    return [...this.tracks.values()].map((t) => ({ ...t }));
  }

  async deleteTrack(sessionId: string, trackId: string) {
    this.tracks.delete(trackKey(sessionId, trackId));
    const prefix = trackKey(sessionId, trackId) + "\u0000";
    for (const k of this.chunks.keys()) if (k.startsWith(prefix)) this.chunks.delete(k);
  }

  async putChunk(meta: ChunkMeta, data: ArrayBuffer) {
    this.chunks.set(chunkKey(meta.sessionId, meta.trackId, meta.seq), { ...meta, data });
  }

  async getChunk(sessionId: string, trackId: string, seq: number) {
    const c = this.chunks.get(chunkKey(sessionId, trackId, seq));
    return c && { ...c };
  }

  async listChunks(sessionId: string, trackId: string) {
    const prefix = trackKey(sessionId, trackId) + "\u0000";
    const out: ChunkMeta[] = [];
    for (const [k, { data: _data, ...meta }] of this.chunks) if (k.startsWith(prefix)) out.push(meta);
    return out.sort((a, b) => a.seq - b.seq);
  }

  async deleteChunk(sessionId: string, trackId: string, seq: number) {
    this.chunks.delete(chunkKey(sessionId, trackId, seq));
  }
}

const trackKey = (s: string, t: string) => `${s}\u0000${t}`;
const chunkKey = (s: string, t: string, seq: number) => `${s}\u0000${t}\u0000${seq}`;
