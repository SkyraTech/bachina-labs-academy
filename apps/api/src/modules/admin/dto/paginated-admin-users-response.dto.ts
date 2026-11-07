import { ApiProperty } from '@nestjs/swagger';
import { AdminUserItemResponseDto } from './admin-user-item-response.dto.js';

export class PaginatedAdminUsersResponseDto {
  @ApiProperty({ description: 'Paginated user items', type: [AdminUserItemResponseDto] })
  items: AdminUserItemResponseDto[];

  @ApiProperty({ description: 'Total number of users matching query filters', example: 45 })
  total: number;

  @ApiProperty({ description: 'Current page number (1-based)', example: 1 })
  page: number;

  @ApiProperty({ description: 'Page size limit applied', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total calculated pages', example: 3 })
  totalPages: number;
}

