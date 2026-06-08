declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

declare module "node:assert/strict" {
  interface StrictAssert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
    doesNotMatch(value: string, regexp: RegExp, message?: string): void;
    throws(block: () => unknown, expected?: RegExp, message?: string): void;
  }

  const assert: StrictAssert;
  export default assert;
}

declare module "node:test" {
  type TestBody = () => void | Promise<void>;
  function test(name: string, body: TestBody): void;
  export default test;
}
