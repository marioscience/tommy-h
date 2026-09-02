import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';

const body = Buffer.from(JSON.stringify({ ok: true, service: 'benchmark-backend' }));

const handleHttp = (request, response) => {
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': body.length,
    'connection': 'keep-alive'
  });
  response.end(body);
};

http.createServer(handleHttp).listen(9000, '0.0.0.0');
// OxideProxy reserva /healthz y /api para el backend de aplicación:3006.
http.createServer(handleHttp).listen(3006, '0.0.0.0');

net.createServer(socket => socket.pipe(socket)).listen(9001, '0.0.0.0');

const udp = dgram.createSocket('udp4');
udp.on('message', (message, peer) => udp.send(message, peer.port, peer.address));
udp.bind(9001, '0.0.0.0');

console.log('Benchmark backend ready on HTTP 9000/3006 and TCP/UDP 9001');
