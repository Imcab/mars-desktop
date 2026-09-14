// Turning the diagnostics into fixes.
//
// Every rule in `diagnostics.ts` knows enough to repair itself, and reporting
// without repairing is where a linter starts feeling like nagging. The fixes
// here are the ones that can be made without guessing: the subsystem's own name
// gives the key, the container is the only place a subsystem can be wired into,
// the interface's own methods give the implementation its shape.
//
// Where a fix would have to invent something -- which of two colliding topics
// is the wrong one -- there is no fix, only the diagnostic. A quick fix that
// picks wrong is worse than none, because it gets accepted without reading.

import * as path from 'path';
import * as vscode from 'vscode';
import { MarsWorkspace } from './project';
import { MarsModel, SourceRef, SubsystemDecl, TypeDecl } from './scan/model';

const { QuickFix, Refactor } = vscode.CodeActionKind;

// ---------------------------------------------------------------------------
// Small text surgery
// ---------------------------------------------------------------------------

/** `targetAngle` becomes `TARGET_ANGLE`, the same spelling the wizard uses. */
export function upperSnake(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function lowerFirst(name: string): string {
	return name.charAt(0).toLowerCase() + name.slice(1);
}

function rangeOf(ref: SourceRef): vscode.Range {
	const start = new vscode.Position(ref.line, ref.column);
	return new vscode.Range(start, start.translate(0, ref.length));
}

/** The value a generated method returns, so the stub compiles. */
function defaultValue(javaType: string): string | undefined {
	switch (javaType.replace(/\s/g, '')) {
		case 'void': return undefined;
		case 'double': case 'float': case 'int': case 'long': case 'short': case 'byte': return '0';
		case 'boolean': return 'false';
		case 'char': return "'\\0'";
		case 'String': return '""';
		default: return 'null';
	}
}

/** The indentation of the line a declaration's body starts on, plus one level. */
function memberIndent(document: vscode.TextDocument, bodyEnd: number): string {
	const closing = document.positionAt(bodyEnd);
	const leading = /^[ \t]*/.exec(document.lineAt(closing.line).text)?.[0] ?? '';
	return `${leading}  `;
}

/**
 * Adds an import, unless the type is in the same package or already imported.
 *
 * It goes after the last existing import, or after the package declaration when
 * there are none -- anywhere else and it is not a valid compilation unit.
 */
function addImport(
	edit: vscode.WorkspaceEdit,
	document: vscode.TextDocument,
	ownPackage: string,
	type: { name: string; packageName: string },
): void {
	if (!type.packageName || type.packageName === ownPackage) { return; }
	const statement = `import ${type.packageName}.${type.name};`;
	const text = document.getText();
	if (text.includes(statement)) { return; }

	let insertAfter = -1;
	for (let line = 0; line < document.lineCount; line++) {
		const content = document.lineAt(line).text;
		if (/^\s*import\s/.test(content) || /^\s*package\s/.test(content)) { insertAfter = line; }
		// The first type declaration ends the header; nothing after it is an import.
		if (/\b(class|interface|enum|record)\s+\w/.test(content)) { break; }
	}
	if (insertAfter === -1) { return; }

	edit.insert(document.uri, new vscode.Position(insertAfter + 1, 0), `${statement}\n`);
}

/** Inserts a member just before a type's closing brace. */
function addMember(
	edit: vscode.WorkspaceEdit,
	document: vscode.TextDocument,
	decl: TypeDecl,
	member: string,
): void {
	const indent = memberIndent(document, decl.body.end);
	const at = document.positionAt(decl.body.end);
	const body = member.split('\n').map((line) => (line ? indent + line : line)).join('\n');
	edit.insert(document.uri, at, `${body}\n`);
}

async function open(ref: { path: string }): Promise<vscode.TextDocument> {
	return vscode.workspace.openTextDocument(vscode.Uri.file(ref.path));
}

// ---------------------------------------------------------------------------
// The fixes
// ---------------------------------------------------------------------------

function action(title: string, kind: vscode.CodeActionKind, diagnostic?: vscode.Diagnostic) {
	const result = new vscode.CodeAction(title, kind);
	result.edit = new vscode.WorkspaceEdit();
	if (diagnostic) { result.diagnostics = [diagnostic]; }
	return result;
}

/**
 * Give the subsystem a table.
 *
 * The name is not a guess: the subsystem is called `Elevator`, so its table is
 * `"Elevator"` and its constant is `ELEVATOR_KEY`, which is the convention the
 * wizard and `KeyManager` already establish. If that constant turns out to
 * exist already -- and after a wizard run it often does, since the TODO comment
 * names it -- the fix is just to use it.
 */
async function fixNullKey(
	subsystem: SubsystemDecl,
	model: MarsModel,
	diagnostic: vscode.Diagnostic,
): Promise<vscode.CodeAction[]> {
	if (!subsystem.keyRef) { return []; }

	const constantName = `${upperSnake(subsystem.name)}_KEY`;
	const table = subsystem.name;
	const subsystemDocument = await open(subsystem.ref);
	const keyManager = model.types.find((t) => t.name === 'KeyManager')
		?? model.types.find((t) => [...model.constants.keys()].some((k) => k.startsWith(`${t.name}.`)));

	const out: vscode.CodeAction[] = [];

	// Already declared somewhere: nothing to create, only to point at.
	const existing = [...model.constants.keys()].find((name) => name.endsWith(`.${constantName}`));
	if (existing) {
		const owner = model.types.find((t) => t.name === existing.split('.')[0]);
		const fix = action(`Use ${existing}`, QuickFix, diagnostic);
		fix.edit!.replace(subsystemDocument.uri, rangeOf(subsystem.keyRef), existing);
		if (owner) { addImport(fix.edit!, subsystemDocument, subsystem.packageName, owner); }
		fix.isPreferred = true;
		out.push(fix);
		return out;
	}

	if (keyManager) {
		const keyManagerDocument = await open(keyManager.ref);
		const qualified = `${keyManager.name}.${constantName}`;
		const fix = action(`Create ${qualified} and use it here`, QuickFix, diagnostic);
		addMember(fix.edit!, keyManagerDocument, keyManager,
			`\npublic static final String ${constantName} = "${table}";\n`);
		fix.edit!.replace(subsystemDocument.uri, rangeOf(subsystem.keyRef), qualified);
		addImport(fix.edit!, subsystemDocument, subsystem.packageName, keyManager);
		fix.isPreferred = true;
		out.push(fix);
	}

	// The fallback when there is no KeyManager to put it in. Honest, and the
	// diagnostic that dislikes bare literals will say so next.
	const literal = action(`Use the literal "${table}"`, QuickFix, diagnostic);
	literal.edit!.replace(subsystemDocument.uri, rangeOf(subsystem.keyRef), `"${table}"`);
	out.push(literal);

	return out;
}

/** How the wizard builds an IO layer, when all three implementations exist. */
function constructorArgument(
	subsystem: SubsystemDecl,
	model: MarsModel,
	flags: ReadonlyMap<string, boolean>,
): { expression: string; types: TypeDecl[] } | undefined {
	if (!subsystem.ioType) { return undefined; }
	const implementations = model.ios.filter(
		(i) => i.role === 'ioImpl' && i.implemented.includes(subsystem.ioType!));
	if (!implementations.length) { return undefined; }

	const named = (suffix: string) => implementations.find((i) => i.name.endsWith(suffix));
	const real = named('Real');
	const sim = named('Sim');
	const fallback = named('Fallback');

	if (real && sim && fallback) {
		// The Injector form, which is the only one that respects the run mode and
		// the Manifest switch. A flag that does not exist would not compile, so an
		// absent one becomes a plain `true`.
		const flag = `HAS_${upperSnake(subsystem.name)}`;
		const enabled = flags.has(flag) ? `Manifest.${flag}` : 'true';
		return {
			expression: `Injector.createIO(\n    ${enabled},\n    ${fallback.name}::new,`
				+ `\n    ${real.name}::new,\n    ${sim.name}::new)`,
			types: [real, sim, fallback],
		};
	}

	const chosen = real ?? implementations[0];
	return { expression: `new ${chosen.name}()`, types: [chosen] };
}

/** Construct the subsystem in the container, which is the only thing that makes it run. */
async function fixOrphan(
	subsystem: SubsystemDecl,
	model: MarsModel,
	flags: ReadonlyMap<string, boolean>,
	diagnostic: vscode.Diagnostic,
): Promise<vscode.CodeAction[]> {
	const container = model.containers[0];
	if (!container) { return []; }

	// Without an IO implementation there is nothing to pass, and a fix that does
	// not compile is worse than no fix.
	const argument = constructorArgument(subsystem, model, flags);
	if (!argument) { return []; }

	const document = await open(container.ref);
	const field = lowerFirst(subsystem.name);

	const fix = action(`Construct ${subsystem.name} in ${container.name}`, QuickFix, diagnostic);
	addMember(fix.edit!, document, container,
		`\nprivate final ${subsystem.name} ${field} =\n    new ${subsystem.name}(${argument.expression});\n`);

	addImport(fix.edit!, document, container.packageName, subsystem);
	for (const type of argument.types) {
		addImport(fix.edit!, document, container.packageName, type);
	}
	if (argument.expression.startsWith('Injector')) {
		addImport(fix.edit!, document, container.packageName,
			{ name: 'Injector', packageName: 'com.stzteam.mars.builder' });
		if (argument.expression.includes('Manifest.')) {
			const manifest = model.types.find((t) => t.name === 'Manifest');
			if (manifest) { addImport(fix.edit!, document, container.packageName, manifest); }
		}
	}

	fix.isPreferred = true;
	return [fix];
}

/**
 * Write the hardware layers the interface is missing.
 *
 * Only Real and Sim: the `@Fallback` annotation asks MarsProcessor to generate
 * the do-nothing one at build time, and writing a third by hand would either
 * collide with it or quietly replace it.
 */
async function fixUnimplementedIo(
	io: TypeDecl,
	model: MarsModel,
	diagnostic: vscode.Diagnostic,
): Promise<vscode.CodeAction[]> {
	const dataType = io.typeArgs[0];
	if (!dataType) { return []; }

	const directory = path.dirname(io.ref.path);
	const fix = action(`Generate ${io.name}Real and ${io.name}Sim`, QuickFix, diagnostic);

	// `updateInputs` comes from IO<T> itself, not from this interface, so it is
	// not among the scanned methods and has to be added from what MARS declares.
	const signatures = [
		{ returnType: 'void', name: 'updateInputs', parameters: `${dataType} inputs` },
		...(io.methods ?? []),
	];

	for (const flavour of ['Real', 'Sim']) {
		const name = `${io.name}${flavour}`;
		const uri = vscode.Uri.file(path.join(directory, `${name}.java`));
		const body = signatures.map((method) => {
			const value = defaultValue(method.returnType);
			return `  @Override\n  public ${method.returnType} ${method.name}(${method.parameters}) {\n`
				+ (value ? `    return ${value};\n` : '')
				+ '  }\n';
		}).join('\n');

		fix.edit!.createFile(uri, { ignoreIfExists: true });
		fix.edit!.insert(uri, new vscode.Position(0, 0),
			`${io.packageName ? `package ${io.packageName};\n\n` : ''}`
			+ `public class ${name} implements ${io.name} {\n\n${body}}\n`);
	}

	fix.isPreferred = true;
	return [fix];
}

/** Put the Manifest back to REAL. */
async function fixRunMode(
	model: MarsModel,
	diagnostic: vscode.Diagnostic,
): Promise<vscode.CodeAction[]> {
	const mode = model.runMode;
	if (!mode) { return []; }
	const document = await open(mode.ref);
	const fix = action('Set the run mode to REAL', QuickFix, diagnostic);
	fix.edit!.replace(document.uri, rangeOf(mode.ref), 'CURRENT_MODE = RunMode.REAL');
	fix.isPreferred = true;
	return [fix];
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export class MarsCodeActionProvider implements vscode.CodeActionProvider {
	static readonly kinds = [QuickFix, Refactor];

	constructor(private readonly workspace: MarsWorkspace) {}

	async provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext,
	): Promise<vscode.CodeAction[]> {
		const model = this.workspace.model;
		const flags = this.workspace.project?.manifestFlags ?? new Map<string, boolean>();
		const actions: vscode.CodeAction[] = [];

		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source !== 'MARS') { continue; }
			actions.push(...await this.fixFor(diagnostic, document, model, flags));
		}

		// The rename is not a fix for anything: it is offered on any subsystem,
		// because renaming a table is a refactor no language server can do. The
		// table name is a string, and strings are not symbols.
		const subsystem = this.subsystemAt(document, range, model);
		if (subsystem?.key) {
			const rename = new vscode.CodeAction(
				`Rename the NetworkTables table "${subsystem.key}"...`, Refactor);
			rename.command = {
				command: 'mars.renameTable',
				title: 'Rename table',
				arguments: [subsystem.name],
			};
			actions.push(rename);
		}

		return actions;
	}

	private async fixFor(
		diagnostic: vscode.Diagnostic,
		document: vscode.TextDocument,
		model: MarsModel,
		flags: ReadonlyMap<string, boolean>,
	): Promise<vscode.CodeAction[]> {
		const owning = (decl: { ref: SourceRef }) =>
			decl.ref.path === document.uri.fsPath;

		switch (diagnostic.code) {
			case 'mars.nullKey': {
				const subsystem = model.subsystems.find(
					(s) => owning(s) && s.keyRef && rangeOf(s.keyRef).isEqual(diagnostic.range));
				return subsystem ? fixNullKey(subsystem, model, diagnostic) : [];
			}
			case 'mars.orphanSubsystem': {
				const subsystem = model.subsystems.find(
					(s) => owning(s) && rangeOf(s.ref).isEqual(diagnostic.range));
				return subsystem ? fixOrphan(subsystem, model, flags, diagnostic) : [];
			}
			case 'mars.unimplementedIo': {
				const io = model.ios.find(
					(i) => owning(i) && rangeOf(i.ref).isEqual(diagnostic.range));
				return io ? fixUnimplementedIo(io, model, diagnostic) : [];
			}
			case 'mars.runMode':
				return fixRunMode(model, diagnostic);
			default:
				return [];
		}
	}

	/** The subsystem whose declaration the cursor is on, if any. */
	private subsystemAt(
		document: vscode.TextDocument,
		range: vscode.Range,
		model: MarsModel,
	): SubsystemDecl | undefined {
		return model.subsystems.find((s) =>
			s.ref.path === document.uri.fsPath && s.ref.line === range.start.line);
	}
}

