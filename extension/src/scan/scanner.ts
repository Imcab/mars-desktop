// Reads MARS architecture out of Java source.
//
// This is a scan, not a parser -- the same posture source_map.rs takes in the
// dashboard, and for the same reason: a robot project is small, the constructs
// MARS cares about are shallow and literal, and a real Java front end would be
// three orders of magnitude of machinery for the same four regexes. What it
// costs is that nothing here resolves a constant or a concatenation, so a key
// that is not a literal is reported as "not a literal" rather than guessed.
//
// The one part done properly is the lexing: comments and string contents are
// blanked before anything else runs, so a // inside a URL or a "class Foo {"
// inside a message cannot invent declarations. Both blanked forms keep the
// original length, which is what lets an offset from either map back to source.

import {
	DataField,
	FileScan,
	MethodDecl,
	MarsModel,
	MarsRole,
	SourceRef,
	SubsystemDecl,
	TopicDecl,
	TypeDecl,
	emptyModel,
} from './model';

// ---------------------------------------------------------------------------
// Lexing
// ---------------------------------------------------------------------------

export interface Lexed {
	/** Comments blanked, string contents intact. This is what keys are read from. */
	code: string;
	/** Comments and string contents blanked. Structure only: braces, keywords. */
	skeleton: string;
}

/**
 * Blanks comments and string contents, preserving length and line breaks.
 *
 * All three Java string forms are handled, the text block included: one
 * containing a brace would otherwise unbalance every body span after it.
 */
export function lex(text: string): Lexed {
	const code: string[] = new Array(text.length);
	const skeleton: string[] = new Array(text.length);

	const put = (i: number, inCode: boolean, inSkeleton: boolean) => {
		const ch = text[i];
		const blank = ch === '\n' || ch === '\r' ? ch : ' ';
		code[i] = inCode ? ch : blank;
		skeleton[i] = inSkeleton ? ch : blank;
	};

	let i = 0;
	while (i < text.length) {
		const two = text.slice(i, i + 2);

		if (two === '//') {
			while (i < text.length && text[i] !== '\n') { put(i, false, false); i++; }
			continue;
		}
		if (two === '/*') {
			const end = text.indexOf('*/', i + 2);
			const stop = end === -1 ? text.length : end + 2;
			while (i < stop) { put(i, false, false); i++; }
			continue;
		}
		if (text.startsWith('"""', i)) {
			const end = text.indexOf('"""', i + 3);
			const stop = end === -1 ? text.length : end + 3;
			while (i < stop) { put(i, true, false); i++; }
			continue;
		}
		if (text[i] === '"' || text[i] === "'") {
			const quote = text[i];
			put(i, true, true); // the delimiters survive in both forms
			i++;
			while (i < text.length && text[i] !== quote && text[i] !== '\n') {
				if (text[i] === '\\' && i + 1 < text.length) { put(i, true, false); i++; }
				put(i, true, false);
				i++;
			}
			if (i < text.length && text[i] === quote) { put(i, true, true); i++; }
			continue;
		}
		put(i, true, true);
		i++;
	}

	return { code: code.join(''), skeleton: skeleton.join('') };
}

/** Turns offsets into line/column without re-counting newlines every time. */
export class LineIndex {
	private readonly starts: number[] = [0];

	constructor(text: string) {
		for (let i = 0; i < text.length; i++) {
			if (text[i] === '\n') { this.starts.push(i + 1); }
		}
	}

	positionAt(offset: number): { line: number; column: number } {
		let low = 0;
		let high = this.starts.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if (this.starts[mid] <= offset) { low = mid; } else { high = mid - 1; }
		}
		return { line: low, column: offset - this.starts[low] };
	}
}

