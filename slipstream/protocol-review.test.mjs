import test from 'node:test';
import assert from 'node:assert/strict';
import {encode, decode, hex, ID, offsetIsKnown} from './protocol.mjs';

test('native offset classification uses a strict upper range and preserves raw diagnostics', () => {
  for (const [value,known] of [[-22.5,true],[0,true],[500000,true],[500001,false],[654312,false],[654321,false],[NaN,false],[Infinity,false]]) {
    assert.equal(offsetIsKnown(value),known,String(value));
    if (!Number.isFinite(value)) continue;
    const packet=new Uint8Array(15), view=new DataView(packet.buffer);
    packet[0]=14;packet[1]=ID.LANE_CHANGE_UPDATE;
    view.setFloat32(2,value,true);view.setFloat32(6,-22.5,true);
    const message=decode(packet)[0];
    assert.equal(message.offsetKnown,known);assert.equal(message.currentOffset,value,'raw value is not normalized away');
    view.setFloat32(2,-22.5,true);view.setFloat32(6,value,true);
    assert.equal(decode(packet)[0].offsetKnown,known,'unknown target is also not a known lane');
  }
});

// Generated independently by compiling the pinned official C SDK. These are
// interoperability facts, not simulator-produced or physical-car observations.
test('encoders agree with the independently compiled official SDK', () => {
  const vectors = [
    [encode.sdkMode(true, 1), '03 90 01 01'],
    [encode.speed(500, 1000), '06 24 f4 01 e8 03 00'],
    [encode.speed(0, 2500), '06 24 00 00 c4 09 00'],
    [encode.changeLane(-22.5, 300, 1000), '0b 25 2c 01 e8 03 00 00 b4 c1 00 00'],
    [encode.setOffset(-22.5), '05 2c 00 00 b4 c1'],
    [encode.turn(), '03 32 03 00'], [encode.lights(0x11), '02 1d 11'],
    [encode.ping(), '01 16'], [encode.version(), '01 18'], [encode.battery(), '01 1a'],
    [encode.cancelLaneChange(), '01 26'], [encode.disconnect(), '01 0d']
  ];
  for (const [packet, expected] of vectors) assert.equal(hex(packet), expected);
});

test('a short version reply does not discard the following off-track notification', () => {
  assert.deepEqual(decode(Uint8Array.of(1, ID.VERSION_REPLY, 1, ID.DELOCALIZED)).map(m => m.type), ['other', 'delocalized']);
});

test('non-finite telemetry cannot enter localization or lane calibration', () => {
  for (const [id, length, offset] of [[ID.POSITION,17,4],[ID.TRANSITION,18,4],[ID.INTERSECTION,13,3],[ID.OFFSET_UPDATE,7,2]]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const packet = new Uint8Array(length); packet[0] = length - 1; packet[1] = id;
      new DataView(packet.buffer).setFloat32(offset, value, true);
      assert.equal(decode(packet)[0].type, 'other');
    }
  }
});
