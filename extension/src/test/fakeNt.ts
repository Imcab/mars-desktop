// A WebSocket server that speaks just enough NT4 to test a client against.
//
// Shared by the client's own wire tests and by the integration test that drives
// the whole editor path, because both need the same thing: something that
// announces a topic and pushes a binary frame, and that records what it was
// sent so the assertions can look at the actual protocol rather than at a mock.

import { decodeMulti, encode } from '@msgpack/msgpack';
import { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';

/** A server that records what the client sent and can push frames back. */
export class FakeServer {
	private readonly server: WebSocketServer;
	private socket?: WebSocket;

	readonly text: { method: string; params: any }[] = [];
	readonly binary: unknown[][] = [];
	/** The subprotocol the client offered and the server accepted. */
	protocol?: string;
	url?: string;

	private constructor(server: WebSocketServer) {
		this.server = server;
		server.on('connection', (socket, request) => {
			this.socket = socket;
			this.url = request.url;
			this.protocol = socket.protocol;
			socket.on('message', (data, isBinary) => {
				if (isBinary) {
					for (const frame of decodeMulti(data as Buffer)) { this.binary.push(frame as unknown[]); }
				} else {
					for (const message of JSON.parse((data as Buffer).toString('utf8'))) {
						this.text.push(message);
					}
				}
			});
		});
	}

	static async start(): Promise<FakeServer> {
		const server = new WebSocketServer({
			port: 0,
			// An NT4 server picks one of the protocols the client offers; a server
			// that picks none makes the browser-side handshake fail.
			handleProtocols: (protocols) => [...protocols][0] ?? false,
		});
		await new Promise<void>((resolve) => server.once('listening', resolve));
		return new FakeServer(server);
	}

	get port(): number { return (this.server.address() as AddressInfo).port; }

	announce(name: string, id: number, type: string): void {
		this.socket?.send(JSON.stringify([{ method: 'announce', params: { name, id, type, properties: {} } }]));
	}

	value(id: number, typeId: number, value: unknown): void {
		this.socket?.send(encode([id, 0, typeId, value]), { binary: true });
	}

	async close(): Promise<void> {
		this.socket?.close();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}
}


/** Polls until the condition holds, since everything here crosses a socket. */
export async function until(what: string, probe: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!probe()) {
		if (Date.now() > deadline) { throw new Error(`timed out waiting for ${what}`); }
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
