// The scanner is regex over Java, so the only thing that keeps it honest is
// being fed the Java people actually write. Every case here is either the shape
// MARS Desktop's subsystem wizard generates, or something that has already
// fooled the scanner once.

import * as assert from 'assert';
import { topicPath } from '../../scan/model';
import { buildModel, lex, scanFile } from '../../scan/scanner';

/** Builds a model from files given as [name, source] pairs. */
function model(...files: [string, string][]) {
	return buildModel('/project', files.map(([name, source]) => scanFile(`/project/${name}`, source)));
}

const ARM_IO = `
package frc.robot.subsystems.arm;

import com.stzteam.features.marsprocessor.Fallback;
import com.stzteam.mars.models.singlemodule.Data;
import com.stzteam.mars.models.singlemodule.IO;

@Fallback
public interface ArmIO extends IO<ArmIO.ArmInputs> {

  public static class ArmInputs extends Data<ArmInputs> {
    public double position = 0;
    public boolean atLimit = false;
  }

  public void applyOutput(double volts);
}
`;

const ARM = `
package frc.robot.subsystems.arm;

import com.stzteam.forgemini.io.NetworkIO;
import com.stzteam.mars.models.SubsystemBuilder;
import com.stzteam.mars.models.Telemetry;
import com.stzteam.mars.models.singlemodule.ModularSubsystem;
import frc.robot.configuration.KeyManager;
import frc.robot.subsystems.arm.ArmIO.ArmInputs;

public class Arm extends ModularSubsystem<ArmInputs, ArmIO> {

  @Tunable(key = "kP")
  public double gainP = 0.5;

  @Signal
  public double getVelocity() { return 0.0; }

  public Arm(ArmIO io) {
    super(
        SubsystemBuilder.<ArmInputs, ArmIO>setup()
            .key(KeyManager.ARM_KEY)
            .hardware(io, new ArmInputs())
            .request(null)
            .telemetry(new ArmTelemetry()));
  }

  @Override
  public void absolutePeriodic(ArmInputs inputs) {}

  public static class ArmTelemetry extends Telemetry<ArmInputs> {
    @Override
    public void telemeterize(ArmInputs data) {
      NetworkIO.set(KeyManager.ARM_KEY, "Position", data.position);
    }
  }
}
`;

const KEY_MANAGER = `
package frc.robot.configuration;
public class KeyManager {
    private KeyManager() {}
    public static final String ARM_KEY = "Arm";
}
`;

suite('lexing', () => {
	test('a brace in a comment does not open a body', () => {
		const { skeleton } = lex('class A { // }\n}\n');
		assert.strictEqual(skeleton.split('}').length - 1, 1, 'only the real closing brace survives');
	});

	test('a brace in a string does not open a body', () => {
		const { code, skeleton } = lex('String s = "class Ghost {";');
		assert.ok(!skeleton.includes('class Ghost'), 'the skeleton hides string contents');
		assert.ok(code.includes('class Ghost'), 'the code keeps them, because keys are read from there');
	});

	test('both forms keep the original length', () => {
		const source = 'class A { /* x */ String s = "y"; } // tail\n';
		const { code, skeleton } = lex(source);
		assert.strictEqual(code.length, source.length);
		assert.strictEqual(skeleton.length, source.length);
	});
});

suite('declarations', () => {
	test('a bounded type parameter is not a supertype', () => {
		// `class X<D extends Data<D>> extends Telemetry<D>` has two `extends` and
		// only the second one says what X is.
		const scan = scanFile('/p/EmptyTelemetry.java',
			'public class EmptyTelemetry<D extends Data<D>> extends Telemetry<D> {}');
		assert.strictEqual(scan.types[0].role, 'telemetry');
		assert.strictEqual(scan.types[0].supertype, 'Telemetry');
	});

	test('an interface extending IO is an IO interface', () => {
		const built = model(['ArmIO.java', ARM_IO]);
		const io = built.ios.find((i) => i.name === 'ArmIO');
		assert.strictEqual(io?.role, 'io');
		assert.deepStrictEqual(io?.typeArgs, ['ArmInputs']);
	});

	test('a class implementing an IO interface is found, across files', () => {
		const built = model(
			['ArmIO.java', ARM_IO],
			['ArmIOReal.java', 'package p; public class ArmIOReal implements ArmIO {}'],
		);
		assert.strictEqual(built.ios.find((i) => i.name === 'ArmIOReal')?.role, 'ioImpl');
	});

	test('the nested Data class and its public fields are read', () => {
		const built = model(['ArmIO.java', ARM_IO]);
		const data = built.data.find((d) => d.name === 'ArmInputs');
		assert.deepStrictEqual(
			data?.fields?.map((f) => `${f.javaType} ${f.name}`),
			['double position', 'boolean atLimit'],
		);
	});

	test('a method declaration is not mistaken for a field', () => {
		const built = model(['ArmIO.java', ARM_IO]);
		const names = built.data.find((d) => d.name === 'ArmInputs')?.fields?.map((f) => f.name) ?? [];
		assert.ok(!names.includes('applyOutput'));
	});
});

