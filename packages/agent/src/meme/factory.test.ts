import { describe, expect, it } from 'vitest';
import { resolveMemeModelConfig } from './factory.js';

describe('SaaS 表情包模型配置', () => {
  it('与 CP 产线模型和 ECNU 端点一致，默认保留思考', () => {
    expect(resolveMemeModelConfig({})).toEqual({
      imageModel: 'doubao-seedream-5-0-260128',
      visionModel: 'ecnu-plus',
      visionBaseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
      visionThinking: true,
    });
  });

  it('CP 配置优先于旧 MEME 别名，并接受显式端点', () => {
    expect(resolveMemeModelConfig({
      CP_ARK_IMAGE_MODEL: 'doubao-seedream-5-0-260128', MEME_IMAGE_MODEL: 'old-image',
      CP_VISION_MODEL: 'ecnu-plus', MEME_VL_MODEL: 'glm-4v-flash',
      CP_VISION_BASE_URL: 'https://vision.example/v1', CP_VISION_THINKING: 'true',
    })).toMatchObject({
      imageModel: 'doubao-seedream-5-0-260128', visionModel: 'ecnu-plus',
      visionBaseUrl: 'https://vision.example/v1', visionThinking: true,
    });
  });
});
