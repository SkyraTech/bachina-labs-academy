import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return API info with name and version', () => {
      const result = appController.getRoot();
      expect(result).toHaveProperty('name', 'Bachina Labs Academy API');
      expect(result).toHaveProperty('version', '1.0.0');
    });
  });
});
