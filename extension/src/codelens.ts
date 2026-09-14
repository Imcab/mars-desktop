// The links between the files a subsystem is spread across.
//
// Opening a MARS subsystem tells you almost nothing on its own: the fields it
// reads are in a Data class, the hardware behind them is behind an interface
// with three implementations, and what it actually does is one class per
// request, somewhere else. Those relationships exist in the type arguments and
// nowhere else -- no import points at a request, nothing names the subsystem
// back -- so no "go to definition" can follow them. These lenses can.
//
// The second half is the NetworkTables name: what a `@Tunable` field publishes
// under is the annotation's key, the field's name, and the subsystem's key
// somewhere else entirely. Having the answer over the line is the difference
// between knowing the topic and going to look it up in the dashboard.

import * as vscode from 'vscode';
import { LiveNetworkTables } from './nt/live';
import { MarsWorkspace } from './project';
import { MarsModel, SourceRef, TopicDecl, TypeDecl, topicPath } from './scan/model';

/** One entry of the quick pick a lens opens when there is more than one target. */
export interface PickTarget {
	label: string;
	description?: string;
	ref: SourceRef;
}

function lens(ref: SourceRef, title: string, command: string, args: unknown[], tooltip?: string) {
	const start = new vscode.Position(ref.line, ref.column);
	return new vscode.CodeLens(new vscode.Range(start, start.translate(0, ref.length)), {
		title,
		command,
		arguments: args,
		tooltip,
	});
}

function jump(ref: SourceRef, title: string, target: SourceRef, tooltip?: string) {
	return lens(ref, title, 'mars.reveal', [target], tooltip);
}

function pick(ref: SourceRef, title: string, heading: string, targets: PickTarget[], tooltip?: string) {
	return lens(ref, title, 'mars.pick', [heading, targets], tooltip);
}

export class MarsCodeLensProvider implements vscode.CodeLensProvider {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changed.event;

	constructor(
		private readonly workspace: MarsWorkspace,
		private readonly live: LiveNetworkTables,
	) {
		workspace.onDidChange(() => this.changed.fire());
		live.onDidChange(() => this.changed.fire());
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (!vscode.workspace.getConfiguration('mars').get<boolean>('codeLens', true)) { return []; }

		const scan = this.workspace.scanOf(document.uri.fsPath);
		if (!scan) { return []; }
		const model = this.workspace.model;

		const lenses: vscode.CodeLens[] = [];
		for (const type of scan.types) {
			lenses.push(...this.forType(type, model));
		}
		for (const topic of scan.topics) {
			lenses.push(...this.forTopic(topic));
		}
		return lenses;
	}

	private forType(type: TypeDecl, model: MarsModel): vscode.CodeLens[] {
		switch (type.role) {
			case 'subsystem':
			case 'composite':
				return this.forSubsystem(type, model);
			case 'request':
				return this.forRequest(type, model);
			case 'ioImpl':
				return this.forIoImplementation(type, model);
			case 'io':
				return this.forIoInterface(type, model);
			default:
				return [];
		}
	}

	private forSubsystem(type: TypeDecl, model: MarsModel): vscode.CodeLens[] {
		const subsystem = model.subsystems.find((s) => s.name === type.name);
		if (!subsystem) { return []; }
		const lenses: vscode.CodeLens[] = [];

		const data = model.data.find((d) => d.name === subsystem.dataType);
		if (data) {
			lenses.push(jump(
				subsystem.ref,
				`$(symbol-structure) ${data.name}`,
				data.ref,
				`The inputs this subsystem reads: ${data.fields?.length ?? 0} fields`,
			));
		}

		const io = model.ios.find((i) => i.name === subsystem.ioType);
		if (io) {
			const implementations = model.ios.filter(
				(i) => i.role === 'ioImpl' && i.implemented.includes(io.name));
			lenses.push(implementations.length
				? pick(
					subsystem.ref,
					`$(plug) ${io.name} · ${implementations.length}`,
					`Implementations of ${io.name}`,
					[
						{ label: io.name, description: 'the interface', ref: io.ref },
						...implementations.map((i) => ({ label: i.name, description: i.packageName, ref: i.ref })),
					],
				)
				: jump(subsystem.ref, `$(plug) ${io.name}`, io.ref, 'Nothing implements it yet'));
		}

		const requests = model.requests.filter(
			(r) => r.typeArgs[0] === subsystem.dataType && r.typeArgs[1] === subsystem.ioType);
		if (requests.length) {
			lenses.push(pick(
				subsystem.ref,
				`$(symbol-event) ${requests.length} ${requests.length === 1 ? 'request' : 'requests'}`,
				`Requests acting on ${subsystem.name}`,
				requests.map((r) => ({ label: r.name, description: r.packageName, ref: r.ref })),
			));
		}

		if (subsystem.key) {
			lenses.push(lens(
				subsystem.ref,
				`$(symbol-key) /${subsystem.key}`,
				'mars.copyTopic',
				[`/${subsystem.key}`],
				'The NetworkTables table this subsystem publishes under. Click to copy.',
			));
		}

		return lenses;
	}

