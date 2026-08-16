#!/usr/bin/env node
/*
 * dev.js —— 本地开发常驻命令：监听博客配置/自定义模板变化，自动重启 hexo server
 *
 * 用法：  npm run dev        （Ctrl+C 停止）
 *         PORT=4567 npm run dev   （默认端口 4000 被占用时换端口，Windows cmd 用 set PORT=4567）
 *
 * 触发重启的范围（为什么只监听这些）：
 *   - _config.yml / _config.stellar.yml —— hexo server 不感知配置文件变化，必须重启
 *   - source/_bak —— 你的自定义主题模板备份，改动后脚本会先 cp 回 node_modules 再重启
 *   - themes/ —— 如存在
 * 注意：
 *   - 不要监听 node_modules/hexo-theme-stellar/layout：脚本每次重启前会把 _bak 的模板
 *     cp 进该目录，监听它会造成「cp→触发→重启→再 cp」无限循环。
 *   - 本文件必须放在 tools/（或项目根目录），不能放 scripts/ —— Hexo 会把 scripts/ 下
 *     的 .js 当插件加载并报错。
 *   - source/ 下的文章(.md)变化由 hexo server 自带 watch 处理，不需要重启。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 监听白名单：配置文件（精确）+ 目录（递归）
const CONFIG_FILES = ['_config.yml', '_config.stellar.yml'];
const WATCH_DIRS = ['source/_bak', 'themes'].filter((d) =>
  fs.existsSync(path.join(ROOT, d))
);

// 这些后缀的变化才触发重启（.md 文章由 hexo server 自带 watch 处理）
const TRIGGER_RE = /\.(ya?ml|json|ejs|styl|css|js)$/i;

let child = null;
let timer = null;
let restarting = false;

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      // Windows: 强制杀掉整个进程树，避免 hexo 残留占用端口
      spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (e) { /* ignore */ }
}

function restoreTemplates() {
  // 与 package.json 的 prebuild 一致：把自定义模板恢复进 node_modules（保证 _bak 的改动生效）
  const r = spawnSync('npm', ['run', 'prebuild'], { cwd: ROOT, shell: true, stdio: 'ignore' });
  if (r.status !== 0) {
    console.log('[dev] ⚠️ 模板恢复(prebuild)未成功，继续启动 server');
  }
}

function startServer() {
  killTree(child);
  child = null;
  restarting = true;
  restoreTemplates();
  // 给端口释放留一点时间，避免 EADDRINUSE
  setTimeout(() => {
    console.log('\n[dev] 启动 hexo server ...\n');
    child = spawn(
      'hexo',
      process.env.PORT ? ['server', '-p', process.env.PORT] : ['server'],
      { cwd: ROOT, shell: true, stdio: 'inherit' }
    );
    child.on('exit', () => { child = null; });
    restarting = false;
  }, 400);
}

function scheduleRestart(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`\n[dev] 🔁 检测到变化(${reason})，自动重启 hexo server`);
    startServer();
  }, 500);
}

function cleanup() {
  console.log('\n[dev] 收到退出信号，正在清理...');
  killTree(child);
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// 首次启动
startServer();

// 监听配置文件
CONFIG_FILES.forEach((f) => {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) return;
  fs.watch(full, () => scheduleRestart(f));
});

// 监听目录
WATCH_DIRS.forEach((d) => {
  const full = path.join(ROOT, d);
  try {
    fs.watch(full, { recursive: true }, (_evt, file) => {
      if (file && TRIGGER_RE.test(file)) scheduleRestart(path.join(d, file));
    });
  } catch (e) {
    console.log(`[dev] ⚠️ 无法监听 ${d}: ${e.message}`);
  }
});

console.log(`[dev] 已监听: ${CONFIG_FILES.join(', ')} + 目录: ${WATCH_DIRS.join(', ')}`);
console.log('[dev] 按 Ctrl+C 退出');
