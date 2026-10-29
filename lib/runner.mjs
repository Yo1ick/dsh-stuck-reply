// lib/runner.mjs — 插件核心 v2（无状态）：detect→发通知 / resolve→发解除 / applied→发回执 / 心跳互检
// 不碰 Remote API（$events/result 要求回答方与事件接收方是同一 peer，答案应用留在外挂 watch）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listIntents, readIntent, archiveIntent, discardIntent } from './intents.mjs';

export class ReplyRunner {
  constructor(config = {}) {
    this.cfg = {
      stateRoot: config.stateRoot || '',
      larkCli: config.larkCli || 'lark-cli',
      pollMs: config.pollMs || 3000,
      heartbeatMs: config.heartbeatMs || 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs || 90000,
      textLimit: config.textLimit || 6000,
    };
    this.dirs = {
      intents: path.join(this.cfg.stateRoot, 'intents', 'v1'),
      detect: path.join(this.cfg.stateRoot, 'intents', 'v1', 'detect'),
      resolve: path.join(this.cfg.stateRoot, 'intents', 'v1', 'resolve'),
      applied: path.join(this.cfg.stateRoot, 'intents', 'v1', 'applied'),
      heartbeat: path.join(this.cfg.stateRoot, 'heartbeat'),
      lastChatFile: path.join(this.cfg.stateRoot, 'plugin-last-chat.json'),
    };
    this.nosend = !!process.env.DSH_STUCK_NOSEND;
    this.watchDownReported = false;
    this.lastHeartbeat = 0;
    this.timer = null;
  }

  log(...a) {
    try {
      fs.mkdirSync(this.cfg.stateRoot, { recursive: true });
      fs.appendFileSync(path.join(this.cfg.stateRoot, 'plugin.log'), `[${new Date().toISOString()}] ${a.join(' ')}\n`);
    } catch {}
  }

