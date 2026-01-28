import type { App } from "obsidian";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import { WebSocketServer, WebSocket } from "ws";
import { registerRpcMethods, RpcServerParams } from "./methods";
import { rawToText } from "../utils/ws";

export type WsRpcServerOptions = {
  host: string;
  port: number;
  onClientConnected?: () => void;
};

export class WsRpcServer {
  private wss?: WebSocketServer;
  private clients = new Map<
    WebSocket,
    JSONRPCServerAndClient<RpcServerParams, WebSocket>
  >();

  constructor(
    private readonly app: App,
    private readonly getGraphVersion: () => number,
    private readonly options: WsRpcServerOptions,
  ) {}

  start() {
    if (this.wss) return;
    this.wss = new WebSocketServer({
      port: this.options.port,
      host: this.options.host,
    });

    this.wss.on("connection", (ws) => {
      const serverAndClient = this.createServerAndClient(ws);
      this.clients.set(ws, serverAndClient);

      this.options.onClientConnected?.();

      serverAndClient.notify("hello", { version: this.getGraphVersion() }, ws);

      ws.on("close", (code, reason) => {
        const reasonText = reason ? reason.toString() : "";
        serverAndClient.rejectAllPendingRequests(
          `Connection is closed (${code}${reasonText ? `: ${reasonText}` : ""}).`,
        );
        this.clients.delete(ws);
      });

      ws.on("message", (raw) => {
        console.debug("Received message:", raw);
        const text = rawToText(raw);
        if (!text) return;
        let payload: unknown;
        try {
          payload = JSON.parse(text);
          console.debug("Parsed payload:", payload);
        } catch {
          return;
        }
        void serverAndClient
          .receiveAndSend(payload, this.serverParams(), ws)
          .catch(() => {});
      });
    });
  }

  stop() {
    for (const [ws, serverAndClient] of this.clients) {
      try {
        serverAndClient.rejectAllPendingRequests("Connection closed.");
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();

    try {
      this.wss?.close();
    } catch {
      /* ignore */
    }
    this.wss = undefined;
  }

  notifyAll(method: string, params: unknown) {
    for (const [ws, serverAndClient] of this.clients) {
      serverAndClient.notify(method, params, ws);
    }
  }

  private createServerAndClient(
    ws: WebSocket,
  ): JSONRPCServerAndClient<RpcServerParams, WebSocket> {
    const server = new JSONRPCServer<RpcServerParams>();
    const client = new JSONRPCClient<WebSocket>((request, socket) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Socket is not open"));
      }
      socket.send(JSON.stringify(request));
      return Promise.resolve();
    });

    const serverAndClient = new JSONRPCServerAndClient(server, client);
    registerRpcMethods(serverAndClient);
    return serverAndClient;
  }

  private serverParams(): RpcServerParams {
    return { app: this.app, getGraphVersion: this.getGraphVersion };
  }
}
