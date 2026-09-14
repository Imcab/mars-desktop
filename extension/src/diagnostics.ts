// The problems only a MARS-aware reader can see.
//
// None of these is a Java error, so no Java language server will ever report
// them: the code compiles, the robot boots, and the mistake shows up as a
// dashboard with two graphs fighting over one topic, or a subsystem that never
// runs because nothing constructed it, or a competition match spent wondering
// why the hardware is not moving with the Manifest still pinned to SIM.
//
// Every rule here costs somebody an afternoon at least once. The bar for adding
// one is that: a mistake with a silent runtime symptom and a visible cause in
// source. Rules that are merely stylistic do not belong -- an editor that cries
// wolf gets its squiggles turned off, and then the real ones go too.

import * as vscode from 'vscode';
import { MarsProject } from './project';
import { MarsModel, SourceRef, TopicDecl, topicPath } from './scan/model';

export const DIAGNOSTIC_SOURCE = 'MARS';

function toRange(ref: SourceRef): vscode.Range {
	const start = new vscode.Position(ref.line, ref.column);
	return new vscode.Range(start, start.translate(0, Math.max(ref.length, 1)));
}

function at(ref: SourceRef, message: string, code: string, severity: vscode.DiagnosticSeverity) {
	const diagnostic = new vscode.Diagnostic(toRange(ref), message, severity);
	diagnostic.source = DIAGNOSTIC_SOURCE;
	diagnostic.code = code;
	return { uri: vscode.Uri.file(ref.path), diagnostic };
}

/** A diagnostic plus the file it belongs to, before they are grouped per file. */
type Finding = ReturnType<typeof at>;

const { Error, Warning, Information } = vscode.DiagnosticSeverity;

/** Points a diagnostic at the other place involved, so both ends are one click apart. */
function relate(finding: Finding, refs: SourceRef[], note: string): Finding {
	finding.diagnostic.relatedInformation = refs.map((ref) => new vscode.DiagnosticRelatedInformation(
		new vscode.Location(vscode.Uri.file(ref.path), toRange(ref)), note));
	return finding;
}

// ---------------------------------------------------------------------------
// Rules over the scanned model
// ---------------------------------------------------------------------------

/**
 * Two subsystems claiming the same NetworkTables table.
 *
 * They do not collide at construction -- nothing checks -- they collide on the
 * wire, where the second one's status and tunables overwrite the first one's
 * under the same names.
 */
function duplicateKeys(model: MarsModel): Finding[] {
	const byKey = new Map<string, typeof model.subsystems>();
	for (const subsystem of model.subsystems) {
		if (!subsystem.key) { continue; }
		const group = byKey.get(subsystem.key) ?? [];
		group.push(subsystem);
		byKey.set(subsystem.key, group);
	}

	const findings: Finding[] = [];
	for (const [key, group] of byKey) {
		if (group.length < 2) { continue; }
		for (const subsystem of group) {
			const others = group.filter((s) => s !== subsystem);
			findings.push(relate(
				at(
					subsystem.keyRef ?? subsystem.ref,
					`"${key}" is also the key of ${others.map((s) => s.name).join(', ')}. `
					+ 'Both publish under the same table and overwrite each other.',
					'mars.duplicateKey',
					Error,
				),
				others.map((s) => s.keyRef ?? s.ref),
				'the other subsystem with this key',
			));
		}
	}
	return findings;
}

/** Two topics with the same full path, whoever publishes them. */
function topicCollisions(model: MarsModel): Finding[] {
	const all: TopicDecl[] = [
		...model.subsystems.flatMap((s) => s.topics),
		...model.looseTopics,
	].filter((t) => t.literal && t.table);

	const byPath = new Map<string, TopicDecl[]>();
	for (const topic of all) {
		const path = topicPath(topic);
		const group = byPath.get(path) ?? [];
		group.push(topic);
		byPath.set(path, group);
	}

	const findings: Finding[] = [];
	for (const [path, group] of byPath) {
		if (group.length < 2) { continue; }
		for (const topic of group) {
			const others = group.filter((t) => t !== topic);
			findings.push(relate(
				at(
					topic.ref,
					`${path} is published from ${group.length} places. `
					+ 'The last write each loop is the one the dashboard sees.',
					'mars.topicCollision',
					Warning,
				),
				others.map((t) => t.ref),
				'also publishes this topic',
			));
		}
	}
	return findings;
}

/**
 * A subsystem with no usable NetworkTables table.
 *
 * Three different mistakes end up here and they are worth telling apart. The
 * first is the one the subsystem wizard leaves behind: it writes `.key(null)`
 * with a TODO next to it, and a project that ships that way has a subsystem
 * whose name is null on the wire. The second is a key built from something the
 * scanner could not follow. The third is no key at all.
 */
function unreadableKeys(model: MarsModel): Finding[] {
	const findings: Finding[] = [];
	for (const subsystem of model.subsystems) {
		if (subsystem.key !== undefined) { continue; }

		if (subsystem.keyExpression === 'null') {
			findings.push(at(
				subsystem.keyRef ?? subsystem.ref,
				`${subsystem.name} still has the wizard's .key(null). Point it at a KeyManager `
				+ 'constant, or it publishes under no table at all.',
				'mars.nullKey',
				Warning,
			));
		} else if (subsystem.keyExpression && subsystem.keyRef) {
			findings.push(at(
				subsystem.keyRef,
				`The table name comes from ${subsystem.keyExpression}, which is not a string constant `
				+ 'this extension could resolve. Its topics cannot be named here or traced in MARS Desktop.',
				'mars.nonLiteralKey',
				Information,
			));
		} else {
			findings.push(at(
				subsystem.ref,
				`${subsystem.name} never sets a key. Give SubsystemBuilder a .key(...) `
				+ 'so its data has a table to publish under.',
				'mars.missingKey',
				Warning,
			));
		}
	}
	return findings;
}

