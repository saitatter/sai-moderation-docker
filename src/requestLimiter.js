export function createRequestLimiter({
  windowMs = 10_000,
  maxRequests = 60,
  nowFn = () => Date.now(),
} = {}) {
  const buckets = new Map();

  function isAllowed(key) {
    const now = nowFn();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(key, { windowStart: now, count: 1 });
      return true;
    }

    if (bucket.count >= maxRequests) return false;
    bucket.count += 1;
    return true;
  }

  return {
    isAllowed,
  };
}
