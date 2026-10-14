import { ApiProperty } from '@nestjs/swagger';

export class LogoutAllResponseDto {
  @ApiProperty({
    example: 'All sessions logged out successfully.',
    description: 'Human-readable confirmation message',
  })
  message!: string;

  @ApiProperty({
    example: 3,
    description: 'Number of active sessions revoked',
  })
  revokedCount!: number;
}