function refAt(path: string, index: LineIndex, offset: number, length: number): SourceRef {
	const { line, column } = index.positionAt(offset);
	return { path, line, column, length, offset };
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/**
 * What extending or implementing each of these means to MARS.
 *
 * Matching is on the simple name, so a project's own class called `Request`
 * would be taken for the framework's. That is the trade every simple-name match
 * makes, and inside a project written against MARS it lands on the right side.
 */
const ROLE_BY_SUPERTYPE: Readonly<Record<string, MarsRole>> = {
	ModularSubsystem: 'subsystem',
	CompositeSubsystem: 'composite',
	Data: 'data',
	CompositeData: 'data',
	NodeMessage: 'nodeMessage',
	Telemetry: 'telemetry',
	Node: 'node',
	FallbackNode: 'node',
	TestRoutine: 'testRoutine',
	IO: 'io',
	CompositeIO: 'io',
	Request: 'request',
	IRobotContainer: 'container',
	Binding: 'binding',
	Service: 'service',
};

const TYPE_DECL = /\b(class|interface|enum|record)\s+(\w+)/g;
const PACKAGE = /^\s*package\s+([\w.]+)\s*;/m;

/** The longest a type header can plausibly be before we decide this is not Java. */
const MAX_HEADER = 2000;

/** Strips generics and qualification: `java.util.List<Foo>` becomes `List`. */
function simpleName(type: string): string {
	const bare = type.replace(/<[\s\S]*$/, '').trim();
	const last = bare.split('.').pop() ?? bare;
	return last.replace(/\[\]/g, '').trim();
}

/** Splits `A, B<C, D>, E` on the commas that are not inside angle brackets. */
function splitTopLevel(list: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of list) {
		if (ch === '<') { depth++; }
		else if (ch === '>') { depth--; }
		if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
		current += ch;
	}
	if (current.trim()) { parts.push(current); }
	return parts.map((p) => p.trim()).filter(Boolean);
}

/** The type arguments of the first `<...>` in `text`, as simple names. */
function typeArgsOf(text: string): string[] {
	const open = text.indexOf('<');
	if (open === -1) { return []; }
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '<') { depth++; }
		else if (text[i] === '>') {
			depth--;
			if (depth === 0) { return splitTopLevel(text.slice(open + 1, i)).map(simpleName); }
		}
	}
	return [];
}

/** Offset of the `}` closing the `{` at `open`, or the end of the text. */
function matchBrace(skeleton: string, open: number): number {
	let depth = 0;
	for (let i = open; i < skeleton.length; i++) {
		if (skeleton[i] === '{') { depth++; }
		else if (skeleton[i] === '}') {
			depth--;
			if (depth === 0) { return i; }
		}
	}
	return skeleton.length;
}

/**
 * Drops a declaration's own type parameter list.
 *
 * `class ModularSubsystem<D extends Data<D>, A extends IO<D>> extends IOSubsystem`
 * has two `extends` in it and only the last one is a supertype. Reading the
 * bounds as supertypes is how the framework's own `ModularSubsystem` ends up
 * classified as a `Data`, and any robot project with a bounded generic would
 * hit the same thing.
 */
function withoutTypeParameters(header: string): string {
	const start = header.search(/\S/);
	if (start === -1 || header[start] !== '<') { return header; }

	let depth = 0;
	for (let i = start; i < header.length; i++) {
		if (header[i] === '<') { depth++; }
		else if (header[i] === '>') {
			depth--;
			if (depth === 0) { return header.slice(i + 1); }
		}
	}
	return header;
}

/** Splits a header into what it extends and what it implements. */
function supertypesOf(rawHeader: string): { extended: string[]; implemented: string[] } {
	const header = withoutTypeParameters(rawHeader);
	const extendsAt = header.search(/\bextends\b/);
	const implementsAt = header.search(/\bimplements\b/);

	const extendsText = extendsAt === -1
		? ''
		: header.slice(extendsAt + 'extends'.length, implementsAt === -1 ? undefined : implementsAt);
	const implementsText = implementsAt === -1 ? '' : header.slice(implementsAt + 'implements'.length);

	return { extended: splitTopLevel(extendsText), implemented: splitTopLevel(implementsText) };
}

