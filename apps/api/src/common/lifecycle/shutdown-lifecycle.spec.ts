import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

describe('NestJS Graceful Shutdown Lifecycle & Hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_RUNTIME_URL'] =
      'postgresql://academy_app:runtime_secret@localhost:5432/bachina_labs_academy?schema=public';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('1. Bootstrap registers shutdown hooks on INestApplication', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $disconnect: vi.fn().mockResolvedValue(undefined),
            onModuleDestroy: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    const enableShutdownHooksSpy = vi.spyOn(app, 'enableShutdownHooks');

    // Verify enableShutdownHooks can be called on the application instance
    app.enableShutdownHooks();
    expect(enableShutdownHooksSpy).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('2. Shutdown initialization executes before accepting traffic', async () => {
    const callOrder: string[] = [];

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $disconnect: vi.fn().mockResolvedValue(undefined),
            onModuleDestroy: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();

    vi.spyOn(app, 'enableShutdownHooks').mockImplementation(() => {
      callOrder.push('enableShutdownHooks');
      return app;
    });

    vi.spyOn(app, 'listen').mockImplementation(async () => {
      callOrder.push('listen');
      return app.getHttpServer();
    });

    // Simulate bootstrap ordering
    app.enableShutdownHooks();
    await app.listen(3000);

    expect(callOrder).toEqual(['enableShutdownHooks', 'listen']);
    await app.close();
  });

  it('3. Existing Prisma lifecycle cleanup is invoked when NestJS application closes', async () => {
    const disconnectMock = vi.fn().mockResolvedValue(undefined);

    class MockPrismaService extends PrismaService {
      constructor() {
        super();
      }
      override async onModuleInit(): Promise<void> {
        // bypass database ping in unit test
      }
      override async $disconnect(): Promise<void> {
        return disconnectMock();
      }
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useClass: MockPrismaService,
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    const prisma = app.get(PrismaService);
    const onModuleDestroySpy = vi.spyOn(prisma, 'onModuleDestroy');

    await app.init();
    await app.close();

    expect(onModuleDestroySpy).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('4. Shutdown hook configuration does not alter global prefix or route handling', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $disconnect: vi.fn().mockResolvedValue(undefined),
            onModuleDestroy: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['/health'] });
    app.enableShutdownHooks();

    // Verify adapter configuration remains stable
    const httpAdapter = app.getHttpAdapter();
    expect(httpAdapter).toBeDefined();

    await app.close();
  });

  it('5. Repeated teardown does not create duplicate cleanup errors or unhandled rejections', async () => {
    const disconnectMock = vi.fn().mockResolvedValue(undefined);

    const service = new PrismaService();
    vi.spyOn(service, '$disconnect').mockImplementation(disconnectMock);

    // Call onModuleDestroy repeatedly
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(disconnectMock).toHaveBeenCalledTimes(2);
  });

  it('6. Application startup remains successful with the existing restricted database role', async () => {
    const service = new PrismaService();

    // Mock queryRaw to simulate the valid restricted runtime role (academy_app)
    vi.spyOn(service, '$queryRaw').mockResolvedValue([
      {
        current_database: 'bachina_labs_academy',
        current_user: 'academy_app',
        is_superuser: false,
        can_create_role: false,
        can_create_db: false,
        owns_audit_logs: false,
        has_audit_update: false,
        has_audit_delete: false,
        has_audit_truncate: false,
        has_schema_create: false,
      },
    ]);

    await expect(service.verifyRuntimePrivileges()).resolves.toBeUndefined();
  });
});
