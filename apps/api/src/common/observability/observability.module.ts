import { Global, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { StructuredLoggerService } from './structured-logger.service';
import { RequestContextService } from './request-context.service';
import { RequestCorrelationMiddleware } from './request-correlation.middleware';
import { HttpLoggingInterceptor } from './http-logging.interceptor';
import { HttpExceptionFilter } from './http-exception.filter';

@Global()
@Module({
  providers: [
    StructuredLoggerService,
    RequestContextService,
    HttpLoggingInterceptor,
    HttpExceptionFilter,
  ],
  exports: [
    StructuredLoggerService,
    RequestContextService,
    HttpLoggingInterceptor,
    HttpExceptionFilter,
  ],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestCorrelationMiddleware).forRoutes('*');
  }
}
