/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * SystemState — the Durable Object that IS the old backend "process".
 *
 *  - Holds all persistent state (users, tags, statuses, battery, mental
 *    state) in DO key-value storage via a small Store adapter.
 *  - Owns the visitor-log SQLite table (DO embedded SQLite).
 *  - Is the SINGLE realtime WebSocket hub for the whole API, at /v2/ws,
 *    using the hibernatable WebSocket API so idle sockets don't keep the DO
 *    billed/awake. Every live update — presence, fronting, mental state,
 *    device/battery, force-refresh — is delivered over this one socket as a
 *    { type, data } envelope.
 *  - Delegates all HTTP to the Hono `systemApp`.
 *
 * Presence lives in the GatewayManager DO (which owns the Discord gateway
 * connection). Rather than expose a second browser-facing socket there, that
 * DO relays each PRESENCE_UPDATE to us at POST /internal/presence, and we fan
 * it out to the clients subscribed to that user. INIT_STATE snapshots are
 * pulled from GatewayManager (GET /presences) on subscribe.
 *
 * A single instance is used (idFromName("system")), so the module-level
 * runtime set in the constructor is safe.
 */

import type { SystemEnv } from "./types";
import type { UnifiedPresence } from "../types";
import { setRuntime, type Store } from "./runtime";
import { systemApp } from "./app";
import { deleteUnverifiedUsers } from "./services/users";
import { UNVERIFIED_ACCOUNT_TTL_HOURS } from "./config";

class DoStore implements Store {
  constructor(private storage: DurableObjectStorage) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const value = await this.storage.get<T>(key);
    return value ?? fallback;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.storage.put(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}

/** The single realtime socket path. */
const WS_PATH = "/v2/ws";
/** Internal DO-to-DO path GatewayManager relays presence updates to. */
const PRESENCE_RELAY_PATH = "/internal/presence";
/** Internal cron entrypoint — sweeps unconfirmed signups. */
const MAINTENANCE_PATH = "/internal/maintenance";

/** Per-socket presence subscription, persisted on the hibernatable socket via
 *  serializeAttachment so it survives eviction. Presence events are filtered
 *  by this; all other event types go to every client regardless. */
interface Sub {
  /** Subscribed to every tracked user's presence. */
  all: boolean;
  /** Specific user ids this socket wants presence for. */
  ids: string[];
}

const EMPTY_SUB: Sub = { all: false, ids: [] };

export class SystemState implements DurableObject {
  private state: DurableObjectState;
  private env: SystemEnv;

  constructor(state: DurableObjectState, env: SystemEnv) {
    this.state = state;
    this.env = env;
    setRuntime({
      env,
      store: new DoStore(state.storage),
      sql: state.storage.sql,
      broadcast: (data) => this.broadcast(data),
    });

    // Ping/pong keepalive without waking the DO from hibernation.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === WS_PATH) {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      return this.handleWsUpgrade();
    }

    // Scheduled maintenance, driven by the Worker's cron trigger. Internal
    // only — the public router never forwards this path.
    if (url.pathname === MAINTENANCE_PATH && req.method === "POST") {
      const removed = await deleteUnverifiedUsers(UNVERIFIED_ACCOUNT_TTL_HOURS);
      if (removed.length) {
        console.info(
          `Maintenance: removed ${removed.length} unconfirmed account(s): ${removed.join(", ")}`,
        );
      }
      return Response.json({ removed_unverified: removed.length });
    }

    // Presence relay from GatewayManager (DO-to-DO, never reaches here via the
    // public Worker router).
    if (url.pathname === PRESENCE_RELAY_PATH && req.method === "POST") {
      const presence = (await req.json().catch(() => null)) as UnifiedPresence | null;
      if (presence?.user_id) this.broadcastPresence(presence);
      return new Response(null, { status: 204 });
    }

    return systemApp.fetch(req, {} as never);
  }

  private handleWsUpgrade(): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernatable accept — the DO can be evicted while sockets stay open.
    this.state.acceptWebSocket(server);
    // Start with no presence subscription; the client opts in by sending a
    // { type: "subscribe" } message. Fronting / mental-state / device events
    // are still delivered without any subscription.
    server.serializeAttachment(EMPTY_SUB);

    try {
      server.send(
        JSON.stringify({
          type: "connection_established",
          timestamp: new Date().toISOString(),
          message: "WebSocket connected successfully",
        }),
      );
    } catch {
      // ignore send failure on a just-opened socket
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- Hibernation WebSocket handlers -------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : "";
    if (raw === "ping") {
      ws.send("pong");
      return;
    }

    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore non-JSON frames
    }

    if (msg?.type === "subscribe") {
      await this.handleSubscribe(ws, msg);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code, "closing");
    } catch {
      // already closed
    }
  }

  webSocketError(): void {
    // no-op; the runtime cleans the socket up
  }

  // ---- presence subscription ----------------------------------------------

  /** Accepts { type:"subscribe", all:true } or { type:"subscribe", ids:[...] }.
   *  Also tolerates the Lanyard-ish aliases subscribe_to_all / subscribe_to_id
   *  / subscribe_to_ids so older callers keep working. Replies with an
   *  init_state snapshot of the requested presences. */
  private async handleSubscribe(ws: WebSocket, msg: any): Promise<void> {
    const sub: Sub = { all: false, ids: [] };

    if (msg.all === true || msg.subscribe_to_all === true) {
      sub.all = true;
    } else {
      const ids = new Set<string>();
      if (typeof msg.subscribe_to_id === "string") ids.add(msg.subscribe_to_id);
      for (const list of [msg.ids, msg.subscribe_to_ids]) {
        if (Array.isArray(list)) for (const id of list) if (typeof id === "string") ids.add(id);
      }
      sub.ids = [...ids];
    }

    ws.serializeAttachment(sub);

    const presences = await this.fetchPresences();
    let data: Record<string, UnifiedPresence>;
    if (sub.all) {
      data = presences;
    } else {
      data = {};
      for (const id of sub.ids) if (presences[id]) data[id] = presences[id];
    }

    try {
      ws.send(JSON.stringify({ type: "init_state", data }));
    } catch {
      // socket went away mid-subscribe
    }
  }

  /** Pull the current presence map from the GatewayManager DO. This also wakes
   *  / keeps the Discord gateway connected (the /presences handler ensures it). */
  private async fetchPresences(): Promise<Record<string, UnifiedPresence>> {
    try {
      const stub = this.env.GATEWAY.get(this.env.GATEWAY.idFromName("gateway"));
      const res = await stub.fetch("https://do/presences");
      if (!res.ok) return {};
      return (await res.json()) as Record<string, UnifiedPresence>;
    } catch {
      return {};
    }
  }

  // ---- fan-out ------------------------------------------------------------

  /** Fan a { type, data } payload out to EVERY connected client. Used for
   *  fronting / mental-state / device / force_refresh events. */
  private broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // drop dead sockets silently
      }
    }
  }

  /** Fan a presence update out only to clients subscribed to that user. */
  private broadcastPresence(presence: UnifiedPresence): void {
    const message = JSON.stringify({ type: "presence_update", data: presence });
    for (const ws of this.state.getWebSockets()) {
      const sub = (ws.deserializeAttachment() as Sub | null) ?? EMPTY_SUB;
      if (!sub.all && !sub.ids.includes(presence.user_id)) continue;
      try {
        ws.send(message);
      } catch {
        // drop dead sockets silently
      }
    }
  }
}
