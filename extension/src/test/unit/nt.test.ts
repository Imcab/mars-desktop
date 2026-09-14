// The NetworkTables client, against a server that speaks the protocol.
//
// There is no robot in a test run, and mocking the client's own socket would
// only assert that it calls the methods it calls. So this stands up a real
// WebSocket server, has it say the things an NT4 server says -- an announce, a
// binary value frame -- and checks what comes out the other side. It is the
// only way the wire format gets checked at all: everything above this file
// trusts that a `double` frame decodes to a number.

import * as assert from 'assert';
import { NT4Client, teamAddress } from '../../nt/client';
import { format, parse } from '../../nt/live';
import { FakeServer, until } from '../fakeNt';

suite('the NetworkTables client', () => {
	let server: FakeServer;
	let client: NT4Client;

	setup(async () => {
		server = await FakeServer.start();
		client = new NT4Client();
	});

	teardown(async () => {
		client.dispose();
		await server.close();
	});

	async function connected(): Promise<void> {
		client.connect({ label: 'test', host: 'localhost', port: server.port });
		await until('the connection', () => client.state === 'connected');
		await until('the subscription', () => server.text.length > 0);
	}

	test('it connects as an NT4 client and subscribes on the way in', async () => {
		await connected();

		assert.ok(server.url?.startsWith('/nt/'), `the path identifies the client: ${server.url}`);
		assert.strictEqual(server.protocol, 'v4.1.networktables.first.wpi.edu');

		const subscribe = server.text.find((m) => m.method === 'subscribe');
		assert.ok(subscribe, `expected a subscribe, got ${server.text.map((m) => m.method)}`);
		assert.ok(subscribe.params.options.prefix, 'it has to be a prefix subscription');
		assert.deepStrictEqual(subscribe.params.topics, ['/'],
			'with no tables known yet it falls back to everything');
	});

	test('it narrows the subscription to the tables it is told about', async () => {
		client.subscribeTo(['/Arm/', '/Elevator/']);
		await connected();

		const subscribe = server.text.find((m) => m.method === 'subscribe');
		assert.deepStrictEqual(subscribe!.params.topics, ['/Arm/', '/Elevator/']);
	});

	test('an announced topic gains its value from the binary frame', async () => {
		await connected();

		server.announce('/Arm/kP', 7, 'double');
		await until('the announce', () => client.typeOf('/Arm/kP') === 'double');

		server.value(7, 1, 0.82);
		await until('the value', () => client.valueOf('/Arm/kP') !== undefined);

		assert.strictEqual(client.valueOf('/Arm/kP'), 0.82);
	});

	test('a frame for a topic that was never announced is ignored, not guessed', async () => {
		await connected();
		// Ids mean nothing without the announce that named them.
		server.value(99, 1, 1.0);
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.strictEqual(client.known.size, 0);
	});

	test('the other NT types survive the round trip', async () => {
		await connected();
		const cases: [string, number, unknown][] = [
			['/T/flag', 0, true],
			['/T/count', 2, 42],
			['/T/name', 4, 'shooter'],
			['/T/xs', 17, [1.5, 2.5]],
		];
		cases.forEach(([name, typeId], index) => server.announce(name, index + 1, String(typeId)));
		await until('the announces', () => client.known.size === cases.length);

		cases.forEach(([, typeId, value], index) => server.value(index + 1, typeId, value));
		await until('the values', () => cases.every(([name]) => client.valueOf(name) !== undefined));

		assert.strictEqual(client.valueOf('/T/flag'), true);
		assert.strictEqual(client.valueOf('/T/count'), 42);
		assert.strictEqual(client.valueOf('/T/name'), 'shooter');
		assert.deepStrictEqual(client.valueOf('/T/xs'), [1.5, 2.5]);
	});

	test('writing a value publishes the topic once and then sends frames', async () => {
		await connected();
		server.announce('/Arm/kP', 7, 'double');
		await until('the announce', () => client.typeOf('/Arm/kP') === 'double');

		assert.ok(client.set('/Arm/kP', 1.5));
		await until('the publish', () => server.text.some((m) => m.method === 'publish'));
		await until('the value frame', () => server.binary.length > 0);

		const publish = server.text.find((m) => m.method === 'publish')!;
		assert.strictEqual(publish.params.name, '/Arm/kP');
		assert.strictEqual(publish.params.type, 'double');

		const [pubuid, timestamp, typeId, value] = server.binary[0] as number[];
		assert.strictEqual(pubuid, publish.params.pubuid);
		// Timestamp 0 asks the server to stamp it, which is what a client with no
		// time offset is supposed to do.
		assert.strictEqual(timestamp, 0);
		assert.strictEqual(typeId, 1);
		assert.strictEqual(value, 1.5);

		// A second write reuses the publisher rather than announcing again.
		assert.ok(client.set('/Arm/kP', 2.5));
		await until('the second frame', () => server.binary.length > 1);
		assert.strictEqual(server.text.filter((m) => m.method === 'publish').length, 1);
	});

	test('a write to a topic of unknown type is refused rather than guessed', async () => {
		await connected();
		assert.strictEqual(client.set('/Never/announced', 1), false);
	});

	test('a write with no connection is refused', () => {
		assert.strictEqual(client.set('/Arm/kP', 1, 'double'), false);
	});
});

suite('addresses', () => {
	test('a team number becomes the roboRIO address', () => {
		assert.strictEqual(teamAddress('3472'), '10.34.72.2');
		assert.strictEqual(teamAddress('254'), '10.2.54.2');
		assert.strictEqual(teamAddress('12'), '10.0.12.2');
		assert.strictEqual(teamAddress('9999'), '10.99.99.2');
	});

	test('nonsense does not become an address', () => {
		assert.strictEqual(teamAddress(''), undefined);
		assert.strictEqual(teamAddress('12345'), undefined);
	});
});

suite('values on screen', () => {
	test('a number is short enough to sit at the end of a line', () => {
		assert.strictEqual(format(0.8234567), '0.823');
		assert.strictEqual(format(5), '5');
		assert.strictEqual(format(1.5), '1.5');
		// No trailing zeroes: 2.100 reads as more precision than there is.
		assert.strictEqual(format(2.1), '2.1');
	});

	test('the other types say what they are', () => {
		assert.strictEqual(format(true), 'true');
		assert.strictEqual(format('idle'), '"idle"');
		assert.strictEqual(format([1, 2]), '[1, 2]');
		assert.strictEqual(format([1, 2, 3, 4]), '[1, 2, 3, …] (4)');
		assert.strictEqual(format(new Uint8Array(9)), '9 bytes');
		assert.strictEqual(format(undefined), undefined);
	});

	test('typed text is only accepted when it fits the topic', () => {
		assert.strictEqual(parse('1.5', 'double'), 1.5);
		assert.strictEqual(parse('true', 'boolean'), true);
		assert.strictEqual(parse('0', 'boolean'), false);
		assert.strictEqual(parse('7', 'int'), 7);
		assert.strictEqual(parse('anything', 'string'), 'anything');

		assert.strictEqual(parse('', 'double'), undefined);
		assert.strictEqual(parse('yes', 'boolean'), undefined);
		assert.strictEqual(parse('1.5', 'int'), undefined, 'an int is not a rounded double');
		// Arrays have no one-line syntax worth guessing at, and the value would
		// go to a robot.
		assert.strictEqual(parse('[1, 2]', 'double[]'), undefined);
	});
});
