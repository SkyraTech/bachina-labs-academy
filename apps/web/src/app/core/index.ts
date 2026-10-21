/**
 * Core barrel — re-exports core singleton services and configuration.
 */
export * from './api';
export * from './theme/theme.service';
export * from './auth/models';
export * from './auth/services/auth-api.service';
export * from './auth/services/auth-state.service';
export * from './auth/services/auth-refresh.service';
export * from './auth/guards';
export * from './auth/interceptors/auth-refresh.interceptor';

