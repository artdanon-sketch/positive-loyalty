import type { Server } from 'node:http'

import { RequestMethod, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { PlatformPrismaService } from '../src/platform/platform-prisma.service'

/**
 * ТЕСТ-СТРАЖ: в основном API нет ни одного маршрута админки платформы.
 *
 * ─── Что сторожится и почему это важнее, чем кажется ─────────────────────────
 *
 * Вся защита платформенного контура держится на том, что он живёт в ОТДЕЛЬНОМ
 * процессе: со своей ролью Postgres, своим секретом подписи токенов и своим
 * деплоем. Основное приложение обслуживает владельцев ресторанов и кассиров —
 * и его роль в базе не умеет читать чужое заведение, что бы ни было написано
 * в коде.
 *
 * Ровно одна строка способна это обнулить: `PlatformModule` в списке imports
 * у AppModule. После неё вход, видящий все заведения, окажется на том же порту,
 * что и бэк-офис ресторана, а таблицы платформы попытается читать роль
 * positive_app.
 *
 * Заметить такое глазами на ревью тяжело: это одно слово в списке из восьми.
 * Поэтому здесь тест, а не обещание в комментарии.
 *
 * ─── Почему проверяются ОБА признака ─────────────────────────────────────────
 *
 * Отсутствие маршрутов и отсутствие провайдера — разные вещи, и каждая
 * ловит свой промах. Модуль могли подключить, но не открыть маршруты
 * (тогда молча появился бы второй пул соединений к базе), а могли и наоборот —
 * скопировать контроллер в существующий модуль.
 */
describe('Основной API не знает про админку платформы', () => {
  let app: INestApplication
  let server: Server

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('v1', {
      exclude: [{ path: 'health', method: RequestMethod.GET }],
    })

    await app.init()
    server = app.getHttpServer() as Server
  })

  afterAll(async () => {
    await app.close()
  })

  it('маршрут входа админа платформы отвечает 404, а не 401', async () => {
    const response = await request(server)
      .post('/v1/platform/auth/sign-in')
      .send({
        email: 'a@b.test',
        password: 'x'.repeat(12),
        totpCode: '123456',
        deviceId: 'x'.repeat(16),
      })

    // Именно 404, а не 401: 401 означал бы, что маршрут существует и просто
    // не пустил. Существования быть не должно вовсе.
    expect(response.status).toBe(404)
  })

  it('и любой другой маршрут /v1/platform тоже', async () => {
    for (const path of ['/v1/platform/auth/me', '/v1/platform/tenants', '/v1/platform/metrics']) {
      const response = await request(server).get(path)
      expect(response.status, `маршрут ${path} не должен существовать в основном API`).toBe(404)
    }
  })

  it('в списке маршрутов основного API нет ни одного пути с platform', () => {
    const httpAdapter = app.getHttpAdapter()
    const instance = httpAdapter.getInstance() as {
      _router?: { stack?: Array<{ route?: { path?: string } }> }
    }

    const paths = (instance._router?.stack ?? [])
      .map((layer) => layer.route?.path)
      .filter((path): path is string => typeof path === 'string')

    const offenders = paths.filter((path) => path.includes('platform'))

    expect(
      offenders,
      'PlatformModule подключён в AppModule — вход, видящий все заведения, оказался ' +
        'на порту, который обслуживает владельцев ресторанов',
    ).toEqual([])
  })

  it('подключения к базе под ролью платформы в основном API нет', async () => {
    // Провайдер ищем ПО КЛАССУ, а не по строке с именем.
    //
    // Сначала здесь стояло moduleRef.get('PlatformPrismaService') — и это было
    // проверкой пустоты: строковый токен не совпадает с классовым никогда,
    // поэтому get бросал ВСЕГДА, и тест был бы зелёным даже при подключённом
    // модуле. Поймано мутацией: три соседних теста от неё покраснели, а этот
    // остался зелёным — что и выдало его бесполезность.
    //
    // Импорт класса в ТЕСТЕ ничего не связывает: тесты не попадают в сборку
    // приложения. Прежний довод в этом комментарии был просто неверен.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    expect(() => moduleRef.get(PlatformPrismaService, { strict: false })).toThrow()

    await moduleRef.close()
  })
})
