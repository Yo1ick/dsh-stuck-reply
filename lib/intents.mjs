// lib/intents.mjs — 意图文件协议 v1 读写（原子写 tmp+rename，消费后移 done/，id 幂等）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROTOCOL = 'dsh-stuck-intent';
export const VERSION = 1;

export function envelope(kind, from, payload) {
  return {
    protocol: PROTOCOL,
    version: VERSION,
    id: crypto.randomUUID(),
    ts: Date.now(),
    from,
    kind,
    payload,
  };
}

export function writeIntent(dir, env) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${env.id}.tmp`);
  const dst = path.join(dir, `${env.id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(env));
  fs.renameSync(tmp, dst); // 同目录 rename，防半截文件
  return dst;
}

export function listIntents(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

export function readIntent(dir, file) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!v || typeof v !== 'object') return null;
    // replies 旧文件无 version 视为 1；其余信封必须带 version
    const version = v.version ?? 1;
    if (version > VERSION) return { file, bad: `version ${version} > ${VERSION}` };
    return { file, env: v };
  } catch {
    return null;
  }
}

export function archiveIntent(dir, file, doneRoot) {
  const done = path.join(doneRoot, 'done');
  fs.mkdirSync(done, { recursive: true });
  fs.renameSync(path.join(dir, file), path.join(done, `${Date.now()}-${file}`));
}

export function discardIntent(dir, file) {
  fs.rmSync(path.join(dir, file), { force: true });
}