function declarations(path: string, lexed: Lexed, index: LineIndex, packageName: string): TypeDecl[] {
	const out: TypeDecl[] = [];
	TYPE_DECL.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = TYPE_DECL.exec(lexed.skeleton)) !== null) {
		const keyword = match[1];
		const name = match[2];
		const nameOffset = match.index + match[0].lastIndexOf(name);

		const brace = lexed.skeleton.indexOf('{', match.index + match[0].length);
		if (brace === -1 || brace - match.index > MAX_HEADER) { continue; }

		const header = lexed.skeleton.slice(match.index + match[0].length, brace);
		const { extended, implemented } = supertypesOf(header);

		// An interface's `extends` list is an implements list in everything but
		// spelling, and that is how `interface ArmIO extends IO<ArmData>` gets
		// recognised at all.
		const implementedNames = [...implemented, ...(keyword === 'interface' ? extended : [])]
			.map(simpleName);

		// Whichever supertype MARS recognises first decides the role, and it is
		// also the one carrying the generics that matter: ModularSubsystem<D, A>
		// for a subsystem, Request<D, A> for a request.
		const carrier = [...extended, ...implemented].find((t) => ROLE_BY_SUPERTYPE[simpleName(t)]);
		const role = carrier ? ROLE_BY_SUPERTYPE[simpleName(carrier)] : 'unknown';

		out.push({
			name,
			role,
			packageName,
			ref: refAt(path, index, nameOffset, name.length),
			body: { start: brace, end: matchBrace(lexed.skeleton, brace) },
			supertype: carrier ? simpleName(carrier) : simpleName(extended[0] ?? ''),
			typeArgs: typeArgsOf(carrier ?? ''),
			implemented: implementedNames,
		});
	}

	return out;
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

// One regex for every NetworkIO.set, capturing both arguments as written. The
// table is a literal about as often as it is a KeyManager constant, and the key
// is sometimes assembled in the loop, so classifying the arguments afterwards
// beats three regexes that each only match one of the shapes.
const NETWORK_IO_SET = /NetworkIO\s*\.\s*set\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*[,)]/g;
const SET_ENTRY = /\bsetEntry\s*\(\s*"([^"]*)"/g;

/** The value of a string literal argument, or `undefined` if it was an expression. */
function literalOf(argument: string): string | undefined {
	return /^"([^"]*)"$/.exec(argument.trim())?.[1];
}

/**
 * Reads an annotation's arguments: the explicit `key = "..."` if there is one,
 * and where the argument list ends so the member name can be found after it.
 */
function annotationArgs(code: string, at: number): { explicitKey?: string; after: number } {
	let i = at;
	while (i < code.length && /\s/.test(code[i])) { i++; }
	if (code[i] !== '(') { return { after: at }; }

	let depth = 0;
	for (let j = i; j < code.length; j++) {
		if (code[j] === '(') { depth++; }
		else if (code[j] === ')') {
			depth--;
			if (depth === 0) {
				const args = code.slice(i, j + 1);
				return { explicitKey: /key\s*=\s*"([^"]*)"/.exec(args)?.[1], after: j + 1 };
			}
		}
	}
	return { after: at };
}

/** The method name after a `@Signal`, or the field name after a `@Tunable`. */
function memberAfter(code: string, from: number, isMethod: boolean): string | undefined {
	// Skip any further annotations stacked on the same member.
	const window = code.slice(from, from + 400).replace(/^\s*(@\w+\s*(\([^)]*\))?\s*)*/, '');
	return (isMethod ? /(\w+)\s*\(/ : /(\w+)\s*(?:=|;)/).exec(window)?.[1];
}

