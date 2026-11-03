import { expect, test } from 'vitest'

// Deliberately failing: proves CI goes red. Reverted in the next commit.
test('ci canary', () => { expect(1).toBe(2) })