suite('keys', () => {
	test('a key held in a KeyManager constant is resolved', () => {
		// The wizard writes `.key(KeyManager.ARM_KEY)`, never a literal, so a
		// scanner that only understood literals would find no table at all.
		const built = model(['KeyManager.java', KEY_MANAGER], ['ArmIO.java', ARM_IO], ['Arm.java', ARM]);
		assert.strictEqual(built.subsystems[0].key, 'Arm');
	});

	test('the wizard\'s .key(null) is reported as unresolved, not as a key', () => {
		const built = model(['E.java',
			'public class E extends ModularSubsystem<EData, EIO> {'
			+ ' public E() { super(SubsystemBuilder.<EData, EIO>setup().key(null)); } }']);
		assert.strictEqual(built.subsystems[0].key, undefined);
		assert.strictEqual(built.subsystems[0].keyExpression, 'null');
	});

	test('a literal key still works', () => {
		const built = model(['A.java',
			'public class A extends ModularSubsystem<AData, AIO> {'
			+ ' public A() { super(SubsystemBuilder.<AData, AIO>setup().key("Arm")); } }']);
		assert.strictEqual(built.subsystems[0].key, 'Arm');
	});
});

suite('topics', () => {
	const built = () => model(['KeyManager.java', KEY_MANAGER], ['ArmIO.java', ARM_IO], ['Arm.java', ARM]);

	test('an annotation key wins over the member name', () => {
		const topics = built().subsystems[0].topics;
		assert.ok(topics.some((t) => topicPath(t) === '/Arm/kP'), 'the @Tunable key, not the field name');
		assert.ok(!topics.some((t) => t.key === 'gainP'));
	});

	test('an annotation with no key falls back to the member name', () => {
		assert.ok(built().subsystems[0].topics.some((t) => topicPath(t) === '/Arm/getVelocity'));
	});

	test('telemetry in a nested class still belongs to the subsystem', () => {
		// It is written inside ArmTelemetry, but it names the Arm table, and the
		// table is what decides who owns a topic.
		assert.ok(built().subsystems[0].topics.some((t) => topicPath(t) === '/Arm/Position'));
		assert.strictEqual(built().looseTopics.length, 0);
	});

	test('a key assembled at runtime is reported as unknown, not guessed', () => {
		const scan = scanFile('/p/W.java', 'NetworkIO.set("WatchDog", name, elapsed);');
		assert.strictEqual(scan.topics[0].literal, false);
		assert.strictEqual(scan.topics[0].table, 'WatchDog');
	});

	test('a table held in a variable leaves the topic unnamed', () => {
		const built = model(['M.java', 'NetworkIO.set(subKey, "Status/Hex", hex);']);
		assert.strictEqual(built.looseTopics[0].table, undefined);
		assert.strictEqual(topicPath(built.looseTopics[0]), '/?/Status/Hex');
	});
});

suite('the project as a whole', () => {
	test('a request is tied to a subsystem by the pair of types it acts on', () => {
		const built = model(
			['KeyManager.java', KEY_MANAGER], ['ArmIO.java', ARM_IO], ['Arm.java', ARM],
			['SetAngle.java',
				'package p; public class SetAngle implements Request<ArmIO.ArmInputs, ArmIO> {}'],
		);
		const request = built.requests[0];
		assert.deepStrictEqual(request.typeArgs, ['ArmInputs', 'ArmIO']);
		assert.strictEqual(request.typeArgs[0], built.subsystems[0].dataType);
	});

	test('a subsystem no container mentions is visible as an orphan', () => {
		const built = model(
			['KeyManager.java', KEY_MANAGER], ['ArmIO.java', ARM_IO], ['Arm.java', ARM],
			['RobotContainer.java',
				'package p; public class RobotContainer implements IRobotContainer { }'],
		);
		assert.strictEqual(built.containers.length, 1);
		assert.ok(!built.containerReferences.has('Arm'));
	});

	test('the run mode is read from the Manifest', () => {
		const built = model(['Manifest.java',
			'public class Manifest { public static final RunMode CURRENT_MODE = RunMode.SIM; }']);
		assert.strictEqual(built.runMode?.value, 'SIM');
	});
});