function scanTopics(path: string, lexed: Lexed, index: LineIndex): TopicDecl[] {
	const out: TopicDecl[] = [];
	const { code } = lexed;

	NETWORK_IO_SET.lastIndex = 0;
	let set: RegExpExecArray | null;
	while ((set = NETWORK_IO_SET.exec(code)) !== null) {
		const table = literalOf(set[1]);
		const key = literalOf(set[2]);
		out.push({
			table,
			// An unresolved table keeps the expression it was written as, so the
			// merge can look it up among the project's string constants.
			tableExpression: table === undefined ? set[1].trim() : undefined,
			// A key assembled in the loop has no name to record. `<runtime>` is
			// not a guess at one: it says there is nothing here to know.
			key: key ?? '<runtime>',
			kind: 'NetworkIO.set',
			literal: key !== undefined,
			ref: refAt(path, index, set.index, set[0].length),
		});
	}

	SET_ENTRY.lastIndex = 0;
	let entry: RegExpExecArray | null;
	while ((entry = SET_ENTRY.exec(code)) !== null) {
		out.push({
			key: entry[1], kind: 'setEntry', literal: true,
			ref: refAt(path, index, entry.index, entry[0].length),
		});
	}

	for (const [annotation, isMethod] of [['@Signal', true], ['@Tunable', false]] as const) {
		let at = code.indexOf(annotation);
		while (at !== -1) {
			const { explicitKey, after } = annotationArgs(code, at + annotation.length);
			const member = memberAfter(code, after, isMethod);
			const key = explicitKey ?? member;
			if (key) {
				out.push({
					key, kind: annotation, member, literal: true,
					ref: refAt(path, index, at, annotation.length),
				});
			}
			at = code.indexOf(annotation, at + annotation.length);
		}
	}

	return out;
}

// ---------------------------------------------------------------------------
// Keys and fields
// ---------------------------------------------------------------------------

const BUILDER_KEY = /\.key\s*\(\s*("?)([^",)]*)\1\s*\)/;
const SUPER_KEY = /\bsuper\s*\(\s*("?)([^",)]*)\1\s*[,)]/;
const PUBLIC_FIELD =
	/^[ \t]*public\s+(?!class\b|interface\b|enum\b|record\b|abstract\b|static\s+final\b)((?:[\w.]+(?:<[^<>;]*>)?(?:\[\])*))\s+(\w+)\s*(?:=[^;]*)?;/gm;

/** The NT table a subsystem publishes under: its builder chain or its super call. */
function subsystemKey(path: string, lexed: Lexed, index: LineIndex, decl: TypeDecl):
	Pick<TypeDecl, 'key' | 'keyRef' | 'keyExpression'> {
	const body = lexed.code.slice(decl.body.start, decl.body.end);
	for (const pattern of [BUILDER_KEY, SUPER_KEY]) {
		const m = pattern.exec(body);
		if (!m) { continue; }
		const offset = decl.body.start + m.index + m[0].indexOf(m[2]);
		const ref = refAt(path, index, offset, m[2].length || 1);
		// The quote group comes back empty when the argument was not a string,
		// which is exactly the case the dashboard's source map cannot follow.
		return m[1] === '"'
			? { key: m[2], keyRef: ref }
			: { keyExpression: m[2].trim() || undefined, keyRef: ref };
	}
	return {};
}

// An abstract method: a return type, a name, a parameter list, and a semicolon
// where a body would be. The semicolon is what separates it from a `default`
// method, which an implementation does not have to provide.
const ABSTRACT_METHOD =
	/^[ \t]*(?:public\s+)?(?!return\b|new\b)((?:[\w.]+(?:<[^<>;]*>)?(?:\[\])*))\s+(\w+)\s*\(([^)]*)\)\s*;/gm;

/**
 * The methods an implementation of this interface has to write.
 *
 * Only the ones declared here: `updateInputs` comes from `IO<T>` itself and is
 * added by whoever generates the implementation, since it is framework
 * knowledge and not something the project's source says.
 *
 * Methods inside a nested type are skipped -- an IO interface carries its
 * `Inputs` class in its own body, and that class's members are not a contract.
 */
