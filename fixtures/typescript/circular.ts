// Fixture: circular import dependency, used to verify cycle-safe traversal.
// A.ts imports B; B.ts imports A. The traversal test asserts this never hangs.
//
// We simulate the two-file cycle in one file for golden purposes, but the cycle-detection
// test in test/unit/graph.test.ts builds the cycle directly via edges in SQLite.
import { B } from './B';

export class A {
  b: B;
  constructor() {
    this.b = new B();
  }
}