// ---------------------------------------------------------------------------
// Renaming a table
// ---------------------------------------------------------------------------

/**
 * Works out every edit a table rename needs, without touching anything.
 *
 * Separate from the command so it can be tested: the command's own body is a
 * quick pick and an input box, and driving those in a test would be a test of
 * VS Code. This is the part with the judgement in it.
 */
export async function planTableRename(
	model: MarsModel,
	subsystem: SubsystemDecl,
	after: string,
): Promise<{ edit: vscode.WorkspaceEdit; replacements: number }> {
	const before = subsystem.key!;
	const edit = new vscode.WorkspaceEdit();
	let replacements = 0;

	// The constant, when the key came from one. Its declaration is found in the
	// file of whichever type carries it, which the model knows by name.
	if (subsystem.keyExpression) {
		const constant = subsystem.keyExpression.split('.').pop() ?? '';
		const owner = model.types.find(
			(t) => model.constants.has(`${t.name}.${constant}`));
		if (owner) {
			const document = await open(owner.ref);
			const text = document.getText();
			const declaration = new RegExp(`(\\b${constant}\\s*=\\s*)"${before}"`).exec(text);
			if (declaration) {
				const start = document.positionAt(declaration.index + declaration[1].length);
				edit.replace(
					document.uri,
					new vscode.Range(start, start.translate(0, before.length + 2)),
					`"${after}"`,
				);
				replacements++;
			}
		}
	}

	// Every literal that names the old table: the `.key("Old")` form, and the
	// first argument of every NetworkIO.set that spelled it out.
	const literals = [
		...(subsystem.keyExpression ? [] : subsystem.keyRef ? [subsystem.keyRef] : []),
		...[...model.subsystems.flatMap((s) => s.topics), ...model.looseTopics]
			.filter((t) => t.table === before && t.tableExpression === undefined)
			.map((t) => t.ref),
	];

	const byFile = new Map<string, SourceRef[]>();
	for (const ref of literals) {
		byFile.set(ref.path, [...(byFile.get(ref.path) ?? []), ref]);
	}

	for (const [file, refs] of byFile) {
		const document = await open({ path: file });
		const text = document.getText();
		for (const ref of refs) {
			// The ref covers the whole construct, so the literal is located inside
			// it rather than assumed to start at the ref.
			const span = text.slice(ref.offset, ref.offset + ref.length);
			const at = span.indexOf(`"${before}"`);
			if (at === -1) { continue; }
			const start = document.positionAt(ref.offset + at);
			edit.replace(
				document.uri,
				new vscode.Range(start, start.translate(0, before.length + 2)),
				`"${after}"`,
			);
			replacements++;
		}
	}

	return { edit, replacements };
}

