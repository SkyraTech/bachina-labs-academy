import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseHealthService } from './database-health.service';
import { PrismaService } from '../../database/prisma.service';

describe('DatabaseHealthService', () => {
  let service: DatabaseHealthService;
  let prismaService: { isHealthy: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prismaService = {
      isHealthy: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseHealthService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    service = module.get<DatabaseHealthService>(DatabaseHealthService);
  });

  it('should return true when PrismaService.isHealthy resolves true', async () => {
    prismaService.isHealthy.mockResolvedValue(true);
    const result = await service.isReachable();
    expect(result).toBe(true);
    expect(prismaService.isHealthy).toHaveBeenCalledTimes(1);
  });

  it('should return false when PrismaService.isHealthy resolves false', async () => {
    prismaService.isHealthy.mockResolvedValue(false);
    const result = await service.isReachable();
    expect(result).toBe(false);
    expect(prismaService.isHealthy).toHaveBeenCalledTimes(1);
  });
});
