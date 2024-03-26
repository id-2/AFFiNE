import '../../src/plugins/config';

import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  UseGuards,
} from '@nestjs/common';
import ava, { TestFn } from 'ava';
import Sinon from 'sinon';
import request, { type Response } from 'supertest';

import { AppModule } from '../../src/app.module';
import { AuthService, Public } from '../../src/core/auth';
import { ConfigModule } from '../../src/fundamentals/config';
import {
  CloudThrottlerGuard,
  SkipThrottle,
  Throttle,
  ThrottlerStorage,
} from '../../src/fundamentals/throttler';
import { createTestingApp, sessionCookie } from '../utils';

const test = ava as TestFn<{
  storage: ThrottlerStorage;
  cookie: string;
  app: INestApplication;
}>;

@UseGuards(CloudThrottlerGuard)
@Throttle()
@Controller('/throttled')
class ThrottledController {
  @Get('/default')
  default() {
    return 'default';
  }

  @Throttle('strict')
  @Get('/strict')
  strict() {
    return 'strict';
  }

  @SkipThrottle()
  @Get('/skip')
  skip() {
    return 'skip';
  }
}

@UseGuards(CloudThrottlerGuard)
@Controller('/nonthrottled')
class NonThrottledController {
  @Public()
  @SkipThrottle()
  @Get('/skip')
  skip() {
    return 'skip';
  }

  @Public()
  @Get('/default')
  default() {
    return 'default';
  }

  @Public()
  @Throttle('strict')
  @Get('/strict')
  strict() {
    return 'strict';
  }
}

test.beforeEach(async t => {
  const { app } = await createTestingApp({
    imports: [
      ConfigModule.forRoot({
        rateLimiter: {
          ttl: 60,
          limit: 120,
        },
      }),
      AppModule,
    ],
    controllers: [ThrottledController, NonThrottledController],
  });

  t.context.storage = app.get(ThrottlerStorage);
  t.context.app = app;

  const auth = app.get(AuthService);
  const u1 = await auth.signUp('u1', 'u1@affine.pro', 'test');

  const res = await request(app.getHttpServer())
    .post('/api/auth/sign-in')
    .send({ email: u1.email, password: 'test' });

  t.context.cookie = sessionCookie(res.headers)!;
});

test.afterEach.always(async t => {
  await t.context.app.close();
});

function rateLimitHeaders(res: Response) {
  return {
    limit: res.header['x-ratelimit-limit'],
    remaining: res.header['x-ratelimit-remaining'],
    reset: res.header['x-ratelimit-reset'],
    retryAfter: res.header['retry-after'],
  };
}

test('should be able to prevent requests if limit is reached', async t => {
  const { app } = t.context;

  const stub = Sinon.stub(app.get(ThrottlerStorage), 'increment').resolves({
    timeToExpire: 10,
    totalHits: 21,
  });
  const res = await request(app.getHttpServer())
    .get('/nonthrottled/strict')
    .expect(HttpStatus.TOO_MANY_REQUESTS);

  const headers = rateLimitHeaders(res);

  t.is(headers.retryAfter, '10');

  stub.restore();
});

// ====== unauthenticated user visits ======
test('should use default throttler for unauthenticated user when not specified', async t => {
  const { app } = t.context;

  const res = await request(app.getHttpServer())
    .get('/nonthrottled/default')
    .expect(200);

  const headers = rateLimitHeaders(res);

  t.is(headers.limit, '120');
  t.is(headers.remaining, '119');
  t.is(headers.reset, '60');
});

test('should skip throttler for unauthenticated user when specified', async t => {
  const { app } = t.context;

  const res = await request(app.getHttpServer())
    .get('/nonthrottled/skip')
    .expect(200);

  const headers = rateLimitHeaders(res);

  t.is(headers.limit, undefined!);
  t.is(headers.remaining, undefined!);
  t.is(headers.reset, undefined!);
});

test('should use specified throttler for unauthenticated user', async t => {
  const { app } = t.context;

  const res = await request(app.getHttpServer())
    .get('/nonthrottled/strict')
    .expect(200);

  const headers = rateLimitHeaders(res);

  t.is(headers.limit, '20');
  t.is(headers.remaining, '19');
  t.is(headers.reset, '60');
});

// ==== authenticated user visits ====
test('should not protect unspecified routes', async t => {
  const { app, cookie } = t.context;

  const res = await request(app.getHttpServer())
    .get('/nonthrottled/default')
    .set('Cookie', cookie)
    .expect(200);

  const headers = rateLimitHeaders(res);

  t.is(headers.limit, undefined!);
  t.is(headers.remaining, undefined!);
  t.is(headers.reset, undefined!);
});

test('should use default throttler for authenticated user when not specified', async t => {
  const { app, cookie } = t.context;

  const res = await request(app.getHttpServer())
    .get('/throttled/default')
    .set('Cookie', cookie)
    .expect(200);

  const headers = rateLimitHeaders(res);

  t.is(headers.limit, '120');
  t.is(headers.remaining, '119');
  t.is(headers.reset, '60');
});

test('should skip throttler for authenticated user when specified', async t => {
  const { app, cookie } = t.context;

  const res = await request(app.getHttpServer())
    .get('/throttled/skip')
    .set('Cookie', cookie)
    .expect(200);

  const headers = rateLimitHeaders(res);

  t.is(headers.limit, undefined!);
  t.is(headers.remaining, undefined!);
  t.is(headers.reset, undefined!);
});

test('should use specified throttler for authenticated user', async t => {
  const { app, cookie } = t.context;

  const res = await request(app.getHttpServer())
    .get('/throttled/strict')
    .set('Cookie', cookie)
    .expect(200);

  const headers = rateLimitHeaders(res);

  t.is(headers.limit, '20');
  t.is(headers.remaining, '19');
  t.is(headers.reset, '60');
});

test('should separate anonymous and authenticated user throttlers', async t => {
  const { app, cookie } = t.context;

  const authenticatedUserRes = await request(app.getHttpServer())
    .get('/throttled/default')
    .set('Cookie', cookie)
    .expect(200);
  const unauthenticatedUserRes = await request(app.getHttpServer())
    .get('/nonthrottled/default')
    .expect(200);

  const authenticatedResHeaders = rateLimitHeaders(authenticatedUserRes);
  const unauthenticatedResHeaders = rateLimitHeaders(unauthenticatedUserRes);

  t.is(authenticatedResHeaders.limit, '120');
  t.is(authenticatedResHeaders.remaining, '119');
  t.is(authenticatedResHeaders.reset, '60');

  t.is(unauthenticatedResHeaders.limit, '120');
  t.is(unauthenticatedResHeaders.remaining, '119');
  t.is(unauthenticatedResHeaders.reset, '60');
});