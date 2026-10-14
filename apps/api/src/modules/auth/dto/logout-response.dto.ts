import { ApiProperty } from '@nestjs/swagger';

export class LogoutResponseDto {
  @ApiProperty({
    example: 'Logged out successfully.',
    description: 'Human-readable confirmation message',
  })
  message!: string;
}
