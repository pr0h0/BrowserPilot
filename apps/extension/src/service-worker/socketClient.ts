import type { ConnectionStatus } from "../shared/types.js";
import { getSettings } from "../shared/browserApi.js";
import { dispatchCommand } from "./commandHandlers.js";
import { enabledTabs } from "./storage.js";

const CAPABILITIES = ["tabs", "scripting", "screenshots", "page-extract", "element-picker", "basic-console", "basic-actions", "ai-chat"];

export class SocketClient {
  private ws: WebSocket | null = null;
  private manualClose = false;
  private backoff = 1000;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: ConnectionStatus["state"] = "disconnected";
  private sessionId?: string;
  private lastError?: string;
  private backendUrl = "";
  private browserId = "";
  private browserName = "";

  constructor(private onStatus: (s: ConnectionStatus) => void) {}

  status(): ConnectionStatus {
    return { state: this.state, backendUrl: this.backendUrl, browserId: this.browserId, browserName: this.browserName, sessionId: this.sessionId, lastError: this.lastError, enabledTabs: enabledTabs() };
  }
  private emit() { this.onStatus(this.status()); }

  async connect() {
    this.manualClose = false;
    const s = await getSettings();
    this.backendUrl = s.backendUrl; this.browserId = s.browserId; this.browserName = s.browserName;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.state = "connecting"; this.lastError = undefined; this.emit();
    let ws: WebSocket;
    try { ws = new WebSocket(s.backendUrl); }
    catch (e) { this.lastError = String(e); this.state = "disconnected"; this.emit(); this.scheduleReconnect(); return; }
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", browserId: s.browserId, browserName: s.browserName, extensionVersion: "0.1.0", token: s.pairingToken || undefined, capabilities: CAPABILITIES }));
    };
    ws.onmessage = (ev) => this.onMessage(String(ev.data));
    ws.onerror = () => { this.lastError = "WebSocket error"; };
    ws.onclose = () => {
      this.stopHeartbeat();
      this.state = "disconnected"; this.sessionId = undefined; this.emit();
      if (!this.manualClose) this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.state = "disconnected"; this.sessionId = undefined; this.emit();
  }

  sendEvent(event: "console" | "network", data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "event", event, data }));
  }

  private async onMessage(raw: string) {
    let msg: any; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "hello.ack") {
      if (msg.ok) { this.state = "connected"; this.sessionId = msg.sessionId; this.backoff = 1000; this.startHeartbeat(); }
      else { this.lastError = msg.error ?? "rejected"; this.manualClose = true; this.disconnect(); }
      this.emit();
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "command" && msg.command) {
      const response = await dispatchCommand(msg.command);
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(response));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
    }, 20_000);
  }
  private stopHeartbeat() { if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; } }

  private scheduleReconnect() {
    if (this.manualClose) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
