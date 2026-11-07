import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { ModerationReason } from '@prisma/client';

export class AdminRemoveCommentDto {
  @ApiProperty({
    description: 'Controlled moderation reason code',
    enum: ModerationReason,
    example: ModerationReason.SPAM,
  })
  @IsNotEmpty()
  @IsEnum(ModerationReason, {
    message: 'Reason must be one of: SPAM, HARASSMENT, HATE_SPEECH, INAPPROPRIATE, OFF_TOPIC, POLICY_VIOLATION',
  })
  reason!: ModerationReason;
}

