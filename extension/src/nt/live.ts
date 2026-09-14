// Live NetworkTables values, in the editor, next to the lines that publish them.
//
// The gap this closes is small to describe and large in practice. A MARS
// project's source says what a topic is called and what it is initialised to;
// the dashboard says what it currently is. Answering "is this tunable actually
// what I set it to" means holding both in your head, in two windows, with the
// name of the topic as the only thing connecting them -- and the name is not
// even written in one place, since it is the subsystem's key plus the
// annotation's key. So: put the value on the line.
//
// What is deliberately not here is a second dashboard. There are no graphs, no
// history and no log playback: those are what MARS Desktop is for, and an
// editor that grew them would be a worse version of it. This shows the number
// beside the declaration, and nothing else.

import * as vscode from 'vscode';
import { MarsWorkspace } from '../project';
import { TopicDecl, topicPath } from '../scan/model';
import { ConnectionState, NT4Client, NtValue, Target, teamAddress } from './client';

/** How long to sit on a burst of values before redrawing. */
const REDRAW_INTERVAL = 200;

/** The ports the ecosystem uses, and what is listening on each. */
const PORTS = {
	robot: 5810,
	driverStation: 6767,
	systemcore: 6810,
};

/** A value as it appears at the end of a line: short, and never a lie. */
export function format(value: NtValue | undefined): string | undefined {
	if (value === undefined || value === null) { return undefined; }
	if (typeof value === 'boolean') { return value ? 'true' : 'false'; }
	if (typeof value === 'bigint') { return value.toString(); }
	if (typeof value === 'number') {
		if (Number.isInteger(value)) { return String(value); }
		// Three decimals is enough to see a setpoint move and short enough not to
		// push the code sideways. The full value is in the hover.
		return value.toFixed(3).replace(/\.?0+$/, '');
	}
	if (typeof value === 'string') {
		return value.length > 40 ? `"${value.slice(0, 39)}…"` : `"${value}"`;
	}
	if (value instanceof Uint8Array) { return `${value.length} bytes`; }
	if (Array.isArray(value)) {
		const inner = value.slice(0, 3).map((v) => format(v as NtValue) ?? '?').join(', ');
		return value.length > 3 ? `[${inner}, …] (${value.length})` : `[${inner}]`;
	}
	return undefined;
}

export class LiveNetworkTables implements vscode.Disposable {
	private readonly client = new NT4Client();
	private readonly changed = new vscode.EventEmitter<void>();
	/** Fires when the connection state changes, or after a batch of new values. */
	readonly onDidChange = this.changed.event;

	private readonly decoration = vscode.window.createTextEditorDecorationType({
		after: {
			margin: '0 0 0 1.5em',
			color: new vscode.ThemeColor('editorCodeLens.foreground'),
			fontStyle: 'normal',
		},
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});