	private forRequest(type: TypeDecl, model: MarsModel): vscode.CodeLens[] {
		// A request names the two types it acts on and never the subsystem, so
		// the way back is to find whoever declared that same pair.
		const owners = model.subsystems.filter(
			(s) => s.dataType === type.typeArgs[0] && s.ioType === type.typeArgs[1]);
		if (!owners.length) { return []; }

		return [owners.length === 1
			? jump(type.ref, `$(circuit-board) ${owners[0].name}`, owners[0].ref, 'The subsystem this request acts on')
			: pick(
				type.ref,
				`$(circuit-board) ${owners.length} subsystems`,
				`Subsystems this request can act on`,
				owners.map((s) => ({ label: s.name, description: s.key ? `/${s.key}` : undefined, ref: s.ref })),
			)];
	}

	private forIoImplementation(type: TypeDecl, model: MarsModel): vscode.CodeLens[] {
		const interfaces = model.ios.filter((i) => i.role === 'io' && type.implemented.includes(i.name));
		const siblings = model.ios.filter(
			(i) => i.role === 'ioImpl' && i !== type && i.implemented.some((n) => type.implemented.includes(n)));

		const lenses = interfaces.map((i) => jump(type.ref, `$(plug) ${i.name}`, i.ref, 'The interface it implements'));
		if (siblings.length) {
			lenses.push(pick(
				type.ref,
				`$(versions) ${siblings.length} sibling${siblings.length === 1 ? '' : 's'}`,
				'The other implementations of the same interface',
				siblings.map((s) => ({ label: s.name, description: s.packageName, ref: s.ref })),
			));
		}
		return lenses;
	}

	private forIoInterface(type: TypeDecl, model: MarsModel): vscode.CodeLens[] {
		const implementations = model.ios.filter(
			(i) => i.role === 'ioImpl' && i.implemented.includes(type.name));
		const users = model.subsystems.filter((s) => s.ioType === type.name);

		const lenses: vscode.CodeLens[] = [];
		if (implementations.length) {
			lenses.push(pick(
				type.ref,
				`$(plug) ${implementations.length} implementation${implementations.length === 1 ? '' : 's'}`,
				`Implementations of ${type.name}`,
				implementations.map((i) => ({ label: i.name, description: i.packageName, ref: i.ref })),
			));
		}
		for (const user of users) {
			lenses.push(jump(type.ref, `$(circuit-board) ${user.name}`, user.ref, 'The subsystem that uses it'));
		}
		return lenses;
	}

	private forTopic(topic: TopicDecl): vscode.CodeLens[] {
		// Only the annotation forms earn a lens. A `NetworkIO.set` already has
		// its table and key written on the line; an annotation does not.
		if (topic.kind !== '@Tunable' && topic.kind !== '@Signal') { return []; }
		if (!topic.table) { return []; }

		const path = topicPath(topic);

		// While connected, the value itself is already on the line as a decoration,
		// so the lens offers the thing the decoration cannot: writing it back.
		if (this.live.connected && this.live.raw(path) !== undefined && topic.kind === '@Tunable') {
			return [lens(
				topic.ref,
				`$(edit) set ${path}`,
				'mars.setTopic',
				[path],
				'Write a new value to this topic on the robot.',
			)];
		}

		return [lens(
			topic.ref,
			`$(symbol-key) ${path}`,
			'mars.copyTopic',
			[path],
			'The NetworkTables topic this publishes under. Click to copy it.',
		)];
	}
}
