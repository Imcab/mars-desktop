// The shape of what the scanner finds in a robot project's Java.
//
// Everything in here is the *declared* architecture, not the running one: it is
// read from source, so it is available with the robot off, and it is wrong in
// exactly the ways source can be wrong about runtime (a key built by
// concatenation, a subsystem constructed reflectively). Anything that could not
// be resolved says so rather than guessing -- see `keyExpression`.

/** A place in the project. Lines and columns are zero-based, as VS Code wants. */
export interface SourceRef {
	/** Absolute path, with the separators the platform uses. */
	path: string;
	line: number;
	column: number;
	/** Length of the thing pointed at, for the squiggle and the reveal. */
	length: number;
	/** Offset into the file text. Kept so owners can be resolved without re-counting lines. */
	offset: number;
}

export type MarsRole =
	| 'subsystem'
	| 'composite'
	| 'request'
	| 'data'
	| 'nodeMessage'
	| 'io'
	| 'ioImpl'
	| 'telemetry'
	| 'node'
	| 'service'
	| 'testRoutine'
	| 'container'
	| 'binding'
	/** A declaration MARS does not recognise. Kept because the merge pass can
	 *  still promote it: an IO implementation is only recognisable once the
	 *  interface it implements, usually in another file, has been seen. */
	| 'unknown';

/** A field of a `Data` subclass -- what the dashboard ends up graphing. */
export interface DataField {
	name: string;
	javaType: string;
	ref: SourceRef;
}

/** An abstract method of an IO interface: the contract an implementation owes. */
export interface MethodDecl {
	name: string;
	returnType: string;
	/** The parameter list exactly as written, so a signature can be reproduced. */
	parameters: string;
	ref: SourceRef;
}

/** One `class`/`interface` declaration that the scanner looked at. */
export interface TypeDecl {
	name: string;
	role: MarsRole;
	/** The `package` of the file it was declared in, or '' if there was none. */
	packageName: string;
	/** The declaration's own name token. */
	ref: SourceRef;
	/** Span of the type body, `{` to matching `}`, as offsets into the file text. */
	body: { start: number; end: number };
	/** Simple name of the supertype MARS matched on, e.g. `ModularSubsystem`. */
	supertype: string;
	/** Type arguments of that supertype, simple names: `['ArmData', 'ArmIO']`. */
	typeArgs: string[];
	/** Every interface it implements, simple names, generics stripped. */
	implemented: string[];

	/** The NT table, when this is a subsystem and the key was a literal. */
	key?: string;
	/** Where the key argument is, literal or not. */
	keyRef?: SourceRef;
	/** The expression, when the key was not a literal: `Constants.ARM_KEY`. */
	keyExpression?: string;
	/** Public fields, when this is a `Data` subclass. */
	fields?: DataField[];
	/** Abstract methods, when this is an IO interface. */
	methods?: MethodDecl[];
}

/** Where a NetworkTables topic is published from, and how sure we are of its name. */
export interface TopicDecl {
	/**
	 * The NT table. `undefined` when the publishing construct sits in a type
	 * whose key could not be resolved: a topic we know exists but cannot name.
	 */
	table?: string;
	/** The expression the table came from, when it was not written as a literal. */
	tableExpression?: string;
	key: string;
	kind: '@Tunable' | '@Signal' | 'NetworkIO.set' | 'setEntry';
	/** The field or method the annotation sits on, when the key came from there. */
	member?: string;
	/** False when the key is built at runtime rather than written in the source. */
	literal: boolean;
	/** Simple name of the type that publishes it. */
	owner?: string;
	ref: SourceRef;
}

/** A subsystem, with everything that hangs off it resolved. */
export interface SubsystemDecl extends TypeDecl {
	role: 'subsystem' | 'composite';
	dataType?: string;
	ioType?: string;
	topics: TopicDecl[];
}

/** What one file contributed. The model is the merge of these, so a single file
 *  can be re-scanned on a keystroke without touching the other forty. */
export interface FileScan {
	path: string;
	packageName: string;
	types: TypeDecl[];
	topics: TopicDecl[];
	/** Capitalised names mentioned anywhere, for the "is it ever used?" check. */
	referenced: Set<string>;
	/** Only ever set by `Manifest.java`: the `RunMode` the project is pinned to. */
	runMode?: { value: string; ref: SourceRef };
	/**
	 * `static final String` values declared in this file, under both their bare
	 * name and their `Type.NAME` form.
	 *
	 * This exists because the convention MARS Desktop's own wizard writes is
	 * `.key(KeyManager.ARM_KEY)` and not `.key("Arm")`. A scanner that only
	 * understood literals would find no table at all in a generated project,
	 * which is to say in most of them.
	 */
	constants: Map<string, string>;
}

/** The whole project's architecture, merged from every file. */
export interface MarsModel {
	root: string;
	/**
	 * Every declaration the scan saw, MARS role or not.
	 *
	 * The typed lists below are what the views read. This one exists for the
	 * things that need a type MARS has no opinion about -- the quick fix that
	 * adds a constant has to find `KeyManager`, which is just a class.
	 */
	types: TypeDecl[];
	subsystems: SubsystemDecl[];
	data: TypeDecl[];
	requests: TypeDecl[];
	ios: TypeDecl[];
	telemetry: TypeDecl[];
	nodes: TypeDecl[];
	services: TypeDecl[];
	tests: TypeDecl[];
	containers: TypeDecl[];
	bindings: TypeDecl[];
	/** Topics published outside any subsystem -- a `NetworkIO.set` in `Robot.java`. */
	looseTopics: TopicDecl[];
	runMode?: { value: string; ref: SourceRef };
	/** Names referenced from container files, used to find orphan subsystems. */
	containerReferences: Set<string>;
	/** Every `static final String` in the project, for resolving keys and tables. */
	constants: Map<string, string>;
	fileCount: number;
}

export function emptyModel(root = ''): MarsModel {
	return {
		root,
		types: [],
		subsystems: [],
		data: [],
		requests: [],
		ios: [],
		telemetry: [],
		nodes: [],
		services: [],
		tests: [],
		containers: [],
		bindings: [],
		looseTopics: [],
		containerReferences: new Set(),
		constants: new Map(),
		fileCount: 0,
	};
}

/** `/Arm/kP`, or `/?/kP` when the table could not be resolved. */
export function topicPath(topic: TopicDecl): string {
	return `/${topic.table ?? '?'}/${topic.key}`;
}
