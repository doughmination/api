/* =====================================================================
 * gateway.ts — GatewayManager Durable Object.
 *
 * A single DO instance:
 *   • holds ONE Discord gateway WebSocket (identify / heartbeat / resume),
 *   • ingests presences from READY/GUILD_CREATE/PRESENCE_UPDATE,
 *   • keeps an in-memory userId -> UnifiedPresence map,
 *   • relays each live PRESENCE_UPDATE to the SystemState DO, which is the
 *     single browser-facing realtime hub (/v2/ws). This DO no longer accepts
 *     browser sockets of its own.
 *
 * State is in-memory: if the DO is evicted the gateway reconnects (via cron
 * or alarm) and GUILD_CREATE repopulates presences within a second or two.
 * ===================================================================== */

import type { Env, UnifiedPresence } from "./types";
import { INTENTS, Op } from "./discord/constants";
import { buildPresence, type RawPresence } from "./presence";

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

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ---- HTTP surface (called by the Worker) -----------------------------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

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
    if (broadcast) this.relayPresence(presence);
  }

  /** Push a live presence update to the SystemState DO, which fans it out to
   *  the browser clients subscribed to that user over /v2/ws. Fire-and-forget:
   *  a failed relay just means one dropped frame, corrected on the next update
   *  or on the next subscribe's INIT_STATE snapshot. */
  private relayPresence(presence: UnifiedPresence): void {
    try {
      const stub = this.env.SYSTEM.get(this.env.SYSTEM.idFromName("system"));
      stub
        .fetch("https://do/internal/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(presence),
        })
        .catch(() => {
          /* dropped frame; ignore */
        });
    } catch {
      /* binding unavailable; ignore */
    }
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
        presence: {
          status: "idle",
          afk: false,
          since: 0,
          // Custom status (type 4): the text shown is the `state` field.
          activities: [{ name: "Custom Status", type: 4, state: "meow meow mrrp meow" }],
        },
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
}
