import { ApiProperty } from '@nestjs/swagger';

export class RevokeSessionResponseDto {
  @ApiProperty({
    example: 'Session revoked successfully.',
    description: 'Human-readable confirmation message',
  })
  message!: string;

  @ApiProperty({
    example: false,
    description: 'True if the revoked session was the current device session',
  })
  isCurrentSession!: boolean;
}
