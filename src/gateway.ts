/* =====================================================================
 * gateway.ts — GatewayManager Durable Object.
 *
 * A single DO instance:
 *   • holds ONE Discord gateway WebSocket (identify / heartbeat / resume),
 *   • ingests presences from READY/GUILD_CREATE/PRESENCE_UPDATE,
 *   • keeps an in-memory userId -> UnifiedPresence map,
 *   • accepts browser WebSockets and speaks the Lanyard socket protocol
 *     (op1 Hello, op2 Initialize, op3 Heartbeat, op0 INIT_STATE/PRESENCE_UPDATE),
 *   • broadcasts PRESENCE_UPDATE to subscribed clients.
 *
 * State is in-memory: if the DO is evicted the gateway reconnects (via cron
 * or alarm) and GUILD_CREATE repopulates presences within a second or two.
 * ===================================================================== */

import type { Env, UnifiedPresence } from "./types";
import { INTENTS, Op } from "./discord/constants";
import { buildPresence, offlinePresence, type RawPresence } from "./presence";

const CLIENT_HEARTBEAT_INTERVAL = 30_000;

interface ClientSub {
  all: boolean;
  ids: Set<string>;
}

export class GatewayManager implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  private discord: WebSocket | null = null;
  private connecting = false;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private reconnectAttempts = 0;
  private lastCloseCode: number | null = null;
  private connectedSince: number | null = null;

  private presences = new Map<string, UnifiedPresence>();
  private clients = new Map<WebSocket, ClientSub>();
  private dispatchSeq = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ---- HTTP surface (called by the Worker) -----------------------------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      return this.handleClientUpgrade(req);
    }

    // Ensure the gateway is connected (cron / on-demand).
    await this.ensureConnected();
    await this.ensureAlarm();

    if (url.pathname === "/connect") {
      return Response.json({ connected: !!this.discord, tracked: this.presences.size });
    }
    if (url.pathname === "/status") {
      return Response.json({
        connected: !!this.discord,
        tracked: this.presences.size,
        connected_since: this.connectedSince,
        last_close_code: this.lastCloseCode,
        reconnect_attempts: this.reconnectAttempts,
        has_session: !!this.sessionId,
      });
    }
    if (url.pathname === "/presences") {
      return Response.json(Object.fromEntries(this.presences));
    }
    if (url.pathname.startsWith("/presence/")) {
      const id = url.pathname.slice("/presence/".length);
      const p = this.presences.get(id);
      return Response.json({ monitored: !!p, presence: p ?? null });
    }
    return new Response("not found", { status: 404 });
  }

  // The alarm is a keepalive backstop in case cron is delayed.
  async alarm(): Promise<void> {
    await this.ensureConnected();
    await this.ensureAlarm();
  }

  private async ensureAlarm(): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    if (existing == null) {
      await this.state.storage.setAlarm(Date.now() + 45_000);
    }
  }

  // ---- Discord gateway connection --------------------------------------
  private async ensureConnected(): Promise<void> {
    if (this.discord || this.connecting) return;
    this.connecting = true;
    try {
      const base = this.resumeUrl ?? "https://gateway.discord.gg";
      const wsUrl = base.replace(/^wss:\/\//, "https://") + "/?v=10&encoding=json";
      const resp = await fetch(wsUrl, { headers: { Upgrade: "websocket" } });
      const ws = resp.webSocket;
      if (!ws) throw new Error(`no webSocket on gateway response (status ${resp.status})`);
      ws.accept();
      this.discord = ws;
      this.heartbeatAcked = true;

      ws.addEventListener("message", (e) => this.onDiscordMessage(e));
      ws.addEventListener("close", (e) => this.onDiscordClose(e.code, e.reason));
      ws.addEventListener("error", () => this.onDiscordClose(1006, "error"));
    } catch (err) {
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private onDiscordMessage(e: MessageEvent): void {
    let msg: any;
    try {
      msg = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
    } catch {
      return;
    }
    if (typeof msg.s === "number") this.seq = msg.s;

    switch (msg.op) {
      case Op.Hello:
        this.startHeartbeat(msg.d.heartbeat_interval);
        if (this.sessionId && this.seq != null) this.sendResume();
        else this.sendIdentify();
        break;
      case Op.Heartbeat:
        this.sendHeartbeat();
        break;
      case Op.HeartbeatAck:
        this.heartbeatAcked = true;
        break;
      case Op.Reconnect:
        this.reconnect(true);
        break;
      case Op.InvalidSession:
        // d === true means the session is resumable.
        this.sessionId = msg.d === true ? this.sessionId : null;
        this.seq = msg.d === true ? this.seq : null;
        setTimeout(() => this.reconnect(msg.d === true), 1500 + Math.random() * 3500);
        break;
      case Op.Dispatch:
        this.onDispatch(msg.t, msg.d);
        break;
    }
  }

  private onDispatch(t: string, d: any): void {
    switch (t) {
      case "READY":
        this.sessionId = d.session_id ?? null;
        this.resumeUrl = d.resume_gateway_url ?? null;
        this.reconnectAttempts = 0;
        this.lastCloseCode = null;
        this.connectedSince = Date.now();
        break;
      case "RESUMED":
        this.reconnectAttempts = 0;
        break;
      case "GUILD_CREATE": {
        const guildOk = this.guildTracked(d.id);
        if (guildOk && Array.isArray(d.presences)) {
          for (const p of d.presences) {
            if (p?.user?.id) this.applyPresence(p as RawPresence, false);
          }
        }
        break;
      }
      case "PRESENCE_UPDATE":
        if (this.guildTracked(d.guild_id) && d?.user?.id) {
          this.applyPresence(d as RawPresence, true);
        }
        break;
    }
  }

  private guildTracked(guildId: string | undefined): boolean {
    const raw = (this.env.TRACKED_GUILD_IDS || "").trim();
    if (!raw) return true; // empty == track every guild the bot can see
    if (!guildId) return false;
    return raw.split(",").map((s) => s.trim()).includes(guildId);
  }

  private applyPresence(raw: RawPresence, broadcast: boolean): void {
    const presence = buildPresence(raw);
    this.presences.set(presence.user_id, presence);
    if (broadcast) this.broadcast(presence);
  }

  // ---- heartbeat / identify / resume -----------------------------------
  private startHeartbeat(interval: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcked) {
        // Zombied connection — force a reconnect.
        this.reconnect(true);
        return;
      }
      this.heartbeatAcked = false;
      this.sendHeartbeat();
    }, interval);
  }

  private sendHeartbeat(): void {
    this.send({ op: Op.Heartbeat, d: this.seq });
  }

  private sendIdentify(): void {
    this.send({
      op: Op.Identify,
      d: {
        token: this.env.DISCORD_BOT_TOKEN,
        intents: INTENTS,
        properties: { os: "linux", browser: "dough-restful", device: "dough-restful" },
        presence: { status: "invisible", activities: [], since: 0, afk: false },
      },
    });
  }

  private sendResume(): void {
    this.send({
      op: Op.Resume,
      d: { token: this.env.DISCORD_BOT_TOKEN, session_id: this.sessionId, seq: this.seq },
    });
  }

  private send(payload: unknown): void {
    try {
      this.discord?.send(JSON.stringify(payload));
    } catch {
      /* socket gone; close handler will reconnect */
    }
  }

  // ---- reconnection ----------------------------------------------------
  private onDiscordClose(code: number, _reason: string): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.discord = null;
    this.lastCloseCode = code;
    this.connectedSince = null;
    // 4004/4010/4011/4013/4014 = fatal (bad token/intents) — don't hammer.
    const fatal = [4004, 4010, 4011, 4012, 4013, 4014].includes(code);
    if (fatal) {
      this.sessionId = null;
      this.seq = null;
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    setTimeout(() => this.ensureConnected(), delay + Math.random() * 1000);
  }

  private reconnect(resumable: boolean): void {
    if (!resumable) {
      this.sessionId = null;
      this.seq = null;
    }
    try {
      this.discord?.close(4000, "reconnecting");
    } catch {
      /* ignore */
    }
    this.discord = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    setTimeout(() => this.ensureConnected(), 500);
  }

  // ---- browser client sockets (Lanyard protocol) -----------------------
  private handleClientUpgrade(req: Request): Response {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.clients.set(server, { all: false, ids: new Set() });

    server.send(JSON.stringify({ op: 1, d: { heartbeat_interval: CLIENT_HEARTBEAT_INTERVAL } }));

    server.addEventListener("message", (e) => this.onClientMessage(server, e));
    server.addEventListener("close", () => this.clients.delete(server));
    server.addEventListener("error", () => this.clients.delete(server));

    // Make sure the gateway is alive once someone is listening.
    this.ensureConnected();

    return new Response(null, { status: 101, webSocket: client });
  }

  private onClientMessage(socket: WebSocket, e: MessageEvent): void {
    let msg: any;
    try {
      msg = JSON.parse(typeof e.data === "string" ? e.data : "");
    } catch {
      socket.close(4006, "invalid_payload");
      return;
    }
    if (msg.op === 3) return; // client heartbeat — nothing to ack

    if (msg.op === 2) {
      const d = msg.d || {};
      const sub: ClientSub = { all: false, ids: new Set() };
      if (d.subscribe_to_all === true) {
        sub.all = true;
      } else if (typeof d.subscribe_to_id === "string") {
        sub.ids.add(d.subscribe_to_id);
      } else if (Array.isArray(d.subscribe_to_ids)) {
        for (const id of d.subscribe_to_ids) if (typeof id === "string") sub.ids.add(id);
      } else {
        socket.close(4005, "requires_data_object");
        return;
      }
      this.clients.set(socket, sub);
      this.sendInitState(socket, sub, typeof d.subscribe_to_id === "string" ? d.subscribe_to_id : null);
      return;
    }

    socket.close(4004, "unknown_opcode");
  }

  private sendInitState(socket: WebSocket, sub: ClientSub, singleId: string | null): void {
    let data: unknown;
    if (singleId) {
      data = this.presences.get(singleId) ?? offlinePresence(singleId);
    } else if (sub.all) {
      data = Object.fromEntries(this.presences);
    } else {
      const map: Record<string, UnifiedPresence> = {};
      for (const id of sub.ids) map[id] = this.presences.get(id) ?? offlinePresence(id);
      data = map;
    }
    socket.send(JSON.stringify({ op: 0, seq: ++this.dispatchSeq, t: "INIT_STATE", d: data }));
  }

  private broadcast(presence: UnifiedPresence): void {
    const payload = JSON.stringify({
      op: 0,
      seq: ++this.dispatchSeq,
      t: "PRESENCE_UPDATE",
      d: presence,
    });
    for (const [socket, sub] of this.clients) {
      if (sub.all || sub.ids.has(presence.user_id)) {
        try {
          socket.send(payload);
        } catch {
          this.clients.delete(socket);
        }
      }
    }
  }
}
