/**
 * agent-browser 安装脚本
 *
 * 用法: pnpm setup:browser
 *
 * 1. 检查 agent-browser 是否已安装
 * 2. 若未安装，全局安装 agent-browser
 * 3. 运行 agent-browser install 下载 Chrome for Testing
 * 4. 运行 agent-browser doctor --json 验证环境
 */
import { execFileSync } from 'node:child_process';

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function tryRun(cmd: string, args: string[]): { ok: boolean; output: string } {
  try {
    return { ok: true, output: run(cmd, args) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}

function main(): void {
  console.log('🔧 agent-browser 环境设置\n');

  // ── Step 1: 检查是否已安装 ──────────────────────────────
  console.log('📦 检查 agent-browser 是否已安装...');
  const version = tryRun('agent-browser', ['--version']);

  if (version.ok) {
    console.log(`   ✅ 已安装: ${version.output}`);
  } else {
    // ── Step 2: 全局安装 ──────────────────────────────────
    console.log('   ❌ 未安装，正在全局安装...');
    const install = tryRun('npm', ['install', '-g', 'agent-browser']);
    if (!install.ok) {
      console.error(`   ❌ 安装失败: ${install.output}`);
      process.exit(1);
    }
    const newVersion = tryRun('agent-browser', ['--version']);
    if (!newVersion.ok) {
      console.error('   ❌ 安装后仍无法找到 agent-browser，请检查 npm 全局路径');
      process.exit(1);
    }
    console.log(`   ✅ 安装成功: ${newVersion.output}`);
  }

  // ── Step 3: 下载 Chrome for Testing ─────────────────────
  console.log('\n🌐 下载 Chrome for Testing...');
  const chromeInstall = tryRun('agent-browser', ['install']);
  if (!chromeInstall.ok) {
    console.error(`   ❌ Chrome 下载失败: ${chromeInstall.output}`);
    process.exit(1);
  }
  console.log('   ✅ Chrome 下载完成');

  // ── Step 4: 环境验证 ────────────────────────────────────
  console.log('\n🩺 运行环境检查...');
  const doctor = tryRun('agent-browser', ['doctor', '--json']);
  if (!doctor.ok) {
    console.error(`   ❌ doctor 执行失败: ${doctor.output}`);
    process.exit(1);
  }

  try {
    const report = JSON.parse(doctor.output) as {
      success?: boolean;
      data?: Record<string, unknown>;
      error?: string | null;
    };
    if (report.success) {
      console.log('   ✅ 所有检查通过');
      if (report.data) {
        for (const [key, value] of Object.entries(report.data)) {
          console.log(`      ${key}: ${JSON.stringify(value)}`);
        }
      }
    } else {
      console.warn(`   ⚠️  部分检查未通过: ${report.error ?? '未知错误'}`);
    }
  } catch {
    console.warn(`   ⚠️  doctor 输出非 JSON，原始输出:\n${doctor.output}`);
  }

  console.log('\n🎉 agent-browser 设置完成！');
}

main();
