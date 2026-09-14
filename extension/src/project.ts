// What a MARS robot project is, from the editor's point of view, and the store
// that keeps the scanned model of it up to date.
//
// The definition of "a MARS project" is not invented here: it is the one
// `validate_mars_project` uses in the dashboard (a `workspace-mars/` folder next
// to the build). The two have to agree, because a folder the extension lights up
// for and the dashboard refuses to open is a bug report nobody can act on.

import * as vscode from 'vscode';
import { MarsModel, emptyModel } from './scan/model';
import { FileScan } from './scan/model';
import { buildModel, scanFile } from './scan/scanner';

/** A vendordep descriptor, as WPILib writes it into `vendordeps/`. */
export interface Vendordep {
	name: string;
	version: string;
	frcYear?: string;
	jsonUrl?: string;
	uri: vscode.Uri;
}

/** A MARS Feature the project has installed, from `workspace-mars/features/`. */
export interface InstalledFeature {
	featureId: string;
	name: string;
	version: string;
	author?: string;
	description?: string;
	/** The MARS core range the feature declares it needs, e.g. `>=1.6.0`. */
	marsCoreRequired?: string;
	uri: vscode.Uri;
}

/** Everything read off disk about one project, cheap enough to redo on demand. */
export interface MarsProject {
	root: vscode.Uri;
	name: string;
	/** The team number from `.wpilib/wpilib_preferences.json`, when there is one. */
	teamNumber?: string;
	mars?: Vendordep;
	otherVendordeps: Vendordep[];
	features: InstalledFeature[];
	/** `HAS_*` flags declared in `Manifest.java`. */
	manifestFlags: Map<string, boolean>;
	/** True when `ProjectUnits.json` is present, i.e. the UnitProcessor is in use. */
	hasProjectUnits: boolean;
}

const JAVA_GLOB = 'src/main/java/**/*.java';

async function readJson(uri: vscode.Uri): Promise<any | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return undefined;
	}
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/** True when the folder is what the dashboard would agree to open. */
export async function isMarsProject(root: vscode.Uri): Promise<boolean> {
	return exists(vscode.Uri.joinPath(root, 'workspace-mars'))
		|| exists(vscode.Uri.joinPath(root, 'vendordeps', 'Mars.json'));
}

async function readVendordeps(root: vscode.Uri): Promise<Vendordep[]> {
	const dir = vscode.Uri.joinPath(root, 'vendordeps');
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return [];
	}

	const out: Vendordep[] = [];
	for (const [file, type] of entries) {
		if (type !== vscode.FileType.File || !file.endsWith('.json')) { continue; }
		const uri = vscode.Uri.joinPath(dir, file);
		const json = await readJson(uri);
		if (json?.name && json?.version) {
			out.push({ name: json.name, version: json.version, frcYear: json.frcYear, jsonUrl: json.jsonUrl, uri });
		}
	}
	return out;
}

async function readFeatures(root: vscode.Uri): Promise<InstalledFeature[]> {
	const dir = vscode.Uri.joinPath(root, 'workspace-mars', 'features');
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return [];
	}

	const out: InstalledFeature[] = [];
	for (const [file, type] of entries) {
		if (type !== vscode.FileType.File || !file.endsWith('.json')) { continue; }
		const uri = vscode.Uri.joinPath(dir, file);
		const json = await readJson(uri);
		if (!json?.featureId) { continue; }
		out.push({
			featureId: json.featureId,
			name: json.name ?? json.featureId,
			version: json.version ?? '?',
			author: json.author,
			description: json.description,
			marsCoreRequired: json.marsCoreRequired,
			uri,
		});
	}
	return out;
}

/**
 * The `HAS_*` switches in `Manifest.java`.
 *
 * The same regex the dashboard uses, deliberately: these flags are a convention
 * and not a language feature, so the two readers have to agree on the spelling
 * or the editor and the dashboard will disagree about what a project has.
 */
const MANIFEST_FLAG = /public\s+static\s+final\s+boolean\s+(HAS_[A-Z0-9_]+)\s*=\s*(true|false)\s*;/g;

async function readManifestFlags(root: vscode.Uri): Promise<Map<string, boolean>> {
	const flags = new Map<string, boolean>();
	const uri = vscode.Uri.joinPath(
		root, 'src', 'main', 'java', 'frc', 'robot', 'configuration', 'Manifest.java');
	let text: string;
	try {
		text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return flags;
	}
	MANIFEST_FLAG.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = MANIFEST_FLAG.exec(text)) !== null) { flags.set(m[1], m[2] === 'true'); }
	return flags;
}

