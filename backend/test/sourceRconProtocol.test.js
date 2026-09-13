import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSourceRconPacket, SourceRconDecoder } from '../src/utils/sourceRconProtocol.js';

describe('Source RCON binary framing', () => {
    it('reassembles a packet split across arbitrary TCP fragments', () => {
        const encoded = encodeSourceRconPacket(41, 0, 'respuesta');
        const decoder = new SourceRconDecoder();
        assert.deepEqual(decoder.push(encoded.subarray(0, 2)), []);
        assert.deepEqual(decoder.push(encoded.subarray(2, 11)), []);
        assert.deepEqual(decoder.push(encoded.subarray(11)), [{ id: 41, type: 0, body: 'respuesta' }]);
    });

    it('decodes multiple packets received in one TCP fragment', () => {
        const decoder = new SourceRconDecoder();
        const combined = Buffer.concat([
            encodeSourceRconPacket(1, 2, ''),
            encodeSourceRconPacket(2, 0, 'ok')
        ]);
        assert.deepEqual(decoder.push(combined), [
            { id: 1, type: 2, body: '' },
            { id: 2, type: 0, body: 'ok' }
        ]);
    });

    it('rejects malformed and oversized packet lengths', () => {
        const invalid = Buffer.alloc(4);
        invalid.writeInt32LE(-1);
        assert.throws(() => new SourceRconDecoder().push(invalid), /invalida/);
        const oversized = Buffer.alloc(4);
        oversized.writeInt32LE(4097);
        assert.throws(() => new SourceRconDecoder({ maxPacketBytes: 4096 }).push(oversized), /invalida/);
    });
});