/**
 * A subsystem nothing ever constructs.
 *
 * A `ModularSubsystem` only runs because something built it and the command
 * scheduler got hold of it; one that no container mentions is dead code that
 * looks alive. Only reported when a container was actually found, so a project
 * that keeps its wiring somewhere else is not nagged about every class.
 */
function orphanSubsystems(model: MarsModel): Finding[] {
	if (!model.containers.length) { return []; }
	return model.subsystems
		.filter((s) => !model.containerReferences.has(s.name))
		.map((s) => at(
			s.ref,
			`${s.name} is never mentioned in ${model.containers.map((c) => c.name).join(' or ')}. `
			+ 'Nothing constructs it, so it never runs.',
			'mars.orphanSubsystem',
			Warning,
		));
}

/** An IO interface with nothing implementing it: the subsystem has no hardware layer. */
function unimplementedIo(model: MarsModel): Finding[] {
	const implementations = model.ios.filter((i) => i.role === 'ioImpl');
	return model.ios
		.filter((io) => io.role === 'io')
		.filter((io) => !implementations.some((i) => i.implemented.includes(io.name)))
		.map((io) => at(
			io.ref,
			`Nothing implements ${io.name}. Injector.createIO has no real or simulated layer to hand out here.`,
			'mars.unimplementedIo',
			Information,
		));
}

/**
 * The Manifest pinned to anything but REAL.
 *
 * This is the one that costs a match. It is a warning and not an error because
 * it is also exactly what you want while developing -- the point is that it is
 * visible, not that it is forbidden.
 */
function runMode(model: MarsModel): Finding[] {
	const mode = model.runMode;
	if (!mode || mode.value === 'REAL') { return []; }
	return [at(
		mode.ref,
		`The Manifest is pinned to RunMode.${mode.value}. The robot will not drive real hardware until this is REAL.`,
		'mars.runMode',
		Warning,
	)];
}

// ---------------------------------------------------------------------------
// Rules over the project's descriptors
// ---------------------------------------------------------------------------

function parseVersion(version: string): number[] {
	return version.split(/[.\-+]/).map((part) => Number.parseInt(part, 10)).filter((n) => !Number.isNaN(n));
}

function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0);
		if (diff !== 0) { return diff; }
	}
	return 0;
}

/**
 * Whether `version` satisfies a requirement like `>=1.6.0`.
 *
 * Deliberately small: MARS Feature descriptors use one comparator and a plain
 * version, never a range or a caret, so a semver dependency would be a megabyte
 * for an `if`. Anything it does not recognise is treated as satisfied, because
 * refusing to understand a descriptor is not grounds for a warning.
 */
export function satisfies(version: string, requirement: string): boolean {
	const match = /^\s*(>=|<=|>|<|=|\^|~)?\s*v?([\d.]+)\s*$/.exec(requirement);
	if (!match) { return true; }
	const comparison = compareVersions(version, match[2]);
	switch (match[1]) {
		case '>': return comparison > 0;
		case '<': return comparison < 0;
		case '<=': return comparison <= 0;
		case '=': return comparison === 0;
		// `^` and `~` are not in the descriptors today; treating them as a floor
		// is the reading that does not invent a ceiling nobody wrote down.
		default: return comparison >= 0;
	}
}

/**
 * An installed Feature that needs a newer MARS core than the vendordep carries.
 *
 * The symptom without this is a Gradle build that fails on a method that does
 * not exist yet, with nothing pointing at the package that wanted it.
 */
async function featureRequirements(project: MarsProject): Promise<Finding[]> {
	const core = project.mars?.version;
	if (!core) { return []; }

	const findings: Finding[] = [];
	for (const feature of project.features) {
		if (!feature.marsCoreRequired || satisfies(core, feature.marsCoreRequired)) { continue; }

		// The descriptor is JSON, so the range has to be found in the text rather
		// than carried along by a scan.
		let line = 0;
		let column = 0;
		let length = feature.marsCoreRequired.length;
		try {
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(feature.uri));
			const lines = text.split(/\r?\n/);
			const found = lines.findIndex((l) => l.includes('marsCoreRequired'));
			if (found >= 0) {
				line = found;
				column = lines[found].search(/\S/);
				length = lines[found].trim().length;
			}
		} catch {
			// Nothing to point at is still worth reporting; it lands on line 1.
		}

		findings.push(at(
			{ path: feature.uri.fsPath, line, column, length, offset: 0 },
			`${feature.name} needs MARS core ${feature.marsCoreRequired}, and this project has ${core}. `
			+ 'Update the Mars vendordep before building.',
			'mars.featureRequirement',
			Warning,
		));
	}
	return findings;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** Runs every rule and republishes the whole collection. */
export async function publishDiagnostics(
	collection: vscode.DiagnosticCollection,
	model: MarsModel,
	project: MarsProject | undefined,
): Promise<void> {
	collection.clear();
	if (!project) { return; }

	const findings = [
		...duplicateKeys(model),
		...topicCollisions(model),
		...unreadableKeys(model),
		...orphanSubsystems(model),
		...unimplementedIo(model),
		...runMode(model),
		...await featureRequirements(project),
	];

	const byFile = new Map<string, vscode.Diagnostic[]>();
	for (const { uri, diagnostic } of findings) {
		const list = byFile.get(uri.fsPath) ?? [];
		list.push(diagnostic);
		byFile.set(uri.fsPath, list);
	}
	for (const [path, diagnostics] of byFile) {
		collection.set(vscode.Uri.file(path), diagnostics);
	}
}
