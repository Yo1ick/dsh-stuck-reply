// dsh-stuck-reply — 卡住会话飞书答复代理（B 形态：飞书通知/收回复/应用答案/回执）
// 检测在外挂 watch.mjs；本插件只消费意图文件、发飞书、经官方 Remote API 应用答案。
import fs from 'node:fs';

export const name = 'dsh-stuck-reply';

export function apply(ctx, config = {}) {
  if (!config.stateRoot) throw new Error('dsh-stuck-reply: config.stateRoot 未配置（意图/状态根目录）');
  const larkCli = config.larkCli || 'lark-cli';
  let runner = null;
  import('./lib/runner.mjs').then(({ ReplyRunner }) => {
    runner = new ReplyRunner({ ...config, larkCli });
    runner.start();
  }).catch((e) => {
    console.error('[dsh-stuck-reply] 启动失败:', e);
    try {
      fs.appendFileSync(`${config.stateRoot}/plugin.log`, `[${new Date().toISOString()}] start-fail ${String(e)}\n`);
    } catch {}
  });
  ctx.on('dispose', () => {
    runner?.stop();
  });
}
