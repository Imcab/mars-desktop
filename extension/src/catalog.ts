// What each MARS type is for, in one sentence, plus the sentence after it that
// people actually need.
//
// This is the friction the extension exists to remove: every team using the
// vendordep currently answers "what is a Request, and what am I supposed to
// return from it" by leaving the editor and reading the documentation site.
// Javadoc is on the classpath and the Java language server will show it, but
// only for the class under the cursor and only what fits in a doc comment --
// it cannot say which of two things you want, or what the surrounding pattern
// is. That is what the notes here are: the part that does not fit in Javadoc.
//
// Keeping this list honest is a real cost, so it stays deliberately short. The
// entries are the types somebody meets in their first week, not the whole API.

export interface ApiEntry {
	/** Simple name, and what the hover matches on. */
	name: string;
	/** Java package, used to build the Javadoc link. */
	packageName: string;
	kind: 'class' | 'interface' | 'annotation' | 'enum' | 'record';
	/** One line. Shown as the first line of the hover. */
	summary: string;
	/** The part Javadoc does not tell you: what it is for, or what to watch out for. */
	note?: string;
	/** The signature worth seeing without opening the file. */
	signature?: string;
}

/** Where the published Javadoc lives. Written into every robot project's vendordep. */
const JAVADOC = 'https://stz-robotics.github.io/Mars/api';
const DOCS = 'https://stz-robotics.github.io/Mars/';

const MARS = 'com.stzteam.mars';
const FORGE = 'com.stzteam.forgemini.io';

