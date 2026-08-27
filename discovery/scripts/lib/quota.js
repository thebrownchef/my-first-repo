// Tracks YouTube Data API unit consumption for a single run and enforces the
// configured daily budget. Every call site must go through charge() before
// making the request, so a budget breach is caught before the network call
// rather than after.

export class QuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExceededError';
    this.quotaExceeded = true;
  }
}

export class QuotaTracker {
  constructor(budget) {
    this.budget = budget;
    this.used = 0;
    this.calls = [];
  }

  charge(endpoint, units = 1) {
    if (this.used + units > this.budget) {
      throw new QuotaExceededError(
        `Quota budget exceeded: ${this.used}/${this.budget} units used, next call to ${endpoint} needs ${units} more.`
      );
    }
    this.used += units;
    this.calls.push({ endpoint, units, at: new Date().toISOString() });
  }

  summary() {
    const byEndpoint = {};
    for (const c of this.calls) {
      byEndpoint[c.endpoint] = (byEndpoint[c.endpoint] || 0) + c.units;
    }
    return { used: this.used, budget: this.budget, remaining: this.budget - this.used, byEndpoint };
  }
}
