import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { useTempDataDir } from '../../../test/helpers.js';
import { SkillIndex, getSkillIndex, _resetSkillIndex } from './skill-index.js';

describe('SkillIndex', () => {
  let temp: ReturnType<typeof useTempDataDir>;
  let skillsDir: string;

  beforeEach(() => {
    temp = useTempDataDir();
    skillsDir = join(temp.dataDir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    _resetSkillIndex();
    temp.cleanup();
  });

  describe('scan', () => {
    it('returns empty list for empty directory', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(index.list()).toEqual([]);
    });

    it('returns empty list when directory does not exist', () => {
      const index = new SkillIndex(join(temp.dataDir, 'nonexistent'));
      index.scan();
      expect(index.list()).toEqual([]);
    });

    it('indexes valid SKILL.md files', () => {
      const skillDir = join(skillsDir, 'my-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), `---
name: my-skill
description: A test skill
---
# Content`);

      const index = new SkillIndex(skillsDir);
      index.scan();

      const entries = index.list();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe('my-skill');
      expect(entries[0]!.description).toBe('A test skill');
    });

    it('skips directories without SKILL.md', () => {
      mkdirSync(join(skillsDir, 'no-skill'), { recursive: true });
      writeFileSync(join(skillsDir, 'no-skill', 'README.md'), '# Not a skill');

      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(index.list()).toEqual([]);
    });

    it('skips files with invalid frontmatter', () => {
      const skillDir = join(skillsDir, 'bad-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), 'No frontmatter here');

      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(index.list()).toEqual([]);
    });
  });

  describe('create', () => {
    it('creates a new skill and updates index', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();

      const path = index.create('new-skill', 'A new skill', '# Hello');
      expect(path).toContain('new-skill');
      expect(index.has('new-skill')).toBe(true);
      expect(index.list()).toHaveLength(1);
    });

    it('throws on duplicate create', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();

      index.create('dup-skill', 'First', 'content');
      expect(() => index.create('dup-skill', 'Second', 'content')).toThrow('已存在');
    });

    it('throws on invalid name with uppercase', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(() => index.create('Invalid-Name', 'desc', 'content')).toThrow('格式无效');
    });

    it('throws on invalid name with spaces', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(() => index.create('has space', 'desc', 'content')).toThrow('格式无效');
    });

    it('throws on name exceeding 64 chars', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      const longName = 'a'.repeat(65);
      expect(() => index.create(longName, 'desc', 'content')).toThrow('64');
    });

    it('throws on empty name', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(() => index.create('', 'desc', 'content')).toThrow('不能为空');
    });
  });

  describe('load', () => {
    it('loads full skill content', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      index.create('load-test', 'Loadable skill', '# Title\n\nBody text');

      const loaded = index.load('load-test');
      expect(loaded).not.toBeNull();
      expect(loaded!.meta.name).toBe('load-test');
      expect(loaded!.meta.description).toBe('Loadable skill');
      expect(loaded!.content).toBe('# Title\n\nBody text');
    });

    it('returns null for nonexistent skill', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(index.load('ghost')).toBeNull();
    });
  });

  describe('patch', () => {
    it('updates content while preserving frontmatter', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      index.create('patch-me', 'Original desc', 'Old content');

      index.patch('patch-me', 'New content here');

      const loaded = index.load('patch-me');
      expect(loaded!.meta.name).toBe('patch-me');
      expect(loaded!.meta.description).toBe('Original desc');
      expect(loaded!.content).toBe('New content here');
    });

    it('throws when patching nonexistent skill', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(() => index.patch('nope', 'content')).toThrow('不存在');
    });
  });

  describe('has', () => {
    it('returns false for unknown skill', () => {
      const index = new SkillIndex(skillsDir);
      index.scan();
      expect(index.has('unknown')).toBe(false);
    });
  });
});

describe('getSkillIndex singleton', () => {
  let temp: ReturnType<typeof useTempDataDir>;

  beforeEach(() => {
    temp = useTempDataDir();
  });

  afterEach(() => {
    _resetSkillIndex();
    temp.cleanup();
  });

  it('returns same instance on repeated calls', () => {
    const a = getSkillIndex();
    const b = getSkillIndex();
    expect(a).toBe(b);
  });

  it('resets properly', () => {
    const a = getSkillIndex();
    _resetSkillIndex();
    const b = getSkillIndex();
    expect(a).not.toBe(b);
  });
});