export const CATALOG: readonly ApiEntry[] = [
	{
		name: 'ModularSubsystem',
		packageName: `${MARS}.models.singlemodule`,
		kind: 'class',
		summary: 'The unit of a MARS robot: hardware behind an interface, state in a Data object, behaviour in Requests.',
		note: 'Its periodic loop is final. Per-loop logic that must run whatever the current request is goes in `absolutePeriodic`, not in an override. A subsystem whose IO reports `isFallback()` skips the whole loop, so a disabled module costs nothing and throws nothing.',
		signature: 'abstract class ModularSubsystem<D extends Data<D>, A extends IO<D>> extends IOSubsystem',
	},
	{
		name: 'CompositeSubsystem',
		packageName: `${MARS}.models.multimodules`,
		kind: 'class',
		summary: 'A subsystem made of other subsystems, for the cases where several modules only make sense together.',
		signature: 'abstract class CompositeSubsystem<D extends CompositeData<D>, A extends CompositeIO<D>>',
	},
	{
		name: 'SubsystemBuilder',
		packageName: `${MARS}.models`,
		kind: 'class',
		summary: 'The configuration a ModularSubsystem is constructed from: key, hardware, initial request, telemetry.',
		note: 'The `key` is the NetworkTables table everything the subsystem publishes lands under, so it is also what MARS Desktop looks a topic up by. Address it through a `KeyManager` constant rather than a literal, and never leave it as the wizard\'s `null`.',
		signature: 'SubsystemBuilder.<D, A>setup().key(...).hardware(io, inputs).request(...).telemetry(...)',
	},
	{
		name: 'Request',
		packageName: `${MARS}.requests`,
		kind: 'interface',
		summary: 'One loop of behaviour: given the latest inputs and the hardware actor, do something and say how it went.',
		note: 'The returned `ActionStatus` is not decoration. It drives the module colour code, the alert registry and `runRequestUntilDone`, which finishes exactly when the status reports done. Override `isSameRequest` when two instances differ by a setpoint, or the transition log will treat them as one.',
		signature: 'ActionStatus apply(P parameters, A actor)',
	},
	{
		name: 'IO',
		packageName: `${MARS}.models.singlemodule`,
		kind: 'interface',
		summary: 'The hardware layer: the one part of a subsystem that is swapped between real, simulated and absent.',
		note: 'A fallback implementation returns true from `isFallback()`, and the subsystem then skips its entire periodic loop. That is the mechanism that makes a half-built robot safe to run, rather than a source of null checks.',
		signature: 'void updateInputs(T inputs)',
	},
	{
		name: 'Data',
		packageName: `${MARS}.models.singlemodule`,
		kind: 'class',
		summary: 'A snapshot of what the hardware read this loop. Public fields, no logic.',
		note: 'It carries a `timestamp` taken when the object was created, and `snapshot()` casts it back to the concrete type so requests and telemetry get it typed without casting themselves.',
		signature: 'class Data<T>',
	},
	{
		name: 'Telemetry',
		packageName: `${MARS}.models`,
		kind: 'class',
		summary: 'Where a subsystem\'s data reaches NetworkTables, and the only place it should.',
		note: 'Called once per loop with the same snapshot the request saw. Publishing from inside a request instead means the topic updates only while that request is running.',
		signature: 'abstract void telemeterize(D data)',
	},
	{
		name: 'ActionStatus',
		packageName: `${MARS}.diagnostics`,
		kind: 'class',
		summary: 'What a request reports back: a colour code, a message and when it was said.',
		note: '`ok()`, `warning(msg)` and `error(msg)` cover the generic cases; `of(code, args...)` formats the code\'s own message template. `isDone()` is what `runRequestUntilDone` waits on.',
		signature: 'ActionStatus.ok() | warning(String) | error(String) | of(StatusColorCode, Object...)',
	},
	{
		name: 'ModuleColorCode',
		packageName: `${MARS}.diagnostics`,
		kind: 'record',
		summary: 'A status a subsystem can be in: a name, a severity, an LED pattern and a message template.',
		signature: 'ModuleColorCode.solid(String name, Severity severity, Color color, String template)',
	},
	{
		name: 'GlobalColorCode',
		packageName: `${MARS}.diagnostics`,
		kind: 'enum',
		summary: 'The statuses every subsystem shares: NOMINAL, WORKING, TIMEOUT, HARDWARE_FAULT.',
	},
	{
		name: 'Injector',
		packageName: `${MARS}.builder`,
		kind: 'class',
		summary: 'Picks which IO implementation to build from the Manifest flag and the Environment run mode.',
		note: 'A disabled module gets the fallback immediately. An enabled one gets the real layer in `REAL` mode, and if constructing it throws, the fallback rather than a crash on boot -- which is why the real supplier is a lambda and not an instance.',
		signature: 'Injector.createIO(boolean isEnabled, Supplier<T> fallback, Supplier<T> real, Supplier<T> sim)',
	},
	{
		name: 'Environment',
		packageName: `${MARS}.builder`,
		kind: 'class',
		summary: 'The run mode the whole robot is in: REAL, SIM or REPLAY.',
		note: 'Set once, from `Manifest.CURRENT_MODE`, before anything is constructed. Everything downstream reads it and nothing else writes it.',
	},
	{
		name: 'Blackboard',
		packageName: `${MARS}.blackboard`,
		kind: 'class',
		summary: 'A typed noticeboard for values one subsystem produces and another needs, without either importing the other.',
		note: '`read` returns an `Optional` because nothing guarantees anybody wrote the key this loop. The type argument of the key and its `Class` object have to agree, and nothing checks that they do.',
		signature: 'write(BlackboardKey<T>, T) | Optional<T> read(BlackboardKey<T>)',
	},
	{
		name: 'BlackboardKey',
		packageName: `${MARS}.blackboard`,
		kind: 'class',
		summary: 'A name plus the type stored under it. Declare these once, as constants, next to the other keys.',
		signature: 'new BlackboardKey<>(String name, Class<T> type)',
	},
	{
		name: 'Node',
		packageName: `${MARS}.services.nodes`,
		kind: 'class',
		summary: 'Something that produces a message every loop without owning hardware: vision, an odometry fuser, a planner.',
		note: 'Nodes do not tick themselves. `IRobotContainer.updateNodes()` is called from `robotPeriodic`, and a node nothing calls there simply never runs.',
		signature: 'Node(String nodeName, M emptyMessage, Consumer<M> topicPublisher)',
	},
	{
		name: 'NodeMessage',
		packageName: `${MARS}.services.nodes`,
		kind: 'class',
		summary: 'What a Node publishes, and how it puts itself on NetworkTables.',
		signature: 'abstract void telemeterize(String tableName)',
	},
	{
		name: 'Service',
		packageName: `${MARS}.services`,
		kind: 'interface',
		summary: 'A query/reply pair, for what is asked once rather than run every loop.',
	},
	{
		name: 'IRobotContainer',
		packageName: `${MARS}.models.containers`,
		kind: 'interface',
		summary: 'What Robot.java drives: where subsystems are built, where nodes get their tick, and which routine test mode runs.',
	},
	{
		name: 'Binding',
		packageName: `${MARS}.models.containers`,
		kind: 'interface',
		summary: 'Controller wiring, kept out of the container so the two can change independently.',
	},
	{
		name: 'ControllerOI',
		packageName: `${MARS}.operator`,
		kind: 'interface',
		summary: 'A gamepad described by position rather than brand: sticks, bumpers, the four action buttons, the D-pad.',
		note: 'Binding against this instead of a `CommandXboxController` is what lets a PS5 pad replace an Xbox one without touching a single binding. `XboxOI` and `PS5OI` are the two implementations.',
	},
	{
		name: 'TestRoutine',
		packageName: `${MARS}.test`,
		kind: 'class',
		summary: 'The systems check that runs in test mode, with assertions that fail loudly instead of quietly.',
		note: '`assertLessThan`, `assertGreaterThan` and `assertTrue` build commands, so they compose with `andThen` and `delay` like any other command.',
	},
	{
		name: 'MARSWatchdog',
		packageName: `${MARS}.diagnostics`,
		kind: 'class',
		summary: 'Wraps each subsystem\'s loop and reports how long it took under the WatchDog table.',
	},
	{
		name: 'AlertRegistry',
		packageName: `${MARS}.diagnostics`,
		kind: 'class',
		summary: 'Collects every non-OK ActionStatus into one place the dashboard reads. Can be switched off wholesale.',
	},
	{
		name: 'NetworkIO',
		packageName: FORGE,
		kind: 'class',
		summary: 'Publishing one value on NetworkTables: a table, a key, a value.',
		note: 'The table argument is what MARS Desktop groups by, so it should be the subsystem\'s key constant. Both arguments being literals is what lets a topic be traced back to this line.',
		signature: 'NetworkIO.set(String table, String key, T value)',
	},
	{
		name: 'IOSubsystem',
		packageName: FORGE,
		kind: 'class',
		summary: 'The ForgeMini base that gives a subsystem its NetworkTables table. ModularSubsystem extends it.',
	},
	{
		name: 'Tunable',
		packageName: 'annotation',
		kind: 'annotation',
		summary: 'A field the dashboard can write back into, live.',
		note: 'The topic is the subsystem\'s table plus the annotation\'s `key`, or the field\'s own name when no key is given.',
		signature: '@Tunable(key = "kP")',
	},
	{
		name: 'Signal',
		packageName: 'annotation',
		kind: 'annotation',
		summary: 'A method whose return value is published every loop.',
		note: 'The topic is the subsystem\'s table plus the annotation\'s `key`, or the method\'s own name when no key is given.',
		signature: '@Signal(key = "velocity")',
	},
	{
		name: 'Fallback',
		packageName: 'annotation',
		kind: 'annotation',
		summary: 'Asks MarsProcessor to generate the do-nothing implementation of an IO interface at build time.',
		note: 'Comes from the MarsProcessor package, not from MARS core: a project without it installed will not compile this.',
	},
	{
		name: 'Unit',
		packageName: 'annotation',
		kind: 'annotation',
		summary: 'Declares the physical unit of a field or parameter, checked at build time.',
		note: 'Comes from the UnitProcessor package and reads the units named in the project\'s `ProjectUnits.json`.',
	},
];

const BY_NAME = new Map(CATALOG.map((entry) => [entry.name, entry]));

export function lookup(name: string): ApiEntry | undefined {
	return BY_NAME.get(name);
}

/**
 * The published Javadoc page for an entry, or the documentation site for the
 * annotations, which live in packages this repository does not publish.
 */
export function documentationUrl(entry: ApiEntry): string {
	if (entry.packageName === 'annotation') { return DOCS; }
	return `${JAVADOC}/${entry.packageName.replace(/\./g, '/')}/${entry.name}.html`;
}
