import { describe, expect, it } from "vitest";
import { createRequestLimiter } from "../src/requestLimiter.js";

describe("request limiter", () => {
  it("allows requests within window and blocks overflow", () => {
    let now = 0;
    const limiter = createRequestLimiter({
      windowMs: 1000,
      maxRequests: 2,
      nowFn: () => now,
    });

    expect(limiter.isAllowed("ip-1")).toBe(true);
    expect(limiter.isAllowed("ip-1")).toBe(true);
    expect(limiter.isAllowed("ip-1")).toBe(false);

    now = 1001;
    expect(limiter.isAllowed("ip-1")).toBe(true);
  });
});
