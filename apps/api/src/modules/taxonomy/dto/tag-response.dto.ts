import { ApiProperty } from '@nestjs/swagger';

export class TagResponseDto {
  @ApiProperty({ description: 'Unique tag identifier (UUID)', example: 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e' })
  id: string;

  @ApiProperty({ description: 'Tag display name', example: 'NestJS' })
  name: string;

  @ApiProperty({ description: 'Unique normalized slug', example: 'nestjs' })
  slug: string;

  @ApiProperty({ description: 'Timestamp when tag was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Timestamp when tag was last updated' })
  updatedAt: Date;
}

