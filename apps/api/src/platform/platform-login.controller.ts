import { Controller, Get, Header } from '@nestjs/common'
import { ApiExcludeEndpoint } from '@nestjs/swagger'

/**
 * Страница входа в админку платформы.
 *
 * ─── ПОЧЕМУ СТРАНИЦУ ОТДАЁТ САМ СЕРВИС, А НЕ ОТДЕЛЬНЫЙ САЙТ ─────────────────
 *
 * Бэк-офис заведения и страница гостя живут на Cloudflare Pages отдельными
 * сборками — им это нужно: у них тысячи посетителей и своя жизнь.
 *
 * У панели платформы посетитель ОДИН. Отдельная сборка означала бы третий
 * проект на Cloudflare, третий адрес, настройку междоменных запросов между
 * ним и этим сервисом, и ещё одно место, куда надо не забыть выложиться.
 * Всё это — ради формы с тремя полями.
 *
 * Отдавая страницу с того же адреса, что и API, мы получаем: ноль настроек
 * междоменных запросов (запрос идёт на свой же origin), один деплой вместо
 * двух и невозможность рассинхрона версий страницы и сервера.
 *
 * ─── ПОЧЕМУ РАЗМЕТКА, СТИЛИ И СКРИПТ РАЗНЫМИ МАРШРУТАМИ ─────────────────────
 *
 * Не из любви к порядку. На процессе стоит helmet, а он выставляет
 * Content-Security-Policy со `script-src 'self'` — то есть встроенный в HTML
 * скрипт браузер выполнять откажется, и форма молча перестанет работать.
 *
 * Отдавая скрипт и стили отдельными файлами с того же адреса, мы укладываемся
 * в политику без единого послабления. Разрешать 'unsafe-inline' ради удобства
 * значило бы ослабить защиту всего процесса ради трёх строк разметки.
 */
@Controller()
export class PlatformLoginController {
  @Get()
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page(): string {
    return PAGE_HTML
  }

  @Get('login.css')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/css; charset=utf-8')
  styles(): string {
    return PAGE_CSS
  }

  @Get('login.js')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  script(): string {
    return PAGE_JS
  }
}

const PAGE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>POSitive Loyalty — платформа</title>
<link rel="stylesheet" href="/login.css">
</head>
<body>
<main class="card" id="card">
  <h1>Платформа</h1>
  <p class="sub">Доступ владельца продукта ко всем заведениям</p>

  <form id="form" autocomplete="on">
    <label>
      <span>Почта</span>
      <input name="email" type="email" autocomplete="username" required inputmode="email">
    </label>

    <label>
      <span>Пароль</span>
      <input name="password" type="password" autocomplete="current-password" required minlength="12">
    </label>

    <label>
      <span>Код из аутентификатора</span>
      <input name="totpCode" inputmode="numeric" autocomplete="one-time-code" required
             maxlength="7" placeholder="123456">
    </label>

    <p class="error" id="error" hidden></p>

    <button type="submit" id="submit">Войти</button>
  </form>

  <p class="note" id="device"></p>
</main>

