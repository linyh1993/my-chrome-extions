/**
 * Automated Verification for Proxy-Server Relay Client & Envelope Contract
 * Run with: node tests/relay.test.js
 */

const assert = require('assert');
const {
  DEFAULT_RELAY_ENDPOINT,
  createSerpEnvelope,
  pingRelay,
  sendSerpEnvelope
} = require('../shared/relay-client.js');

let passedTests = 0;
let totalTests = 0;

async function it(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function describe(suiteName, fn) {
  console.log(`\n\x1b[1m\x1b[34m[Suite]\x1b[0m ${suiteName}`);
  return fn();
}

(async function runTests() {
  console.log('====================================================');
  console.log('🧪 Running Proxy-Server Relay & Envelope Contract Tests');
  console.log('====================================================');

  await describe('1. Envelope DTO Construction & Contract Compliance', async () => {
    await it('should construct a valid RelayEnvelope compliant with proxy-server Pydantic model', () => {
      const sampleSerpData = {
        query: 'ai photo detector',
        totalFound: 10,
        items: [
          { rank: 1, title: 'AI Detector', url: 'https://example.com/ai', mozDa: '65/100', monthlyVisits: '1.2M' }
        ],
        relatedKeywords: [
          { keyword: 'free ai detector', volume: '10K', cpc: '$0.80' }
        ],
        relatedProducts: [],
        sponsoredAds: [],
        peopleAlsoAsk: [],
        pageInfo: { pageNumber: 1, isFirstPage: true },
        resultStats: { raw: 'About 10,000 results' }
      };

      const envelope = createSerpEnvelope(sampleSerpData, {
        sourceUrl: 'https://www.google.com/search?q=ai+photo+detector'
      });

      assert.strictEqual(envelope.version, '1.0');
      assert.strictEqual(envelope.relaySource, 'google-serp-extractor');
      assert.strictEqual(envelope.site.id, 'google');
      assert.strictEqual(envelope.site.label, 'Google SERP');
      assert.strictEqual(envelope.channel, 'dom_extracted');
      assert.strictEqual(envelope.action, 'data');
      assert.strictEqual(envelope.sourceUrl, 'https://www.google.com/search?q=ai+photo+detector');
      assert.ok(envelope.timestamp);

      // Check payload
      assert.strictEqual(envelope.payload.query, 'ai photo detector');
      assert.strictEqual(envelope.payload.items.length, 1);
      assert.strictEqual(envelope.payload.items[0].title, 'AI Detector');
      assert.strictEqual(envelope.payload.relatedKeywords.length, 1);
      assert.strictEqual(envelope.payload.pageInfo.pageNumber, 1);
    });

    await it('should handle empty or null serpData gracefully without throwing', () => {
      const envelope = createSerpEnvelope(null);
      assert.strictEqual(envelope.version, '1.0');
      assert.strictEqual(envelope.site.id, 'google');
      assert.strictEqual(envelope.payload.query, '');
      assert.deepStrictEqual(envelope.payload.items, []);
    });
  });

  await describe('2. Network Dispatch, Mock Responses & Resilience', async () => {
    await it('should successfully send envelope when endpoint responds with 200 OK', async () => {
      const originalFetch = global.fetch;
      global.fetch = async (url, options) => {
        assert.strictEqual(url, 'http://127.0.0.1:9090/relay');
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers['Content-Type'], 'application/json');
        assert.strictEqual(options.headers['X-Relay-Site'], 'google');
        assert.strictEqual(options.headers['X-Relay-Channel'], 'dom_extracted');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            status: 'ok',
            message: 'Envelope processed successfully',
            details: { raw_event_id: 42 }
          })
        };
      };

      try {
        const envelope = createSerpEnvelope({ query: 'test query', items: [{ rank: 1 }] });
        const result = await sendSerpEnvelope(DEFAULT_RELAY_ENDPOINT, envelope);

        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.status, 200);
        assert.strictEqual(result.details.raw_event_id, 42);
      } finally {
        global.fetch = originalFetch;
      }
    });

    await it('should gracefully catch and report network failure without throwing unhandled rejection', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9090');
      };

      try {
        const envelope = createSerpEnvelope({ query: 'test' });
        const result = await sendSerpEnvelope(DEFAULT_RELAY_ENDPOINT, envelope);

        assert.strictEqual(result.ok, false);
        assert.ok(result.error.includes('ECONNREFUSED'));
      } finally {
        global.fetch = originalFetch;
      }
    });

    await it('should handle pingRelay check correctly', async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            message: 'Pong from proxy-server! Connection healthy.'
          })
        };
      };

      try {
        const pingRes = await pingRelay('http://127.0.0.1:9090/relay');
        assert.strictEqual(pingRes.ok, true);
        assert.ok(pingRes.message.includes('healthy'));
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  console.log('\n====================================================');
  console.log(`✅ Results: ${passedTests}/${totalTests} tests passed`);
  console.log('====================================================\n');
})();
