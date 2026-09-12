import { describe, expect, it } from 'vitest';
import { findMissing } from '../issue-gap';

describe('findMissing', () => {
  it('returns issues open on GitHub that the graph has never held', () => {
    expect(findMissing([1, 2, 3, 4], [1, 3])).toEqual([2, 4]);
  });

  it('returns nothing when the graph holds every open issue', () => {
    expect(findMissing([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it('ignores issues the graph holds that are not currently open', () => {
    expect(findMissing([1, 2], [1, 2, 99]), 'a closed issue in the graph is not a gap').toEqual([]);
  });

  it('sorts ascending regardless of the order GitHub returned', () => {
    expect(findMissing([2463, 57, 1378], [])).toEqual([57, 1378, 2463]);
  });

  it('treats an empty graph as everything missing', () => {
    expect(findMissing([5, 6], [])).toEqual([5, 6]);
  });

  it('handles a graph holding issues GitHub no longer lists as open', () => {
    // The reconciler owns state drift; the gap check must not confuse the two.
    expect(findMissing([10], [10, 11, 12])).toEqual([]);
  });
});
