// The bottom half of the sidebar: the project's MARS architecture, as declared.
//
// MARS deliberately scatters a subsystem across files -- the data here, the IO
// interface there, three implementations of it, one class per request -- because
// that is what makes each piece swappable. The cost is that nobody can see a
// subsystem whole by opening a file, and the file tree is no help: it shows
// folders, not which IO belongs to which subsystem or what a request acts on.
// This view puts the pieces back together without moving any of them.

import * as vscode from 'vscode';
import { LiveNetworkTables } from '../nt/live';
import { MarsModel, SubsystemDecl, TopicDecl, TypeDecl, topicPath } from '../scan/model';
import { RefreshableTree, TreeNode, group } from './tree';

/** The icon each kind of declaration gets, so the tree reads at a glance. */
const ICONS: Readonly<Record<string, string>> = {
	subsystem: 'circuit-board',
	composite: 'type-hierarchy',
	data: 'symbol-structure',
	nodeMessage: 'symbol-structure',
	io: 'plug',
	ioImpl: 'plug',
	request: 'symbol-event',
	telemetry: 'graph',
	node: 'radio-tower',
	service: 'arrow-swap',
	testRoutine: 'beaker',
	container: 'symbol-namespace',
	binding: 'link',
	unknown: 'symbol-class',
};

function iconFor(role: string): vscode.ThemeIcon {
	return new vscode.ThemeIcon(ICONS[role] ?? 'symbol-class');
}

function typeNode(decl: TypeDecl, description?: string): TreeNode {
	return new TreeNode({
		label: decl.name,
		description,
		tooltip: new vscode.MarkdownString(
			`\`${decl.packageName ? `${decl.packageName}.` : ''}${decl.name}\``
			+ (decl.supertype ? `\n\n${decl.role === 'ioImpl' ? 'implements' : 'extends'} \`${decl.supertype}\`` : ''),
		),
		icon: iconFor(decl.role),
		ref: decl.ref,
		contextValue: `mars.type.${decl.role}`,
	});
}

function topicNode(topic: TopicDecl, live?: string): TreeNode {
	return new TreeNode({
		// While connected the value is the useful half; the construct that
		// publishes it is already visible in the file the node jumps to.
		label: topicPath(topic),
		description: live === undefined ? topic.kind : `= ${live}`,
		tooltip: new vscode.MarkdownString(
			topic.literal
				? `Published by \`${topic.kind}\`${topic.member ? ` on \`${topic.member}\`` : ''}.`
				: 'The key is built at runtime, so this is the table it lands under and not the whole name.',
		),
		icon: new vscode.ThemeIcon(topic.literal ? 'symbol-key' : 'question'),
		ref: topic.ref,
		contextValue: 'mars.topic',
	});
}

export class ArchitectureView extends RefreshableTree {
	constructor(
		private readonly modelOf: () => MarsModel,
		private readonly live: LiveNetworkTables,
	) {
		super();
	}

	/** The live value of a topic, or nothing when there is no connection. */
	private valueOf(topic: TopicDecl): string | undefined {
		return this.live.connected ? this.live.display(topicPath(topic)) : undefined;
	}

	protected roots(): TreeNode[] {
		const model = this.modelOf();
		const sections: TreeNode[] = [];

		if (model.subsystems.length) {
			sections.push(group(
				'Subsystems',
				model.subsystems.map((s) => this.subsystem(s, model)),
				'circuit-board',
			));
		}

		const loose = [
			['Nodes', model.nodes, 'radio-tower'],
			['Services', model.services, 'arrow-swap'],
			['Test routines', model.tests, 'beaker'],
			['Bindings', model.bindings, 'link'],
		] as const;
		for (const [label, decls, icon] of loose) {
			if (decls.length) {
				sections.push(group(label, decls.map((d) => typeNode(d)), icon, true));
			}
		}

		// Topics published outside a subsystem -- Robot.java's System table, the
		// watchdog's. Worth listing so the dashboard's topic list has no surprises.
		if (model.looseTopics.length) {
			sections.push(group(
				'Other topics',
				model.looseTopics.map((t) => topicNode(t, this.valueOf(t))),
				'symbol-key',
				true,
			));
		}

		if (!sections.length) {
			sections.push(new TreeNode({
				label: model.fileCount
					? 'No MARS types found in this project yet'
					: 'Nothing scanned yet',
				icon: new vscode.ThemeIcon('info'),
			}));
		}

		return sections;
	}

	private subsystem(subsystem: SubsystemDecl, model: MarsModel): TreeNode {
		const children: TreeNode[] = [];

		const data = model.data.find((d) => d.name === subsystem.dataType);
		if (data) {
			children.push(new TreeNode({
				label: data.name,
				description: data.fields?.length ? `${data.fields.length} fields` : 'data',
				icon: iconFor('data'),
				ref: data.ref,
				collapsed: true,
				children: (data.fields ?? []).map((field) => new TreeNode({
					label: field.name,
					description: field.javaType,
					icon: new vscode.ThemeIcon('symbol-field'),
					ref: field.ref,
				})),
			}));
		}

		const io = model.ios.find((i) => i.name === subsystem.ioType);
		if (io) {
			const implementations = model.ios.filter(
				(i) => i.role === 'ioImpl' && i.implemented.includes(io.name));
			children.push(new TreeNode({
				label: io.name,
				description: implementations.length
					? `${implementations.length} implementations`
					: 'no implementation found',
				icon: iconFor('io'),
				ref: io.ref,
				collapsed: true,
				children: implementations.map((i) => typeNode(i)),
			}));
		}

		// A request is tied to a subsystem by the pair of types it acts on, which
		// is the only link that exists: nothing names the subsystem.
		const requests = model.requests.filter(
			(r) => r.typeArgs[0] === subsystem.dataType && r.typeArgs[1] === subsystem.ioType);
		if (requests.length) {
			children.push(group('Requests', requests.map((r) => typeNode(r)), 'symbol-event', true));
		}

		if (subsystem.topics.length) {
			children.push(group(
				'Topics',
				subsystem.topics.map((t) => topicNode(t, this.valueOf(t))),
				'symbol-key',
				true,
			));
		}

		const unresolved = subsystem.key === undefined;
		return new TreeNode({
			label: subsystem.name,
			description: subsystem.key
				? `/${subsystem.key}`
				: subsystem.keyExpression ? `${subsystem.keyExpression} (not a literal)` : 'no key',
			tooltip: new vscode.MarkdownString([
				`\`${subsystem.packageName}.${subsystem.name}\``,
				subsystem.dataType && subsystem.ioType
					? `\`${subsystem.supertype}<${subsystem.dataType}, ${subsystem.ioType}>\`` : '',
				unresolved
					? 'Its NetworkTables table could not be read from source, so the topics below have no name.'
					: `Publishes under \`/${subsystem.key}\`.`,
			].filter(Boolean).join('\n\n')),
			icon: iconFor(subsystem.role),
			ref: subsystem.ref,
			contextValue: 'mars.subsystem',
			children,
			collapsed: true,
		});
	}
}