	private readonly status: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];
	private redraw?: NodeJS.Timeout;

	constructor(private readonly workspace: MarsWorkspace) {
		this.status = vscode.window.createStatusBarItem(
			'mars.networkTables', vscode.StatusBarAlignment.Left, 99);
		this.status.name = 'MARS NetworkTables';
		this.status.command = 'mars.toggleNetworkTables';

		this.client.on('state', () => {
			this.updateStatus();
			this.scheduleRedraw();
			this.changed.fire();
		});
		this.client.on('values', () => this.scheduleRedraw());
		this.client.on('error', (message: string) => {
			// Connection errors are expected and constant while a robot is off; they
			// belong in the tooltip, not in a notification that has to be dismissed.
			this.status.tooltip = new vscode.MarkdownString(`NetworkTables: ${message}`);
		});

		this.disposables.push(
			vscode.window.onDidChangeVisibleTextEditors(() => this.scheduleRedraw()),
			// The tables to subscribe to come from the scan, so they change when it does.
			workspace.onDidChange(() => this.followModel()),
		);

		this.updateStatus();
	}

	get state(): ConnectionState { return this.client.state; }
	get connected(): boolean { return this.client.state === 'connected'; }

	/** The current value of a topic path like `/Arm/kP`, formatted for display. */
	display(path: string): string | undefined {
		return format(this.client.valueOf(path));
	}

	raw(path: string): NtValue | undefined { return this.client.valueOf(path); }

	// -----------------------------------------------------------------------
	// Connecting
	// -----------------------------------------------------------------------

	/** The places a MARS robot's NetworkTables server is normally found. */
	private targets(): Target[] {
		const team = this.workspace.project?.teamNumber;
		const address = team ? teamAddress(team) : undefined;

		const targets: Target[] = [
			{ label: 'Simulator', host: 'localhost', port: PORTS.robot },
		];
		if (address) {
			targets.push({ label: `Robot (team ${team})`, host: address, port: PORTS.robot });
			targets.push({ label: `Robot over mDNS (team ${team})`, host: `roboRIO-${team}-FRC.local`, port: PORTS.robot });
		}
		targets.push({ label: 'Driver Station', host: 'localhost', port: PORTS.driverStation });
		targets.push({ label: 'Systemcore', host: 'localhost', port: PORTS.systemcore });
		return targets;
	}

	async connect(): Promise<void> {
		const configured = vscode.workspace.getConfiguration('mars').get<string>('networkTables.address')?.trim();
		if (configured) {
			const [host, port] = configured.split(':');
			this.client.connect({ label: configured, host, port: Number(port) || PORTS.robot });
			this.followModel();
			return;
		}

		const choice = await vscode.window.showQuickPick(
			this.targets().map((target) => ({
				label: target.label,
				description: `${target.host}:${target.port}`,
				target,
			})),
			{ title: 'Connect to NetworkTables', placeHolder: 'Where is the robot?' },
		);
		if (!choice) { return; }

		this.client.connect(choice.target);
		this.followModel();
	}

	disconnect(): void { this.client.disconnect(); }

	async toggle(): Promise<void> {
		if (this.client.state === 'disconnected') { await this.connect(); }
		else { this.disconnect(); }
	}

	/**
	 * Subscribes to the tables the project publishes, and no others.
	 *
	 * A dashboard asks for the whole tree because it does not know what it will
	 * be asked to show. This does know: the scan has already read every table
	 * name in the project, and nothing outside them can appear in the editor.
	 */
	private followModel(): void {
		const tables = new Set<string>();
		for (const subsystem of this.workspace.model.subsystems) {
			if (subsystem.key) { tables.add(`/${subsystem.key}/`); }
		}
		for (const topic of this.workspace.model.looseTopics) {
			if (topic.table) { tables.add(`/${topic.table}/`); }
		}
		this.client.subscribeTo([...tables]);
	}

	// -----------------------------------------------------------------------
	// Drawing
	// -----------------------------------------------------------------------

	private scheduleRedraw(): void {
		if (this.redraw) { return; }
		this.redraw = setTimeout(() => {
			this.redraw = undefined;
			this.draw();
			this.changed.fire();
		}, REDRAW_INTERVAL);
	}

	private draw(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.languageId !== 'java') { continue; }
			editor.setDecorations(this.decoration, this.decorationsFor(editor.document));
		}
	}

	private decorationsFor(document: vscode.TextDocument): vscode.DecorationOptions[] {
		if (!this.connected) { return []; }
		const scan = this.workspace.scanOf(document.uri.fsPath);
		if (!scan) { return []; }

		// Several topics can share a line -- a NetworkIO.set written on one line
		// with the annotation above it -- so they are joined rather than fighting
		// over the same end-of-line slot.
		const byLine = new Map<number, string[]>();
		for (const topic of scan.topics) {
			const text = this.labelFor(topic);
			if (!text) { continue; }
			byLine.set(topic.ref.line, [...(byLine.get(topic.ref.line) ?? []), text]);
		}

		return [...byLine].map(([line, labels]) => ({
			range: document.lineAt(Math.min(line, document.lineCount - 1)).range,
			renderOptions: { after: { contentText: `  ${labels.join('   ')}` } },
		}));
	}

	private labelFor(topic: TopicDecl): string | undefined {
		if (!topic.table || !topic.literal) { return undefined; }
		const value = this.display(topicPath(topic));
		return value === undefined ? undefined : `→ ${value}`;
	}

	private updateStatus(): void {
		const project = this.workspace.project;
		if (!project) {
			this.status.hide();
			return;
		}

		const target = this.client.connectedTo;
		switch (this.client.state) {
			case 'connected':
				this.status.text = `$(radio-tower) NT ${target?.label ?? ''}`.trim();
				this.status.backgroundColor = undefined;
				this.status.tooltip = new vscode.MarkdownString(
					`Connected to \`${target?.host}:${target?.port}\`.\n\n`
					+ `${this.client.known.size} topics announced.\n\nClick to disconnect.`);
				break;
			case 'connecting':
				this.status.text = '$(sync~spin) NT connecting';
				this.status.backgroundColor = undefined;
				this.status.tooltip = 'Trying to reach the NetworkTables server. Click to stop.';
				break;
			default:
				this.status.text = '$(debug-disconnect) NT';
				this.status.backgroundColor = undefined;
				this.status.tooltip = 'Not connected to NetworkTables. Click to connect.';
		}
		this.status.show();
	}

	dispose(): void {
		clearTimeout(this.redraw);
		this.client.dispose();
		this.decoration.dispose();
		this.status.dispose();
		this.changed.dispose();
		for (const d of this.disposables) { d.dispose(); }
	}

	/** Writes a value, converting the text the user typed to the topic's type. */
	async setFromInput(path: string): Promise<void> {
		if (!this.connected) {
			vscode.window.showWarningMessage('Not connected to NetworkTables.');
			return;
		}

		const type = this.client.typeOf(path);
		if (!type) {
			vscode.window.showWarningMessage(
				`${path} has not been announced by the robot, so its type is unknown.`);
			return;
		}

		const current = this.client.valueOf(path);
		const input = await vscode.window.showInputBox({
			title: `Set ${path}`,
			value: current === undefined ? '' : String(current),
			prompt: `Type: ${type}`,
			validateInput: (text) => parse(text, type) === undefined ? `Not a valid ${type}.` : undefined,
		});
		if (input === undefined) { return; }

		const value = parse(input, type);
		if (value === undefined || !this.client.set(path, value, type)) {
			vscode.window.showErrorMessage(`Could not write ${path}.`);
			return;
		}
		vscode.window.setStatusBarMessage(`${path} = ${input}`, 2000);
	}
}

/** Turns typed text into the topic's declared type, or `undefined` if it will not go. */
export function parse(text: string, type: string): NtValue | undefined {
	const trimmed = text.trim();
	switch (type) {
		case 'boolean':
			if (/^(true|1)$/i.test(trimmed)) { return true; }
			if (/^(false|0)$/i.test(trimmed)) { return false; }
			return undefined;
		case 'double': case 'float': {
			const value = Number(trimmed);
			return trimmed !== '' && Number.isFinite(value) ? value : undefined;
		}
		case 'int': {
			const value = Number(trimmed);
			return Number.isInteger(value) ? value : undefined;
		}
		case 'string':
			return text;
		default:
			// Arrays and raw values are readable but not editable from here: there
			// is no sensible one-line syntax for them, and guessing one would write
			// the wrong thing to a robot.
			return undefined;
	}
}
