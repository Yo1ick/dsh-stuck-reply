#!/usr/bin/env node
// standalone.mjs — 插件独立运行入口（未装进 DSH profile 前的部署形态；装进 bundle 后由 DSH 加载 index.js）
// 用法：node standalone.mjs [--state-root <dir>] [--nosend]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReplyRunner } from './lib/runner.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const config = {
  stateRoot: opt('--state-root', process.env.DSH_STUCK_STATE_ROOT || ''),
  larkCli: opt('--lark-cli', process.env.DSH_STUCK_LARK_CLI || 'lark-cli'),
  pollMs: Number(opt('--poll-ms', '3000')),
  heartbeatMs: Number(opt('--heartbeat-ms', '30000')),
  heartbeatTimeoutMs: Number(opt('--heartbeat-timeout-ms', '90000')),
  textLimit: Number(opt('--text-limit', '6000')),
};
if (!config.stateRoot) {
  console.error('[dsh-stuck-reply] 缺少 --state-root（或环境变量 DSH_STUCK_STATE_ROOT）：必须指向与 watch 共享的状态根目录');
  process.exit(2);
}
if (argv.includes('--nosend')) process.env.DSH_STUCK_NOSEND = '1';
const runner = new ReplyRunner(config);
runner.start();
process.on('SIGTERM', () => { runner.stop(); process.exit(0); });
process.on('SIGINT', () => { runner.stop(); process.exit(0); });
