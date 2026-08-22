import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import http from 'http';
import https from 'https';

const execFileAsync = promisify(execFile);

export const DEFAULT_PORTS = [30127, 30132, 30133, 30136, 30138, 30139, 30140];
export const MAX_CMD_TIMEOUT = 12000;
export const MAX_HTTP_TIMEOUT = 8000;

export function clampTimeout(value, fallback = MAX_HTTP_TIMEOUT) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1000), 15000);
}

export function onlyValidPorts(ports) {
  if (!Array.isArray(ports)) return DEFAULT_PORTS;

  return [...new Set(
    ports
      .map((p) => Number(p))
      .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
  )];
}

export function safeText(value, max = 20000) {
  if (!value) return '';
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}\n...[TRUNCATED]` : text;
}

export async function runCommand(cmd, args = [], options = {}) {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: options.timeout || MAX_CMD_TIMEOUT,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 3,
      shell: false
    });

    return {
      ok: true,
      cmd: [cmd, ...args].join(' '),
      durationMs: Date.now() - startedAt,
      stdout: safeText(stdout),
      stderr: safeText(stderr)
    };
  } catch (err) {
    return {
      ok: false,
      cmd: [cmd, ...args].join(' '),
      durationMs: Date.now() - startedAt,
      error: err.message,
      stdout: safeText(err.stdout),
      stderr: safeText(err.stderr)
    };
  }
}

export function httpProbe(url, timeoutMs = MAX_HTTP_TIMEOUT) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const lib = url.startsWith('https:') ? https : http;

    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let size = 0;
      let body = '';

      res.on('data', (chunk) => {
        size += chunk.length;

        if (body.length < 20000) {
          body += chunk.toString('utf8');
        }
      });

      res.on('end', () => {
        let parsed = null;

        try {
          parsed = JSON.parse(body);
        } catch (_) {}

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          url,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          size,
          parsed,
          bodyPreview: parsed ? undefined : safeText(body, 2000)
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        url,
        durationMs: Date.now() - startedAt,
        error: err.message
      });
    });
  });
}
