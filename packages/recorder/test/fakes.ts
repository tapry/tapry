import type { ChunkTransport, CompletedTrack, StoredChunk } from "../src/types.js";

/** Minimal MediaRecorder stand-in: tests call emit() to simulate timeslice chunks. */
export class FakeMediaRecorder extends EventTarget {
  static supported = new Set(["video/webm;codecs=vp9,opus", "audio/webm;codecs=opus"]);
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type);
  }

  state: "inactive" | "recording" = "inactive";
  timeslice?: number;
  /** Bytes of the final chunk MediaRecorder flushes on stop(); 0 to skip. */
  tailBytes = 0;

  constructor(
    readonly stream: unknown,
    readonly options: MediaRecorderOptions,
  ) {
    super();
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }

  emit(content: string | number) {
    const text = typeof content === "number" ? "x".repeat(content) : content;
    const event = new Event("dataavailable") as Event & { data: Blob };
    event.data = new Blob([text]);
    this.dispatchEvent(event);
  }

  stop() {
    if (this.tailBytes) this.emit(this.tailBytes);
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

export const asMediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
export const fakeStream = {} as MediaStream;

export class FakeTransport implements ChunkTransport {
  uploaded = new Map<string, StoredChunk & { mimeType: string }>();
  completed: CompletedTrack[] = [];
  uploadCalls = 0;
  inflight = 0;
  maxInflight = 0;
  failNext = 0;
  failAll = false;
  failComplete = 0;
  delayMs = 0;

  async uploadChunk(chunk: StoredChunk, mimeType: string) {
    this.uploadCalls++;
    this.inflight++;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    try {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.failAll || this.failNext > 0) {
        this.failNext = Math.max(0, this.failNext - 1);
        throw new Error("network down");
      }
      this.uploaded.set(`${chunk.trackId}/${chunk.seq}`, { ...chunk, mimeType });
    } finally {
      this.inflight--;
    }
  }

  async completeTrack(info: CompletedTrack) {
    if (this.failComplete > 0) {
      this.failComplete--;
      throw new Error("server error");
    }
    this.completed.push(info);
  }
}

export function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export function text(data: ArrayBuffer): string {
  return new TextDecoder().decode(data);
}

/** Let pending promise callbacks (IDB, queue) run. */
export async function flush(times = 20) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
