import { Module } from '@nestjs/common'
import { SubstationsController } from './substations.controller'

@Module({ controllers: [SubstationsController] })
export class SubstationsModule {}