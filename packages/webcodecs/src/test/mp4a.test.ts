import {expect, test} from 'bun:test';
import {createMp4a} from '../create/iso-base-media/codec-specific/mp4a';

const reference = new Uint8Array([
	0x00, 0x00, 0x00, 87, 0x6d, 0x70, 0x34, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
	0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0xbb, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x33, 0x65, 0x73, 0x64, 0x73, 0x00, 0x00, 0x00, 0x00, 0x03, 0x80, 0x80, 0x80,
	0x22, 0x00, 0x02, 0x00, 0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x15, 0x00, 0x00,
	0x00, 0x00, 0x04, 0xe1, 0xff, 0x00, 0x04, 0xd7, 0xba, 0x05, 0x80, 0x80, 0x80,
	0x02, 0x11, 0x90, 0x06, 0x80, 0x80, 0x80, 0x01, 0x02,
]);

test('mp4a', () => {
	const result = createMp4a({
		type: 'mp4a-data',
		channelCount: 2,
		sampleRate: 48000,
		avgBitrate: 317370,
		maxBitrate: 319999,
		codecPrivate: new Uint8Array([17, 144]),
	});
	expect(result).toEqual(reference.slice(0, result.length + 7));
});
