import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseHealthService } from './database-health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let dbHealthService: { isReachable: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dbHealthService = {
      isReachable: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: DatabaseHealthService,
          useValue: dbHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('throttler exemption', () => {
    it('should have SkipThrottle metadata on the controller class', () => {
      const skipMetadata = Reflect.getMetadata('THROTTLER:SKIPdefault', HealthController);
      expect(skipMetadata).toBe(true);
    });
  });

  describe('check (liveness)', () => {
    it('should return liveness status ok without calling the database', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.uptime).toBe('number');
      expect(dbHealthService.isReachable).not.toHaveBeenCalled();
    });
  });

  describe('databaseCheck (readiness)', () => {
    it('should return ok and connected when database is reachable', async () => {
      dbHealthService.isReachable.mockResolvedValue(true);

      const result = await controller.databaseCheck();
      expect(result.status).toBe('ok');
      expect(result.database).toBe('connected');
      expect(result).toHaveProperty('timestamp');
    });

    it('should throw ServiceUnavailableException when database is unreachable', async () => {
      dbHealthService.isReachable.mockResolvedValue(false);

      await expect(controller.databaseCheck()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
