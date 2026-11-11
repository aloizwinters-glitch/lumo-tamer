import { describe, it, expect } from "vitest";
import { createAttemptGate } from "../../src/api/attempt-limit.js";

describe("createAttemptGate", () => {
  it("blocks after max failed attempts within the window", () => {
    const gate = createAttemptGate(3, 60_000);
    expect(gate.allow("1.2.3.4")).toBe(true);
    expect(gate.allow("1.2.3.4")).toBe(true);
    expect(gate.allow("1.2.3.4")).toBe(true);
    expect(gate.allow("1.2.3.4")).toBe(false);
    expect(gate.allow("5.6.7.8")).toBe(true);
  });

  it("does not count successes toward the limit", () => {
    const gate = createAttemptGate(2, 60_000);
    gate.allow("1.2.3.4");
    gate.success("1.2.3.4");
    expect(gate.allow("1.2.3.4")).toBe(true);
    gate.success("1.2.3.4");
    expect(gate.allow("1.2.3.4")).toBe(true);
  });

  it("success clears accumulated failures for that ip only", () => {
    const gate = createAttemptGate(2, 60_000);
    gate.allow("1.2.3.4");
    gate.success("1.2.3.4");
    gate.allow("5.6.7.8");
    gate.allow("5.6.7.8");
    expect(gate.allow("5.6.7.8")).toBe(false);
  });
});
