import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiPayloadTooLargeResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { ArticleMediaService, type UploadedMediaFile } from '../services/article-media.service.js';
import { ListMediaAssetsQueryDto } from '../dto/list-media-assets-query.dto.js';
import { MediaAssetResponseDto } from '../dto/media-asset-response.dto.js';
import { PaginatedMediaAssetsResponseDto } from '../dto/paginated-media-assets-response.dto.js';

@ApiTags('articles-media')
@Controller('articles/media')
export class ArticleMediaController {
  constructor(private readonly mediaService: ArticleMediaService) {}

  /**
   * POST /api/v1/articles/media
   *
   * Uploads an image file to private storage for the authenticated author.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MiB limit
    }),
  )
  @ApiOperation({ summary: 'Upload an image file for article use' })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({
    description: 'Image uploaded and registered successfully.',
    type: MediaAssetResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid file format, empty file, or signature mismatch.' })
  @ApiPayloadTooLargeResponse({ description: 'File size exceeds 10 MiB.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Email unverified or account ineligible.' })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedMediaFile,
  ): Promise<MediaAssetResponseDto> {
    return this.mediaService.uploadImage(user, file);
  }

  /**
   * GET /api/v1/articles/media/mine
   *
   * Lists media assets uploaded by the authenticated author.
   */
  @Get('mine')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'List media assets owned by the author' })
  @ApiOkResponse({
    description: 'Paginated list of author media assets.',
    type: PaginatedMediaAssetsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Email unverified or account ineligible.' })
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMediaAssetsQueryDto,
  ): Promise<PaginatedMediaAssetsResponseDto> {
    return this.mediaService.listMyMedia(user, query);
  }

  /**
   * GET /api/v1/articles/media/:mediaId/content
   *
   * Private image preview for the owning author.
   */
  @Get(':mediaId/content')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Retrieve private image content for author preview' })
  @ApiOkResponse({ description: 'Binary image content.' })
  @ApiBadRequestResponse({ description: 'Invalid media UUID.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Email unverified or account ineligible.' })
  @ApiNotFoundResponse({ description: 'Media not found or not owned by caller.' })
  async getPrivateContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mediaId', new ParseUUIDPipe({ version: '4' })) mediaId: string,
    @Res() res: Response,
  ): Promise<void> {
    const content = await this.mediaService.getPrivateMediaContent(user, mediaId);

    res.setHeader('Content-Type', content.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(content.originalFilename)}"`,
    );

    res.end(content.buffer);
  }
}