  // ---------- 飞书发送 ----------
  sendTo(chatId, text) {
    const msg = String(text).slice(0, this.cfg.textLimit);
    if (!chatId) { this.log('send-no-chat', msg.slice(0, 60)); return; }
    this.rememberChat(chatId);
    if (this.nosend) { this.log('would-send', chatId, msg.slice(0, 120).replace(/\n/g, ' ')); return; }
    const r = spawnSync(this.cfg.larkCli, ['im', '+messages-send', '--chat-id', chatId, '--text', msg], {
      timeout: 30000,
      env: { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin` },
    });
    if (r.status !== 0) this.log('send-fail', String(r.stderr || '').slice(0, 200));
  }
  rememberChat(chatId) {
    try { fs.writeFileSync(this.dirs.lastChatFile, JSON.stringify({ chatId, at: Date.now() })); } catch {}
  }
  lastChatId() {
    try { return JSON.parse(fs.readFileSync(this.dirs.lastChatFile, 'utf8')).chatId || null; } catch { return null; }
  }

  // ---------- 通知文案 ----------
  itemText(it) {
    if (it.kind === 'approval') {
      return [
        `🔔 DSH 会话等你审批${it.ticket ? `（本条编号 ${it.ticket}）` : ''}`,
        `会话：${it.title || it.sessionId}`,
        `动作：${it.toolName || '工具调用'}${it.reason ? `\n理由：${String(it.reason).slice(0, 300)}` : ''}`,
        ``,
        `回复「批准」执行，「拒绝」拒绝，「取消」放弃。`,
      ].join('\n');
    }
    const q = it.questions?.[0] || {};
    const lines = [`🔔 DSH 会话等你选择${it.ticket ? `（本条编号 ${it.ticket}）` : ''}`, `会话：${it.title || it.sessionId}`];
    if (q.header && q.header !== q.question) lines.push(`标题：${q.header}`);
    lines.push(`问题：${q.question || '(无标题问题)'}`);
    if (it.planReview) {
      lines.push(`⚠ 这是计划审批：回「批准」通过，「拒绝」打回，或选具体选项。`);
      if (it.planDetail) lines.push(`计划摘录：${String(it.planDetail).slice(0, 600)}`);
    }
    (q.options || []).forEach((o, i) => lines.push(`${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`));
    lines.push('');
    lines.push(`直接回复序号（如 1）选择；回复自定义文字作答案；回「取消」放弃。${it.ticket ? `多条待处理时以「${it.ticket} 1」开头指定本条。` : ''}`);
    return lines.join('\n');
  }

  // ---------- 意图消费 ----------
  async poll() {
    const now = Date.now();
    if (now - this.lastHeartbeat >= this.cfg.heartbeatMs) {
      this.lastHeartbeat = now;
      fs.mkdirSync(this.dirs.heartbeat, { recursive: true });
      fs.writeFileSync(path.join(this.dirs.heartbeat, 'plugin.json'),
        JSON.stringify({ ts: now, pid: process.pid, version: 1 }));
      this.checkWatchHeartbeat();
    }
    this.consume('detect', (env) => {
      const it = env.payload || {};
      this.sendTo(it.chatId, this.itemText(it));
      this.log('notify', it.itemId, it.ticket || '');
    });
    this.consume('resolve', (env) => {
      const it = env.payload || {};
      this.sendTo(it.chatId, `ℹ️ 刚才那条等待已解除（可能你在 GUI 里处理了），不用回复。`);
      this.log('resolve', it.itemId);
    });
    this.consume('applied', (env) => {
      const it = env.payload || {};
      if (it.ok === true) {
        this.sendTo(it.chatId, `✅ 已替你回答「${it.title || it.sessionId || ''}」：${it.summary || '已回复'}。会话继续跑，再有卡住点会叫你。`);
      } else if (it.error === 'cancelled') {
        this.sendTo(it.chatId, `🚫 已取消本次回答。会话仍卡在等你的状态（可在 GUI 里处理）。`);
      } else {
        this.sendTo(it.chatId, `❌ 回答提交失败：${String(it.error || '未知错误').slice(0, 120)}`);
      }
      this.log('applied-ack', it.itemId, it.ok === true ? 'ok' : it.error);
    });
  }

  consume(kind, fn) {
    const dir = this.dirs[kind];
    for (const f of listIntents(dir)) {
      const r = readIntent(dir, f);
      if (!r || r.bad) { r?.bad && this.log('bad-intent', kind, f, r.bad); discardIntent(dir, f); continue; }
      try { fn(r.env); } catch (e) { this.log('consume-fail', kind, String(e).slice(0, 160)); }
      archiveIntent(dir, f, this.dirs.intents);
    }
  }

  // ---------- 心跳 ----------
  checkWatchHeartbeat() {
    let hb = null;
    try { hb = JSON.parse(fs.readFileSync(path.join(this.dirs.heartbeat, 'watch.json'), 'utf8')); } catch {}
    if (!hb) return;
    if (Date.now() - (hb.ts || 0) > this.cfg.heartbeatTimeoutMs) {
      if (!this.watchDownReported) {
        this.watchDownReported = true;
        const chatId = this.lastChatId();
        if (chatId) this.sendTo(chatId, `⚠️ 卡住看守（watch）失联超过 ${Math.round(this.cfg.heartbeatTimeoutMs / 60000)} 分钟，期间卡住可能漏通知。`);
        this.log('watch-down-alert');
      }
    } else {
      this.watchDownReported = false;
    }
  }

  start() {
    if (!this.cfg.stateRoot) throw new Error('ReplyRunner: stateRoot 未配置');
    if (this.cfg.larkCli.includes('/') && !fs.existsSync(this.cfg.larkCli)) {
      throw new Error(`ReplyRunner: larkCli 不存在：${this.cfg.larkCli}`);
    }
    fs.mkdirSync(this.dirs.detect, { recursive: true });
    fs.mkdirSync(this.dirs.resolve, { recursive: true });
    fs.mkdirSync(this.dirs.applied, { recursive: true });
    fs.mkdirSync(this.dirs.heartbeat, { recursive: true });
    this.log('plugin start, pid', process.pid);
    this.timer = setInterval(() => { this.poll().catch((e) => this.log('poll-fail', String(e).slice(0, 200))); }, this.cfg.pollMs);
    this.poll().catch(() => {});
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.log('plugin stop');
  }
}
