import { ApiProperty } from '@nestjs/swagger';

export class RefreshResponseDto {
  @ApiProperty({
    description: 'Status message indicating successful session refresh.',
    example: 'Session refreshed successfully.',
  })
  message!: string;
}