/**
 * Renames a NetworkTables table everywhere it is written.
 *
 * "Everywhere" is the constant's value if the key came from one, plus every
 * literal naming the same table. It is a rename of strings, which is why no
 * language server offers it and why doing it by hand leaves one behind -- and
 * the one left behind is a topic still publishing under the old name with
 * nothing reading it.
 */
export async function renameTable(
	workspace: MarsWorkspace,
	subsystemName?: string,
): Promise<void> {
	const model = workspace.model;
	const named = model.subsystems.filter((s) => s.key);
	if (!named.length) {
		vscode.window.showInformationMessage('No subsystem in this project has a table to rename.');
		return;
	}

	const subsystem = subsystemName
		? named.find((s) => s.name === subsystemName)
		: (await vscode.window.showQuickPick(
			named.map((s) => ({ label: s.name, description: `/${s.key}`, subsystem: s })),
			{ title: 'Which table?' },
		))?.subsystem;
	if (!subsystem?.key) { return; }

	const before = subsystem.key;
	const after = await vscode.window.showInputBox({
		title: `Rename the table of ${subsystem.name}`,
		value: before,
		prompt: 'Every literal and the key constant that names this table will be updated.',
		validateInput: (value) => {
			if (!value.trim()) { return 'The table needs a name.'; }
			if (value.includes('/')) { return 'A table name cannot contain a slash.'; }
			if (model.subsystems.some((s) => s !== subsystem && s.key === value)) {
				return `${value} is already the table of another subsystem.`;
			}
			return undefined;
		},
	});
	if (!after || after === before) { return; }

	const { edit, replacements } = await planTableRename(model, subsystem, after);
	if (!replacements) {
		vscode.window.showWarningMessage(
			`Nothing to rename: "${before}" is not written as a literal or a string constant anywhere.`);
		return;
	}

	await vscode.workspace.applyEdit(edit);
	await workspace.refresh();
	vscode.window.showInformationMessage(
		`Renamed /${before} to /${after} in ${replacements} ${replacements === 1 ? 'place' : 'places'}.`);
}