export async function readProject(root: vscode.Uri): Promise<MarsProject> {
	const [vendordeps, features, manifestFlags, preferences, units] = await Promise.all([
		readVendordeps(root),
		readFeatures(root),
		readManifestFlags(root),
		readJson(vscode.Uri.joinPath(root, '.wpilib', 'wpilib_preferences.json')),
		exists(vscode.Uri.joinPath(root, 'ProjectUnits.json')),
	]);

	const mars = vendordeps.find((v) => v.name === 'Mars');
	const team = preferences?.teamNumber;

	return {
		root,
		name: root.path.split('/').filter(Boolean).pop() ?? 'project',
		teamNumber: team === undefined || team === null ? undefined : String(team),
		mars,
		otherVendordeps: vendordeps.filter((v) => v !== mars),
		features,
		manifestFlags,
		hasProjectUnits: units,
	};
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * Holds the active project and its scanned model, and keeps both current.
 *
 * The per-file scan cache is the reason this is a class and not a function:
 * typing in one subsystem re-scans that one file and re-merges, which on a
 * robot project is fast enough to run on a keystroke. A full re-read of
 * `src/main/java` only happens on activation and when files appear or vanish.
 */
export class MarsWorkspace implements vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	/** Fires whenever the project or the model has been replaced. */
	readonly onDidChange = this.changed.event;

	private readonly scans = new Map<string, FileScan>();
	private readonly disposables: vscode.Disposable[] = [];
	private sources?: vscode.FileSystemWatcher;
	private descriptors?: vscode.FileSystemWatcher;
	/**
	 * One pending re-scan per file.
	 *
	 * A single shared timer would drop the first file's scan whenever somebody
	 * touched a second one inside the debounce window, which is exactly what
	 * happens while moving a method from one class to another.
	 */
	private readonly pending = new Map<string, NodeJS.Timeout>();

	private currentProject?: MarsProject;
	private currentModel: MarsModel = emptyModel();

	get project(): MarsProject | undefined { return this.currentProject; }
	get model(): MarsModel { return this.currentModel; }

	/** What one file contributed, for the features that work a file at a time. */
	scanOf(path: string): FileScan | undefined { return this.scans.get(path); }

	constructor() {
		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discover()),
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (e.document.languageId !== 'java') { return; }
				this.scheduleDocumentScan(e.document);
			}),
			vscode.workspace.onDidOpenTextDocument((doc) => {
				if (doc.languageId === 'java') { this.scheduleDocumentScan(doc); }
			}),
		);
	}

	/** Finds the first MARS project among the open folders and scans it. */
	async discover(): Promise<void> {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			if (await isMarsProject(folder.uri)) {
				await this.load(folder.uri);
				return;
			}
		}
		this.currentProject = undefined;
		this.currentModel = emptyModel();
		this.scans.clear();
		this.watch(undefined);
		this.changed.fire();
	}

	/** Re-reads the project descriptors and rebuilds the model from scratch. */
	async refresh(): Promise<void> {
		if (this.currentProject) { await this.load(this.currentProject.root); }
		else { await this.discover(); }
	}

	private async load(root: vscode.Uri): Promise<void> {
		this.currentProject = await readProject(root);
		this.scans.clear();

		const pattern = new vscode.RelativePattern(root, JAVA_GLOB);
		const files = await vscode.workspace.findFiles(pattern);
		await Promise.all(files.map(async (uri) => {
			try {
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
				this.scans.set(uri.fsPath, scanFile(uri.fsPath, text));
			} catch {
				// A file that vanished between the glob and the read is not an error.
			}
		}));

		this.rebuild();
		this.watch(root);
	}

	/**
	 * Replaces both watchers.
	 *
	 * Both are torn down first every time, and that is load-bearing rather than
	 * tidy: `load` calls this, and the descriptor watcher calls `refresh`, which
	 * calls `load`. A watcher that was not disposed here would leave a second one
	 * behind on every vendordep change, each of them still firing.
	 */
	private watch(root: vscode.Uri | undefined): void {
		this.sources?.dispose();
		this.descriptors?.dispose();
		this.sources = undefined;
		this.descriptors = undefined;
		if (!root) { return; }

		// Only creation and deletion: edits arrive through onDidChangeTextDocument
		// already, and going back to disk for them would read the saved file while
		// the user is looking at an unsaved one.
		this.sources = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, JAVA_GLOB), false, true, false);
		this.sources.onDidCreate(() => void this.refresh());
		this.sources.onDidDelete((uri) => {
			this.scans.delete(uri.fsPath);
			this.rebuild();
		});

		// The descriptors decide what the project *is*, so a changed vendordep or a
		// newly installed Feature has to reach the sidebar without a manual rescan.
		this.descriptors = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '{vendordeps,workspace-mars/features}/*.json'));
		this.descriptors.onDidCreate(() => void this.refresh());
		this.descriptors.onDidChange(() => void this.refresh());
		this.descriptors.onDidDelete(() => void this.refresh());
	}

	private scheduleDocumentScan(document: vscode.TextDocument): void {
		if (!this.currentProject || !this.owns(document.uri)) { return; }
		const path = document.uri.fsPath;
		clearTimeout(this.pending.get(path));
		this.pending.set(path, setTimeout(() => {
			this.pending.delete(path);
			this.scans.set(path, scanFile(path, document.getText()));
			this.rebuild();
		}, 400));
	}

	private owns(uri: vscode.Uri): boolean {
		if (!this.currentProject) { return false; }
		const root = this.currentProject.root.fsPath;
		return uri.fsPath.startsWith(root);
	}

	private rebuild(): void {
		const root = this.currentProject?.root.fsPath ?? '';
		this.currentModel = buildModel(root, this.scans.values());
		this.changed.fire();
	}

	dispose(): void {
		for (const timer of this.pending.values()) { clearTimeout(timer); }
		this.pending.clear();
		this.watch(undefined);
		this.changed.dispose();
		for (const d of this.disposables) { d.dispose(); }
	}
}
