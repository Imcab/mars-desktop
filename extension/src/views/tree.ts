// Shared pieces for the sidebar trees.
//
// Both views are read-only lists built from the model, so they share one node
// shape and one way of turning a `SourceRef` into the click that opens it.

import * as vscode from 'vscode';
import { SourceRef } from '../scan/model';

/** The command every jump-to-source item runs. */
export const REVEAL_COMMAND = 'mars.reveal';

export interface NodeOptions {
	label: string;
	/** The dimmed text after the label. */
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	icon?: vscode.ThemeIcon;
	/** Where clicking it goes. */
	ref?: SourceRef;
	command?: vscode.Command;
	/** Used by `when` clauses on the item's inline buttons. */
	contextValue?: string;
	children?: TreeNode[];
	/** Expanded when it has children, unless this says otherwise. */
	collapsed?: boolean;
}

export class TreeNode extends vscode.TreeItem {
	readonly children: TreeNode[];

	constructor(options: NodeOptions) {
		const hasChildren = (options.children?.length ?? 0) > 0;
		super(
			options.label,
			hasChildren
				? (options.collapsed ? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.Expanded)
				: vscode.TreeItemCollapsibleState.None,
		);

		this.children = options.children ?? [];
		this.description = options.description;
		this.tooltip = options.tooltip;
		this.iconPath = options.icon;
		this.contextValue = options.contextValue;

		if (options.command) {
			this.command = options.command;
		} else if (options.ref) {
			this.command = {
				command: REVEAL_COMMAND,
				title: 'Go to declaration',
				arguments: [options.ref],
			};
		}
	}
}

/** A group header with a count, the shape both trees use for their sections. */
export function group(label: string, children: TreeNode[], icon?: string, collapsed = false): TreeNode {
	return new TreeNode({
		label,
		description: children.length ? String(children.length) : undefined,
		icon: icon ? new vscode.ThemeIcon(icon) : undefined,
		children,
		collapsed,
	});
}

/** Opens the file at the ref and puts the cursor on the thing it points at. */
export async function reveal(ref: SourceRef): Promise<void> {
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(ref.path));
	const start = new vscode.Position(ref.line, ref.column);
	const range = new vscode.Range(start, start.translate(0, ref.length));
	await vscode.window.showTextDocument(document, {
		selection: range,
		preserveFocus: false,
	});
}

/** The plumbing every tree in this extension repeats: refresh on model change. */
export abstract class RefreshableTree implements vscode.TreeDataProvider<TreeNode> {
	private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData = this.changed.event;

	refresh(): void { this.changed.fire(undefined); }

	getTreeItem(element: TreeNode): vscode.TreeItem { return element; }

	getChildren(element?: TreeNode): TreeNode[] {
		return element ? element.children : this.roots();
	}

	protected abstract roots(): TreeNode[];
}
