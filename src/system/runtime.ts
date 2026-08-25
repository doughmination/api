/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Per-Durable-Object runtime holder.
 *
 * The old Express backend was a long-lived process with a filesystem and a
 * global WebSocket manager. On the Worker, all of that now lives inside a
 * single `SystemState` Durable Object instance. Because a DO is a single
 * isolate with exactly one live instance, a module-level singleton set in
 * the DO constructor is safe and lets the ported services keep almost the
 * same shape they had against `node:fs` — they just read `rt().store`
 * instead of reading files.
 */

import type { SystemEnv } from "./types";

/** Minimal blob store — the KV-ish replacement for the old JSON data files. */
export interface Store {
  get<T>(key: string, fallback: T): Promise<T>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SysRuntime {
  env: SystemEnv;
  store: Store;
  /** DO SQLite handle, used by the site visit counters. */
  sql: SqlStorage;
  /** Broadcast a JSON-serialisable payload to every connected /ws client. */
  broadcast(data: unknown): void;
}

let _rt: SysRuntime | null = null;

export function setRuntime(rt: SysRuntime): void {
  _rt = rt;
}

export function rt(): SysRuntime {
  if (!_rt) {
    throw new Error("system runtime not initialised (SystemState DO not constructed)");
  }
  return _rt;
}
