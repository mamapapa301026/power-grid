import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { RequestHandler } from 'express'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { getAllowedOrigins } from './security/cors'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api/v1')
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    hsts: false,
  }))
  app.enableCors({ origin: getAllowedOrigins() })
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
  }))
  const preventCaching: RequestHandler = (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  }
  app.use(preventCaching)
  if (process.env.TRUST_PROXY === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1)
  }
  await app.listen(Number(process.env.PORT ?? 3000), process.env.API_HOST ?? '127.0.0.1')
}

void bootstrap()