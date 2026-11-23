// SPDX-License-Identifier: MIT
// Antigravity Tiny Stack Virtual Machine for make.fun
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_MAX = 256;
const CALLS_MAX = 64;
const MEMORY_WORDS = 256;
const STEP_LIMIT = 1000000;
const OUTPUT_MAX = 65536;
const enc = new TextEncoder();

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const n = p.length;
  const D = new Int32Array(STACK_MAX);
  let sp = 0;
  const C = new Int32Array(CALLS_MAX);
  let csp = 0;
  const M = new Int32Array(MEMORY_WORDS);
  const out = new Uint8Array(OUTPUT_MAX);
  let olen = 0;
  let inPos = 0;
  let pc = 0;
  let steps = 0;

  const done = (code: number) => ({ out: out.slice(0, olen), code });
  const trap = (code: number) => done(code);

  const ops: Record<number, [number, number]> = {
    0x00: [0, 0], 0x01: [0, 1], 0x02: [0, 1], 0x03: [1, 0], 0x04: [1, 2],
    0x05: [2, 2], 0x06: [2, 3], 0x07: [3, 3], 0x10: [2, 1], 0x11: [2, 1],
    0x12: [2, 1], 0x13: [2, 1], 0x14: [2, 1], 0x15: [2, 1], 0x16: [2, 1],
    0x17: [1, 1], 0x18: [2, 1], 0x19: [2, 1], 0x1a: [2, 1], 0x1b: [1, 1],
    0x1c: [2, 1], 0x1d: [2, 1], 0x1e: [2, 1], 0x20: [2, 1], 0x21: [2, 1],
    0x22: [2, 1], 0x30: [0, 0], 0x31: [1, 0], 0x32: [1, 0], 0x33: [0, 0],
    0x34: [0, 0], 0x40: [1, 1], 0x41: [2, 0], 0x50: [1, 0], 0x51: [1, 0],
    0x52: [0, 1], 0x53: [1, 0]
  };

  const imms: Record<number, number> = { 0x01: 1, 0x02: 4, 0x30: 2, 0x31: 2, 0x32: 2, 0x33: 2 };

  for (;;) {
    if (steps === STEP_LIMIT) return trap(10);
    if (pc < 0 || pc >= n) return trap(9);
    const opcode = p[pc];
    const spec = ops[opcode];
    if (!spec) return trap(5);
    const imm = imms[opcode] || 0;
    if (pc + imm >= n) return trap(9);

    steps++;
    const next = pc + 1 + imm;
    const [pops, pushes] = spec;
    if (sp < pops) return trap(2);
    if (sp - pops + pushes > STACK_MAX) return trap(3);

    pc = next;

    if (opcode === 0x00) return done(0);
    if (opcode === 0x01) { D[sp++] = (p[next - 1] << 24) >> 24; continue; }
    if (opcode === 0x02) {
      D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24);
      continue;
    }
    if (opcode === 0x03) { sp--; continue; }
    if (opcode === 0x04) { D[sp] = D[sp - 1]; sp++; continue; }
    if (opcode === 0x05) { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; continue; }
    if (opcode === 0x06) { D[sp] = D[sp - 2]; sp++; continue; }
    if (opcode === 0x07) { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; continue; }
    if (opcode === 0x17) { D[sp - 1] = -D[sp - 1] | 0; continue; }
    if (opcode === 0x1b) { D[sp - 1] = ~D[sp - 1]; continue; }
    if (opcode >= 0x10 && opcode <= 0x22) {
      const b = D[sp - 1];
      const a = D[sp - 2];
      let r = 0;
      if (opcode === 0x10) r = (a + b) | 0;
      else if (opcode === 0x11) r = (a - b) | 0;
      else if (opcode === 0x12) r = Math.imul(a, b);
      else if (opcode === 0x13) {
        if (b === 0) return trap(4);
        r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
      } else if (opcode === 0x14) {
        if (b === 0) return trap(4);
        r = b === -1 ? 0 : (a % b) | 0;
      } else if (opcode === 0x15) {
        if (b === 0) return trap(4);
        r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
      } else if (opcode === 0x16) {
        if (b === 0) return trap(4);
        r = ((a >>> 0) % (b >>> 0)) | 0;
      } else if (opcode === 0x18) r = a & b;
      else if (opcode === 0x19) r = a | b;
      else if (opcode === 0x1a) r = a ^ b;
      else if (opcode === 0x1c) r = a << (b & 31);
      else if (opcode === 0x1d) r = a >> (b & 31);
      else if (opcode === 0x1e) r = (a >>> (b & 31)) | 0;
      else if (opcode === 0x20) r = a === b ? 1 : 0;
      else if (opcode === 0x21) r = a < b ? 1 : 0;
      else if (opcode === 0x22) r = (a >>> 0) < (b >>> 0) ? 1 : 0;
      sp -= 2;
      D[sp++] = r;
      continue;
    }
    if (opcode >= 0x30 && opcode <= 0x32) {
      const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
      let take = opcode === 0x30;
      if (!take) {
        const v = D[--sp];
        take = opcode === 0x31 ? v === 0 : v !== 0;
      }
      if (take) pc = next + rel;
      continue;
    }
    if (opcode === 0x33) {
      if (csp === CALLS_MAX) return trap(7);
      C[csp++] = next;
      pc = p[next - 2] | (p[next - 1] << 8);
      continue;
    }
    if (opcode === 0x34) {
      if (csp === 0) return trap(8);
      pc = C[--csp];
      continue;
    }
    if (opcode === 0x40) {
      const addr = D[sp - 1];
      if (addr < 0 || addr >= MEMORY_WORDS) return trap(6);
      D[sp - 1] = M[addr];
      continue;
    }
    if (opcode === 0x41) {
      const addr = D[sp - 1];
      const v = D[sp - 2];
      if (addr < 0 || addr >= MEMORY_WORDS) return trap(6);
      sp -= 2;
      M[addr] = v;
      continue;
    }
    if (opcode === 0x50) {
      const bytes = enc.encode(String(D[sp - 1]));
      if (olen + bytes.length > OUTPUT_MAX) return trap(11);
      sp--;
      out.set(bytes, olen);
      olen += bytes.length;
      continue;
    }
    if (opcode === 0x51) {
      if (olen + 1 > OUTPUT_MAX) return trap(11);
      out[olen++] = D[--sp] & 255;
      continue;
    }
    if (opcode === 0x52) {
      D[sp++] = inPos < inp.length ? inp[inPos++] : -1;
      continue;
    }
    if (opcode === 0x53) {
      return done(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
