import { describe, it, expect } from 'vitest';
import { UNGROUPED } from '../src/types';

describe('smoke', () => {
  it('types module loads', () => {
    expect(UNGROUPED).toBe('未分组');
  });
});
