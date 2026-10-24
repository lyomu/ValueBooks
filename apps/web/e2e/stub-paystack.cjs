// Opt-in UAT process guard. The browser drills must never make a live Paystack request,
// even if a refusal regresses. Install before importing the API application.
const originalFetch = globalThis.fetch;
const planAmounts = new Map();
globalThis.fetch = function uatFetch(input, init) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  if (new URL(url).hostname === 'api.paystack.co') {
    const path = new URL(url).pathname;
    const method = init?.method ?? 'GET';
    const respond = (data, message = 'Success') => Promise.resolve(new Response(JSON.stringify({ status: true, message, data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (path === '/plan/PLN_uatgrowth' && method === 'PUT') {
      const body = JSON.parse(init.body);
      if (body.update_existing_subscriptions !== true) throw new Error('UAT expected explicit repricing.');
      planAmounts.set(path, body.amount);
      return respond({}, 'Plan updated. 1 subscription(s) affected.');
    }
    if (path === '/plan/PLN_uatgrowth' && method === 'GET')
      return respond({ plan_code: 'PLN_uatgrowth', amount: planAmounts.get(path) ?? 499,
        currency: 'USD', interval: 'monthly' });
    if (path === '/subscription/SUB_uat_f12' && method === 'GET')
      return respond({ subscription_code: 'SUB_uat_f12', customer: { customer_code: 'CUS_uat_f12' },
        status: 'active', next_payment_date: '2026-12-01T00:00:00.000Z', email_token: 'uat-token' });
    if (path === '/subscription/disable' && method === 'POST') {
      const body = JSON.parse(init.body);
      if (body.code !== 'SUB_uat_f12' || body.token !== 'uat-token') throw new Error('Unexpected UAT cancellation.');
      return respond({});
    }
    throw new Error(`UAT blocked an unstubbed Paystack fetch: ${method} ${path}`);
  }
  return originalFetch.call(this, input, init);
};
