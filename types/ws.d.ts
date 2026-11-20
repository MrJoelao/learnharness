declare module "ws" {
	import { EventEmitter } from "node:events";

	export default class WebSocket extends EventEmitter {
		static readonly CONNECTING: 0;
		static readonly OPEN: 1;
		static readonly CLOSING: 2;
		static readonly CLOSED: 3;
		readonly readyState: number;
		constructor(address: string, options?: Record<string, unknown>);
		send(data: unknown): void;
		close(code?: number, data?: string): void;
		terminate(): void;
		on(event: "open", listener: () => void): this;
		on(event: "message", listener: (data: unknown) => void): this;
		on(event: "error", listener: (error: Error) => void): this;
		on(event: "close", listener: (code: number, reason: Buffer) => void): this;
		on(event: string, listener: (...args: any[]) => void): this;
	}
}
