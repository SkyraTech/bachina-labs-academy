import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo(): { name: string; version: string } {
    return {
      name: 'Bachina Labs Academy API',
      version: '1.0.0',
    };
  }
}
