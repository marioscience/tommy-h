const MIN_PACKET_BYTES = 10;
const DEFAULT_MAX_PACKET_BYTES = 1024 * 1024;

export function encodeSourceRconPacket(id, type, body) {
    const payload = Buffer.from(String(body ?? ''), 'utf8');
    const packetLength = 8 + payload.length + 2;
    const packet = Buffer.allocUnsafe(4 + packetLength);
    packet.writeInt32LE(packetLength, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    payload.copy(packet, 12);
    packet.writeUInt16LE(0, 12 + payload.length);
    return packet;
}

export class SourceRconDecoder {
    #pending = Buffer.alloc(0);
    #maxPacketBytes;

    constructor({ maxPacketBytes = DEFAULT_MAX_PACKET_BYTES } = {}) {
        this.#maxPacketBytes = maxPacketBytes;
    }

    push(chunk) {
        if (!Buffer.isBuffer(chunk)) throw new TypeError('El fragmento RCON debe ser un Buffer.');
        this.#pending = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);
        const packets = [];

        while (this.#pending.length >= 4) {
            const size = this.#pending.readInt32LE(0);
            if (size < MIN_PACKET_BYTES || size > this.#maxPacketBytes) {
                this.#pending = Buffer.alloc(0);
                throw new Error(`Longitud de paquete RCON invalida: ${size}`);
            }
            const totalBytes = size + 4;
            if (this.#pending.length < totalBytes) break;
            packets.push({
                id: this.#pending.readInt32LE(4),
                type: this.#pending.readInt32LE(8),
                body: this.#pending.toString('utf8', 12, totalBytes - 2)
            });
            this.#pending = this.#pending.subarray(totalBytes);
        }
        return packets;
    }
}
