import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
  applyTraceResponseHeaders,
  buildOutboundTraceHeaders,
  createRequestContext,
  extractRequestContextFromHeaders,
  formatTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  getRequestContext,
  getRequestId,
  parseTraceparent,
  runWithRequestContext,
  withRequestTracing,
} from './request-context';

test('generateTraceId returns 32 lowercase hex chars', () => {
  const id = generateTraceId();
  assert.match(id, /^[0-9a-f]{32}$/);
});

test('generateSpanId returns 16 lowercase hex chars', () => {
  const id = generateSpanId();
  assert.match(id, /^[0-9a-f]{16}$/);
});

test('generateRequestId returns a UUIDv4-ish string', () => {
  const id = generateRequestId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('parseTraceparent rejects malformed input', () => {
  assert.equal(parseTraceparent(null), null);
  assert.equal(parseTraceparent(''), null);
  assert.equal(parseTraceparent('not-a-traceparent'), null);
  // wrong version
  assert.equal(
    parseTraceparent('01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'),
    null
  );
  // all-zero trace id
  assert.equal(
    parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01'),
    null
  );
  // bad hex
  assert.equal(
    parseTraceparent('00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-b7ad6b7169203331-01'),
    null
  );
});

test('parseTraceparent accepts a valid traceparent', () => {
  const parsed = parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
  assert.deepEqual(parsed, {
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId: 'b7ad6b7169203331',
    flags: '01',
  });
});

test('formatTraceparent reproduces the canonical format', () => {
  const value = formatTraceparent('0af7651916cd43dd8448eb211c80319c', 'b7ad6b7169203331', '01');
  assert.equal(value, '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
});

test('createRequestContext continues an inbound trace when traceparent is valid', () => {
  const ctx = createRequestContext({
    requestId: 'inbound-req-id',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  });

  assert.equal(ctx.requestId, 'inbound-req-id');
  assert.equal(ctx.traceId, '0af7651916cd43dd8448eb211c80319c');
  assert.equal(ctx.parentSpanId, 'b7ad6b7169203331');
  assert.equal(ctx.flags, '01');
  assert.match(ctx.spanId, /^[0-9a-f]{16}$/);
  // span id must differ from inherited parent
  assert.notEqual(ctx.spanId, 'b7ad6b7169203331');
});

test('createRequestContext starts a fresh trace when traceparent is missing', () => {
  const ctx = createRequestContext({});
  assert.match(ctx.traceId, /^[0-9a-f]{32}$/);
  assert.equal(ctx.parentSpanId, undefined);
  assert.match(ctx.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('extractRequestContextFromHeaders reads expected headers', () => {
  const headers = new Headers({
    [REQUEST_ID_HEADER]: 'incoming-id',
    [TRACEPARENT_HEADER]: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    [TRACESTATE_HEADER]: 'rojo=00f067aa0ba902b7',
  });
  const ctx = extractRequestContextFromHeaders(headers);
  assert.equal(ctx.requestId, 'incoming-id');
  assert.equal(ctx.traceId, '0af7651916cd43dd8448eb211c80319c');
  assert.equal(ctx.parentSpanId, 'b7ad6b7169203331');
  assert.equal(ctx.traceState, 'rojo=00f067aa0ba902b7');
});

test('runWithRequestContext exposes the active context', () => {
  const ctx = createRequestContext({});
  assert.equal(getRequestContext(), undefined);
  const result = runWithRequestContext(ctx, () => {
    return getRequestId();
  });
  assert.equal(result, ctx.requestId);
  assert.equal(getRequestContext(), undefined);
});

test('runWithRequestContext propagates across async boundaries', async () => {
  const ctx = createRequestContext({});
  const observed = await runWithRequestContext(ctx, async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 1));
    return getRequestId();
  });
  assert.equal(observed, ctx.requestId);
});

test('applyTraceResponseHeaders writes the trace headers onto the response', () => {
  const ctx = createRequestContext({});
  ctx.traceState = 'foo=bar';
  const response = new Response('ok');
  applyTraceResponseHeaders(response.headers, ctx);
  assert.equal(response.headers.get(REQUEST_ID_HEADER), ctx.requestId);
  assert.equal(
    response.headers.get(TRACEPARENT_HEADER),
    formatTraceparent(ctx.traceId, ctx.spanId, ctx.flags)
  );
  assert.equal(response.headers.get(TRACESTATE_HEADER), 'foo=bar');
});

test('buildOutboundTraceHeaders includes the active trace identifiers', () => {
  const ctx = createRequestContext({
    requestId: 'req-out',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  });
  const headers = runWithRequestContext(ctx, () => buildOutboundTraceHeaders());
  assert.equal(headers[REQUEST_ID_HEADER], 'req-out');
  assert.equal(
    headers[TRACEPARENT_HEADER],
    formatTraceparent(ctx.traceId, ctx.spanId, ctx.flags)
  );
});

test('buildOutboundTraceHeaders returns empty when no context is active', () => {
  const headers = buildOutboundTraceHeaders();
  assert.deepEqual(headers, {});
});

test('withRequestTracing wraps successful handlers with trace headers', async () => {
  const handler = withRequestTracing(async (req: Request) => {
    const ctx = getRequestContext();
    assert.ok(ctx, 'expected request context to be active inside handler');
    assert.equal(req.headers.get(REQUEST_ID_HEADER), 'caller-req-id');
    return new Response(JSON.stringify({ requestId: ctx.requestId }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const res = await handler(
    new Request('http://example.com/api/health', {
      headers: {
        [REQUEST_ID_HEADER]: 'caller-req-id',
        [TRACEPARENT_HEADER]: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      },
    })
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get(REQUEST_ID_HEADER), 'caller-req-id');
  const tp = res.headers.get(TRACEPARENT_HEADER);
  assert.match(tp ?? '', /^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);

  const body = (await res.json()) as { requestId: string };
  assert.equal(body.requestId, 'caller-req-id');
});

test('withRequestTracing converts thrown errors into 500 with trace metadata', async () => {
  const handler = withRequestTracing(async () => {
    throw new Error('boom');
  });

  const res = await handler(new Request('http://example.com/api/x'));
  assert.equal(res.status, 500);
  const requestId = res.headers.get(REQUEST_ID_HEADER);
  assert.ok(requestId);
  const body = (await res.json()) as { error: string; requestId: string };
  assert.equal(body.error, 'boom');
  assert.equal(body.requestId, requestId);
});
