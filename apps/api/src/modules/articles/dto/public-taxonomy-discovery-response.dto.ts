import { ApiProperty } from '@nestjs/swagger';

export class PublicDiscoveredCategoryDto {
  @ApiProperty({
    description: 'Unique identifier of the frozen category',
    example: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  })
  id!: string;

  @ApiProperty({
    description: 'Frozen category name from immutable snapshot',
    example: 'Backend Engineering',
  })
  name!: string;

  @ApiProperty({
    description: 'Frozen category slug from immutable snapshot',
    example: 'backend-engineering',
  })
  slug!: string;

  @ApiProperty({
    description: 'Number of publicly visible articles associated with this category',
    example: 12,
  })
  articleCount!: number;
}

export class PublicDiscoveredTagDto {
  @ApiProperty({
    description: 'Unique identifier of the frozen tag',
    example: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  id!: string;

  @ApiProperty({
    description: 'Frozen tag name from immutable snapshot',
    example: 'PostgreSQL',
  })
  name!: string;

  @ApiProperty({
    description: 'Frozen tag slug from immutable snapshot',
    example: 'postgresql',
  })
  slug!: string;

  @ApiProperty({
    description: 'Number of publicly visible articles associated with this tag',
    example: 7,
  })
  articleCount!: number;
}