function interfaceMethods(
	path: string,
	lexed: Lexed,
	index: LineIndex,
	decl: TypeDecl,
	all: TypeDecl[],
): MethodDecl[] {
	const nested = all.filter(
		(t) => t !== decl && t.body.start > decl.body.start && t.body.end <= decl.body.end);

	const body = lexed.code.slice(decl.body.start, decl.body.end);
	const methods: MethodDecl[] = [];
	ABSTRACT_METHOD.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = ABSTRACT_METHOD.exec(body)) !== null) {
		const offset = decl.body.start + m.index + m[0].indexOf(m[2]);
		if (nested.some((t) => offset >= t.body.start && offset <= t.body.end)) { continue; }
		methods.push({
			name: m[2],
			returnType: m[1].trim(),
			parameters: m[3].trim(),
			ref: refAt(path, index, offset, m[2].length),
		});
	}
	return methods;
}

function dataFields(path: string, lexed: Lexed, index: LineIndex, decl: TypeDecl): DataField[] {
	const body = lexed.code.slice(decl.body.start, decl.body.end);
	const fields: DataField[] = [];
	PUBLIC_FIELD.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = PUBLIC_FIELD.exec(body)) !== null) {
		const offset = decl.body.start + m.index + m[0].lastIndexOf(m[2]);
		fields.push({ name: m[2], javaType: m[1].trim(), ref: refAt(path, index, offset, m[2].length) });
	}
	return fields;
}

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------

const RUN_MODE = /CURRENT_MODE\s*=\s*RunMode\s*\.\s*(\w+)/;
const CAPITALISED = /\b([A-Z]\w*)\b/g;
const STRING_CONSTANT = /\bstatic\s+final\s+String\s+(\w+)\s*=\s*"([^"]*)"\s*;/g;

/**
 * The `static final String` values in the file, under both their bare name and
 * their `Type.NAME` form.
 *
 * Without this the scanner would find almost no tables in a real project: the
 * subsystem wizard in MARS Desktop writes `.key(KeyManager.ARM_KEY)`, never a
 * literal, and the telemetry it generates addresses the same constant. The
 * dashboard's own source map stops at that constant; here there is no reason to,
 * since every file has already been read.
 */
function stringConstants(lexed: Lexed, types: TypeDecl[]): Map<string, string> {
	const constants = new Map<string, string>();
	STRING_CONSTANT.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = STRING_CONSTANT.exec(lexed.code)) !== null) {
		const owner = types
			.filter((t) => m!.index >= t.body.start && m!.index <= t.body.end)
			.sort((a, b) => (a.body.end - a.body.start) - (b.body.end - b.body.start))[0];
		constants.set(m[1], m[2]);
		if (owner) { constants.set(`${owner.name}.${m[1]}`, m[2]); }
	}
	return constants;
}