<script src="/login.js"></script>
</body>
</html>
`

const PAGE_CSS = `:root {
  color-scheme: dark;
  --bg: #0e1013;
  --card: #171a1f;
  --line: #262b33;
  --text: #e8eaed;
  --muted: #8b929d;
  --accent: #6c8cff;
  --error: #ff6b6b;
  --ok: #4ade80;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
}
.card {
  width: 100%;
  max-width: 380px;
  padding: 32px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
}
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; }
.sub { margin: 0 0 24px; color: var(--muted); font-size: 13px; }
label { display: block; margin-bottom: 16px; }
label span { display: block; margin-bottom: 6px; font-size: 13px; color: var(--muted); }
input {
  width: 100%;
  padding: 11px 12px;
  background: #0e1013;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--text);
  font: inherit;
}
input:focus { outline: none; border-color: var(--accent); }
button {
  width: 100%;
  padding: 12px;
  margin-top: 4px;
  background: var(--accent);
  border: 0;
  border-radius: 9px;
  color: #0e1013;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
button:disabled { opacity: .55; cursor: default; }
.error {
  margin: 0 0 16px;
  padding: 10px 12px;
  background: rgba(255,107,107,.1);
  border: 1px solid rgba(255,107,107,.3);
  border-radius: 9px;
  color: var(--error);
  font-size: 13px;
}
.note { margin: 20px 0 0; color: var(--muted); font-size: 12px; }
.done { text-align: center; }
.done .who { margin: 12px 0 4px; font-size: 18px; font-weight: 600; }
.done .badge { color: var(--ok); font-size: 13px; }
`

/**
 * Скрипт страницы. Обычный ES5-совместимый код без сборки: на одну форму
 * тянуть сборщик, зависимости и второй деплой было бы несоразмерно.
 *
 * ИДЕНТИФИКАТОР УСТРОЙСТВА рождается здесь и живёт в localStorage. Он взял на
 * себя роль отменённого IP-allowlist: сервер запоминает первое устройство и
 * дальше пускает только с него. Поэтому терять его нельзя — очистка данных
 * сайта означает вход с «нового» устройства.
 *
 * ТОКЕН ДОСТУПА держим ТОЛЬКО В ПАМЯТИ, как в бэк-офисе заведения: в
 * localStorage его достала бы любая посторонняя вставка на странице.
 */
const PAGE_JS = `(function () {
  var form = document.getElementById('form');
  var errorBox = document.getElementById('error');
  var submit = document.getElementById('submit');
  var device = document.getElementById('device');
  var card = document.getElementById('card');

  var DEVICE_KEY = 'positive.platform.deviceId';

  function deviceId() {
    var saved = null;
    try { saved = localStorage.getItem(DEVICE_KEY); } catch (e) { saved = null; }
    if (saved && saved.length >= 16) return saved;

    var bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    var made = Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');

    try { localStorage.setItem(DEVICE_KEY, made); } catch (e) { /* приватное окно */ }
    return made;
  }

  var id = deviceId();
  device.textContent = 'Устройство: ' + id.slice(0, 8) + '… Сервер запомнит его при первом входе.';

  function fail(text) {
    errorBox.textContent = text;
    errorBox.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Войти';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Проверяем…';

    var data = new FormData(form);
    var body = {
      email: String(data.get('email') || '').trim(),
      password: String(data.get('password') || ''),
      totpCode: String(data.get('totpCode') || '').trim(),
      deviceId: id,
      deviceLabel: navigator.platform || 'Устройство владельца'
    };

    fetch('/v1/platform/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        return { status: response.status, payload: payload };
      });
    }).then(function (result) {
      if (result.status === 200) return welcome(result.payload);

      if (result.status === 400) {
        var fields = (result.payload && result.payload.details && result.payload.details.fields) || [];
        return fail(fields.length
          ? 'Проверьте поля: ' + fields.join(', ')
          : 'Запрос не принят: проверьте заполнение.');
      }

      if (result.status === 401) {
        // Сервер намеренно не говорит, ЧТО именно не сошлось: иначе форма
        // входа превращается в справочник для подбора.
        return fail('Войти не удалось. Проверьте почту, пароль и код — код меняется каждые 30 секунд.');
      }

      if (result.status === 429) return fail('Слишком много попыток. Подождите и попробуйте снова.');

      fail('Сервер ответил ошибкой ' + result.status + '. Попробуйте позже.');
    }).catch(function () {
      fail('Не удалось связаться с сервером. Проверьте соединение.');
    });
  });

  function welcome(session) {
    // Токен доступа — только в памяти этой вкладки.
    window.__platformToken = session.accessToken;

    fetch('/v1/platform/auth/me', {
      headers: { Authorization: 'Bearer ' + session.accessToken }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
      var enrolled = session.deviceEnrolled
        ? '<p class="note">Это устройство запомнено как доверенное. С других входить не получится, пока вы их не разрешите.</p>'
        : '<p class="note">Вход с уже доверенного устройства.</p>';

      card.className = 'card done';
      card.innerHTML =
        '<h1>Вы вошли</h1>' +
        '<p class="who">' + escapeHtml(session.displayName) + '</p>' +
        '<p class="badge">Второй фактор подтверждён</p>' +
        (me ? '<p class="note">' + escapeHtml(me.email) + '</p>' : '') +
        enrolled +
        '<p class="note">Экраны панели — подписки, обороты, партнёрства — появятся следующим шагом. ' +
        'Сейчас проверен сам вход.</p>';
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
})();
`
