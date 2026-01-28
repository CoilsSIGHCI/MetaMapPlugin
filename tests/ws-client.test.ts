import { WebSocket, WebSocketServer } from "ws";

type RpcRequest = {
	jsonrpc: "2.0";
	id?: number | string;
	method: string;
	params?: unknown;
};

type RpcResponse =
	| { jsonrpc: "2.0"; id: number | string; result: unknown }
	| {
			jsonrpc: "2.0";
			id: number | string;
			error: { code: number; message: string; data?: unknown };
	  };

function once<T>(emitter: NodeJS.EventEmitter, event: string): Promise<T> {
	return new Promise((resolve) => emitter.once(event, resolve));
}

describe("ws client json-rpc", () => {
	let server: WebSocketServer;
	let port: number;

	beforeEach(async () => {
		server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
		await once(server, "listening");
		const address = server.address();
		if (typeof address === "string" || address === null) {
			throw new Error("Unexpected server address");
		}
		port = address.port;

		server.on("connection", (ws) => {
			ws.send(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "hello",
					params: { version: 1 },
				}),
			);

			ws.on("message", (raw) => {
				let msg: RpcRequest | null = null;
				try {
					msg = JSON.parse(raw.toString()) as RpcRequest;
				} catch {
					return;
				}
				if (!msg || msg.jsonrpc !== "2.0" || !msg.method) return;
				if (msg.id === undefined) return;
				const response: RpcResponse = {
					jsonrpc: "2.0",
					id: msg.id,
					result: { ok: true },
				};
				ws.send(JSON.stringify(response));
			});
		});
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	test("receives hello notification and rpc response", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		const messages: Array<RpcRequest | RpcResponse> = [];

		await once(ws, "open");
		ws.on("message", (raw) => {
			try {
				messages.push(JSON.parse(raw.toString()) as RpcRequest);
			} catch {
				// ignore
			}
		});

		ws.send(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "graph.getSnapshot",
				params: {},
			}),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		const hello = messages.find(
			(m) => "method" in m && m.method === "hello",
		);
		const response = messages.find(
			(m) => "result" in m && (m as RpcResponse).id === 1,
		);

		expect(hello).toBeDefined();
		expect(response).toBeDefined();
		ws.close();
	});
});
