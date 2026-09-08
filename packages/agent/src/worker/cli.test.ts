import { describe, it, expect } from 'vitest';
import { parsePetStateArg } from './cli.js';

/**
 * CLI 边界直测（#216 评审 P0-1 教训：--pet-state 跨进程字符串是类型系统
 * 盲区，CP 实际生成的参数形状必须在此验证）
 */
describe('parsePetStateArg（wander CLI --pet-state）', () => {
  it('CP 侧 JSON.stringify 产物可解析', () => {
    const fromCp = JSON.stringify({ energy: 70, boredom: 72.5, mood: 'playful', temper: 20 });
    expect(parsePetStateArg(fromCp)).toEqual({
      energy: 70,
      boredom: 72.5,
      mood: 'playful',
      temper: 20,
    });
  });

  it('缺失 / 非法 JSON / 形状不全 → null（调用方 exit 2）', () => {
    expect(parsePetStateArg(undefined)).toBeNull();
    expect(parsePetStateArg('not-json{')).toBeNull();
    // feedback 形状（{mood,temper}）对 wander 通道非法——两通道不可混用
    expect(parsePetStateArg('{"mood":"curious","temper":20}')).toBeNull();
  });
});
