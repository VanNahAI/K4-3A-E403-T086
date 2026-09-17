const assert = require('assert');
const {
  QwenProxyError,
  createQwenProxy,
  parseClassification,
  validateInput
} = require('../qwen_proxy');

async function run() {
  assert.throws(
    () => validateInput({ questionId: 'Q1', question: '', clusters: [] }),
    (error) => error instanceof QwenProxyError && error.statusCode === 400
  );

  assert.deepStrictEqual(
    parseClassification(JSON.stringify({
      matchedClusterId: null,
      suggestedTitle: 'Lỗi xung đột cổng Docker',
      keywords: ['docker', 'port', 'xung đột'],
      category: 'technical',
      confidence: 0.94
    }), []),
    {
      matchedClusterId: null,
      suggestedTitle: 'Lỗi xung đột cổng Docker',
      keywords: ['docker', 'port', 'xung đột'],
      category: 'technical',
      confidence: 0.94
    }
  );

  let upstreamCalls = 0;
  let authorizationHeader = '';
  let classificationBody = null;
  const fetchImpl = async (url, options) => {
    upstreamCalls++;
    authorizationHeader = options.headers.Authorization;
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'qwen3:8b' }] })
      };
    }
    classificationBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              matchedClusterId: null,
              suggestedTitle: 'Cấu hình Docker bị lỗi',
              keywords: ['docker', 'cấu hình', 'lỗi'],
              category: 'technical',
              confidence: 0.92
            })
          }
        }],
        usage: { total_tokens: 42 }
      })
    };
  };

  const proxy = createQwenProxy({
    env: {
      QWEN_API_BASE: 'https://qwen.example/v1',
      QWEN_API_KEY: 'unit-test-secret',
      QWEN_MODEL: 'qwen3:8b',
      QWEN_TIMEOUT_MS: '30000'
    },
    fetchImpl
  });

  const health = await proxy.health();
  assert.strictEqual(health.reachable, true);
  assert.strictEqual(health.model, 'qwen3:8b');

  const request = {
    questionId: 'M1001',
    question: 'Docker của em bị lỗi cấu hình',
    clusters: []
  };
  const [first, duplicate] = await Promise.all([
    proxy.classify(request),
    proxy.classify(request)
  ]);

  assert.deepStrictEqual(first, duplicate);
  assert.strictEqual(first.result.suggestedTitle, 'Cấu hình Docker bị lỗi');
  assert.strictEqual(first.meta.tokensUsed, 42);
  assert.strictEqual(upstreamCalls, 2, 'health + one deduplicated classification request');
  assert.strictEqual(authorizationHeader, 'Bearer unit-test-secret');
  assert.strictEqual(classificationBody.reasoning_effort, 'none');
  assert.deepStrictEqual(classificationBody.response_format, { type: 'json_object' });
  assert.strictEqual(classificationBody.stream, false);
  assert.strictEqual(JSON.stringify(first).includes('unit-test-secret'), false);
  assert.strictEqual(JSON.stringify(proxy.config).includes('unit-test-secret'), false);

  assert.throws(
    () => parseClassification(JSON.stringify({
      matchedClusterId: 'missing-cluster',
      suggestedTitle: null,
      keywords: ['docker'],
      confidence: 0.9
    }), [{ id: 'cluster-1', title: 'Docker', keywords: [] }]),
    (error) => error instanceof QwenProxyError && error.code === 'INVALID_MODEL_RESPONSE'
  );

  const authFailureProxy = createQwenProxy({
    env: { QWEN_API_KEY: 'bad-token' },
    fetchImpl: async () => ({ ok: false, status: 401 })
  });
  await assert.rejects(
    () => authFailureProxy.health(),
    (error) => error instanceof QwenProxyError && error.code === 'QWEN_AUTH_FAILED' && error.statusCode === 502
  );

  const timeoutProxy = createQwenProxy({
    env: { QWEN_API_KEY: 'test-token' },
    fetchImpl: async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }
  });
  await assert.rejects(
    () => timeoutProxy.health(),
    (error) => error instanceof QwenProxyError && error.code === 'QWEN_TIMEOUT' && error.statusCode === 504
  );

  console.log('✓ Qwen proxy validation, auth isolation and deduplication passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
