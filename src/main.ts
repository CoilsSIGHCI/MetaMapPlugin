import { Plugin, Notice } from "obsidian";
import type { VrRpcSettings } from "./settings";
import { loadSettings, VrRpcSettingTab } from "./settings";
import { WsRpcServer } from "./rpc/wsRpcServer";

export default class VrRpcServerPlugin extends Plugin {
  private rpcServer?: WsRpcServer;
  settings!: VrRpcSettings;

  // version increments when we think graph state might have changed
  private graphVersion = 0;

  async onload() {
    this.settings = await loadSettings(this);
    this.addSettingTab(new VrRpcSettingTab(this.app, this));

    // Keep this configurable later; hard-coded is fine for prototype.
    const port = 8787;
    const host = "0.0.0.0"; // LAN reachable; change if you want localhost only.

    this.rpcServer = new WsRpcServer(this.app, () => this.graphVersion, {
      host,
      port,
      onClientConnected: () => new Notice("Someone connected", 10000),
    });
    this.rpcServer.start();

    // Bump version and notify clients on vault changes.
    // This is intentionally coarse (safe + simple) for a prototype.
    this.registerEvent(
      this.app.vault.on("modify", () => this.bumpGraphVersion()),
    );
    this.registerEvent(
      this.app.vault.on("create", () => this.bumpGraphVersion()),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.bumpGraphVersion()),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.bumpGraphVersion()),
    );

    console.debug(
      `[VR RPC] WebSocket JSON-RPC server listening on ws://${host}:${port}`,
    );
  }

  onunload() {
    this.rpcServer?.stop();
    this.rpcServer = undefined;

    console.debug("[VR RPC] Server stopped");
  }

  private bumpGraphVersion() {
    this.graphVersion += 1;
    this.rpcServer?.notifyAll("graph.changed", { version: this.graphVersion });
  }
}