export function scanFile(path: string, text: string): FileScan {
	const lexed = lex(text);
	const index = new LineIndex(text);
	const packageName = PACKAGE.exec(lexed.code)?.[1] ?? '';

	const types = declarations(path, lexed, index, packageName);

	for (const type of types) {
		if (type.role === 'subsystem' || type.role === 'composite') {
			Object.assign(type, subsystemKey(path, lexed, index, type));
		} else if (type.role === 'data' || type.role === 'nodeMessage') {
			type.fields = dataFields(path, lexed, index, type);
		} else if (type.role === 'io') {
			type.methods = interfaceMethods(path, lexed, index, type, types);
		}
	}

	// Attribute each topic to the innermost type whose body contains it, so a
	// @Tunable in a nested class is not credited to the class around it.
	const topics = scanTopics(path, lexed, index);
	for (const topic of topics) {
		topic.owner = types
			.filter((t) => topic.ref.offset >= t.body.start && topic.ref.offset <= t.body.end)
			.sort((a, b) => (a.body.end - a.body.start) - (b.body.end - b.body.start))[0]?.name;
	}

	const referenced = new Set<string>();
	CAPITALISED.lastIndex = 0;
	let id: RegExpExecArray | null;
	while ((id = CAPITALISED.exec(lexed.skeleton)) !== null) { referenced.add(id[1]); }

	const mode = RUN_MODE.exec(lexed.code);

	return {
		path,
		packageName,
		types,
		topics,
		referenced,
		constants: stringConstants(lexed, types),
		runMode: mode ? { value: mode[1], ref: refAt(path, index, mode.index, mode[0].length) } : undefined,
	};
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Builds the project model out of per-file scans.
 *
 * Two things can only happen here: an IO implementation is recognised by the
 * interface it implements, which usually lives in another file, and a
 * subsystem's key has to be pushed down onto the topics whose table it is.
 */
export function buildModel(root: string, scans: Iterable<FileScan>): MarsModel {
	const all = [...scans];
	const types = all.flatMap((s) => s.types);

	const ioInterfaces = new Set(types.filter((t) => t.role === 'io').map((t) => t.name));
	for (const type of types) {
		if (type.role === 'unknown' && type.implemented.some((i) => ioInterfaces.has(i))) {
			type.role = 'ioImpl';
		}
	}

	// One map for the whole project: a key constant is declared in KeyManager and
	// used from every subsystem, so resolution cannot be a per-file affair.
	const constants = new Map<string, string>();
	for (const scan of all) {
		for (const [name, value] of scan.constants) { constants.set(name, value); }
	}

	/** The literal behind `KeyManager.ARM_KEY`, or `ARM_KEY`, if there is one. */
	const resolve = (expression: string | undefined): string | undefined => {
		if (!expression) { return undefined; }
		return constants.get(expression) ?? constants.get(expression.split('.').pop() ?? '');
	};

	for (const type of types) {
		if (type.key === undefined) { type.key = resolve(type.keyExpression); }
	}
	for (const topic of all.flatMap((s) => s.topics)) {
		if (topic.table === undefined) { topic.table = resolve(topic.tableExpression); }
	}

	const subsystems: SubsystemDecl[] = [];
	for (const scan of all) {
		for (const type of scan.types) {
			if (type.role !== 'subsystem' && type.role !== 'composite') { continue; }
			// The annotation and setEntry forms carry no table of their own: the
			// table is the key of the class they are written in, so only the ones
			// the subsystem itself declares count.
			const topics = scan.topics.filter((t) => t.owner === type.name && t.kind !== 'NetworkIO.set');
			for (const topic of topics) { topic.table = type.key; }

			const [dataType, ioType] = type.typeArgs;
			subsystems.push({ ...type, role: type.role, dataType, ioType, topics });
		}
	}

	// A NetworkIO.set names its own table, so it belongs to whichever subsystem
	// claims that table -- not to whichever class it is written in. That is what
	// puts a subsystem's telemetry under it, and its telemetry is almost always a
	// nested class or a separate file.
	for (const topic of all.flatMap((s) => s.topics)) {
		if (topic.kind !== 'NetworkIO.set' || topic.table === undefined) { continue; }
		subsystems.find((s) => s.key === topic.table)?.topics.push(topic);
	}
	for (const subsystem of subsystems) {
		subsystem.topics.sort((a, b) =>
			a.ref.path.localeCompare(b.ref.path) || a.ref.offset - b.ref.offset);
	}

	const owned = new Set(subsystems.flatMap((s) => s.topics));
	const containerReferences = new Set<string>();
	for (const scan of all) {
		if (!scan.types.some((t) => t.role === 'container')) { continue; }
		for (const name of scan.referenced) { containerReferences.add(name); }
	}

	const of = (...roles: MarsRole[]) => types.filter((t) => roles.includes(t.role));

	return {
		...emptyModel(root),
		types,
		subsystems,
		data: of('data', 'nodeMessage'),
		requests: of('request'),
		ios: of('io', 'ioImpl'),
		telemetry: of('telemetry'),
		nodes: of('node'),
		services: of('service'),
		tests: of('testRoutine'),
		containers: of('container'),
		bindings: of('binding'),
		looseTopics: all.flatMap((s) => s.topics).filter((t) => !owned.has(t)),
		runMode: all.find((s) => s.runMode)?.runMode,
		containerReferences,
		constants,
		fileCount: all.length,
	};
}

export { subsystemKey, dataFields, simpleName };
