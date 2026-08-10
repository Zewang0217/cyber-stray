import { describe, it, expect } from 'vitest';
import { parseSkillFile } from './parser.js';

describe('parseSkillFile', () => {
  it('parses valid frontmatter with all fields', () => {
    const raw = `---
name: test-skill
description: A test skill
state: stale
---
# Hello

Some content here.`;

    const result = parseSkillFile(raw, 'test/SKILL.md');
    expect(result.meta.name).toBe('test-skill');
    expect(result.meta.description).toBe('A test skill');
    expect(result.meta.state).toBe('stale');
    expect(result.content).toBe('# Hello\n\nSome content here.');
    expect(result.filePath).toBe('test/SKILL.md');
  });

  it('defaults state to active when not specified', () => {
    const raw = `---
name: my-skill
description: Does things
---
Body text.`;

    const result = parseSkillFile(raw, 'my-skill/SKILL.md');
    expect(result.meta.state).toBe('active');
  });

  it('falls back to active for invalid state values', () => {
    const raw = `---
name: my-skill
description: Does things
state: unknown-state
---
Body.`;

    const result = parseSkillFile(raw, 'my-skill/SKILL.md');
    expect(result.meta.state).toBe('active');
  });

  it('throws when name is missing', () => {
    const raw = `---
description: No name here
---
Content.`;

    expect(() => parseSkillFile(raw, 'bad/SKILL.md')).toThrow('缺少必填字段 name');
  });

  it('throws when description is missing', () => {
    const raw = `---
name: no-desc
---
Content.`;

    expect(() => parseSkillFile(raw, 'bad/SKILL.md')).toThrow('缺少必填字段 description');
  });

  it('throws when no frontmatter present', () => {
    const raw = '# Just markdown\n\nNo frontmatter.';

    expect(() => parseSkillFile(raw, 'bad/SKILL.md')).toThrow('缺少 YAML frontmatter');
  });

  it('extracts content after frontmatter correctly', () => {
    const raw = `---
name: skill
description: desc
---

Line 1
Line 2`;

    const result = parseSkillFile(raw, 'skill/SKILL.md');
    expect(result.content).toBe('\nLine 1\nLine 2');
  });

  it('handles empty content after frontmatter', () => {
    const raw = `---
name: empty
description: Empty body
---`;

    const result = parseSkillFile(raw, 'empty/SKILL.md');
    expect(result.content).toBe('');
  });

  it('handles CRLF line endings', () => {
    const raw = '---\r\nname: crlf-skill\r\ndescription: CRLF test\r\n---\r\nContent here.';

    const result = parseSkillFile(raw, 'crlf/SKILL.md');
    expect(result.meta.name).toBe('crlf-skill');
    expect(result.content).toBe('Content here.');
  });
});
