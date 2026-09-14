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

/* ── Экран заведений ─────────────────────────────────────────────────────── */

body.panel { display: block; padding: 0; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 28px 24px 64px; }
.top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.top h1 { font-size: 20px; }
.top .me { color: var(--muted); font-size: 13px; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
.tile { padding: 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
.tile .k { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
.tile .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }

.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; background: var(--card); font-size: 14px; }
th, td { padding: 12px 14px; text-align: left; white-space: nowrap; }
th { color: var(--muted); font-weight: 500; font-size: 12px; border-bottom: 1px solid var(--line); }
tbody tr + tr td { border-top: 1px solid var(--line); }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.brand { font-weight: 600; }
.dim { color: var(--muted); font-size: 12px; }

.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--line); }
.pill.ACTIVE { color: var(--ok); border-color: rgba(74,222,128,.35); }
.pill.TRIAL { color: #fbbf24; border-color: rgba(251,191,36,.35); }
.pill.PAUSED, .pill.CHURNED { color: var(--muted); }

.gap { margin: 28px 0 0; padding: 16px 18px; background: rgba(108,140,255,.07);
       border: 1px solid rgba(108,140,255,.25); border-radius: 12px; font-size: 13px; }
.gap h2 { margin: 0 0 8px; font-size: 14px; }
.gap ul { margin: 8px 0 0; padding-left: 20px; color: var(--muted); }
.gap li { margin-bottom: 4px; }

/* ── Жалобы на спам в приглашениях ──────────────────────────────────────── */

.section { margin: 28px 0 6px; font-size: 16px; font-weight: 600; }
.lead { margin: 0 0 12px; max-width: 70ch; }
td.wrap { white-space: normal; min-width: 260px; }
.reasons { margin: 0; padding-left: 18px; }
.reasons li + li { margin-top: 4px; }
.pill.SUSPENDED { color: var(--error); border-color: rgba(255,107,107,.35); }
button.small { width: auto; margin: 0; padding: 7px 12px; font-size: 13px; }
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

    card.className = 'card done';
    card.innerHTML = '<h1>Вы вошли</h1><p class="note">Загружаем заведения…</p>';

    fetch('/v1/platform/tenants', {
      headers: { Authorization: 'Bearer ' + session.accessToken }
    }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    }).then(function (data) {
      renderPanel(session, data);
      loadComplaints();
    }).catch(function () {
      card.innerHTML =
        '<h1>Вы вошли</h1>' +
        '<p class="who">' + escapeHtml(session.displayName) + '</p>' +
        '<p class="note">Заведения загрузить не удалось. Обновите страницу.</p>';
    });
  }

  /** Деньги в базе — целые сатанги. Делим только на выводе (железное правило 4). */
  function money(satang) {
    return (satang / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ฿';
  }

  function whenAgo(iso) {
    if (!iso) return '—';
    var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'сегодня';
    if (days === 1) return 'вчера';
    if (days < 30) return days + ' дн. назад';
    return Math.floor(days / 30) + ' мес. назад';
  }

  function renderPanel(session, data) {
    document.body.className = 'panel';

    var rows = data.tenants.map(function (t) {
      return '<tr>' +
        '<td><div class="brand">' + escapeHtml(t.brandName) + '</div>' +
            '<div class="dim">' + escapeHtml(t.vertical) + '</div></td>' +
        '<td><span class="pill ' + escapeHtml(t.status) + '">' + escapeHtml(t.status) + '</span>' +
            (t.seasonMode ? ' <span class="dim">низкий сезон</span>' : '') + '</td>' +
        '<td>' + escapeHtml(t.plan) + '</td>' +
        '<td class="num">' + t.guests + '</td>' +
        '<td class="num">' + money(t.spentTotal) + '</td>' +
        '<td class="num">' + t.pointsOutstanding.toLocaleString('ru-RU') + '</td>' +
        '<td class="num">' + t.operations30d + '</td>' +
        '<td class="dim">' + whenAgo(t.lastVisitAt) + '</td>' +
      '</tr>';
    }).join('');

    var empty = '<tr><td colspan="8" class="dim">Заведений пока нет.</td></tr>';

    document.body.innerHTML =
      '<div class="wrap">' +
        '<div class="top">' +
          '<h1>Заведения</h1>' +
          '<div class="me">' + escapeHtml(session.displayName) + '</div>' +
        '</div>' +

        '<div class="tiles">' +
          tile('Заведений', data.totals.tenants) +
          tile('Платящих', data.totals.paying) +
          tile('В пробном периоде', data.totals.trial) +
          tile('Гостей всего', data.totals.guests) +
          tile('Оборот по программе', money(data.totals.spentTotal)) +
        '</div>' +

        '<section id="complaints"></section>' +

        '<div class="scroll"><table>' +
          '<thead><tr>' +
            '<th>Заведение</th><th>Статус</th><th>Тариф</th>' +
            '<th class="num">Гостей</th><th class="num">Оборот</th>' +
            '<th class="num">Баллов на руках</th><th class="num">Операций за 30 дней</th>' +
            '<th>Активность</th>' +
          '</tr></thead>' +
          '<tbody>' + (rows || empty) + '</tbody>' +
        '</table></div>' +

        '<div class="gap">' +
          '<h2>Чего здесь ещё нет — и почему</h2>' +
          'Не забыто: одних таблиц в базе пока нет, у других нет экранов, а показывать ' +
          'выдуманные числа в панели, по которой принимают решения, нельзя.' +
          '<ul>' +
            '<li><b>Подписки и платежи.</b> Видны тариф и статус, но истории ' +
              'платежей, цены и даты следующего списания взять неоткуда.</li>' +
            '<li><b>Партнёрства и акции.</b> Таблицы есть, экранов здесь пока нет — ' +
              'кроме жалоб на спам в приглашениях.</li>' +
          '</ul>' +
        '</div>' +
      '</div>';
  }

  /**
   * Жалобы на спам в приглашениях (docs/07, раздел 6.2). Секция появляется,
   * только когда есть что разбирать: пустой заголовок на главном экране — шум.
   * Кнопки вешаются слушателями, а не onclick в разметке: CSP процесса
   * встроенные обработчики не выполнит.
   */
  function loadComplaints() {
    var box = document.getElementById('complaints');
    if (!box) return;

    fetch('/v1/platform/invite-complaints', {
      headers: { Authorization: 'Bearer ' + window.__platformToken }
    }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    }).then(function (data) {
      renderComplaints(box, data);
    }).catch(function () {
      box.innerHTML = '<p class="dim">Жалобы на спам загрузить не удалось. Обновите страницу.</p>';
    });
  }

  function renderComplaints(box, data) {
    if (!data.items.length) {
      box.innerHTML = '';
      return;
    }

    var rows = data.items.map(function (item) {
      var from = item.complaints.map(function (c) {
        return '<li><b>' + escapeHtml(c.fromBrandName) + '</b>' +
          (c.reason ? ': ' + escapeHtml(c.reason) : '') +
          ' <span class="dim">' + whenAgo(c.createdAt) + '</span></li>';
      }).join('');

      return '<tr>' +
        '<td><div class="brand">' + escapeHtml(item.brandName) + '</div>' +
          (item.suspended ? '<span class="pill SUSPENDED">приглашения приостановлены</span>' : '') +
        '</td>' +
        '<td class="num">' + item.openComplaints + ' из ' + data.suspendAfter + '</td>' +
        '<td class="wrap"><ul class="reasons">' + from + '</ul></td>' +
        '<td><button type="button" class="small" data-review="' + escapeHtml(item.tenantId) + '">Разобрано</button></td>' +
      '</tr>';
    }).join('');

    box.innerHTML =
      '<h2 class="section">Жалобы на спам в приглашениях</h2>' +
      '<p class="dim lead">' + data.suspendAfter + ' жалоб от разных заведений приостанавливают приглашения. ' +
        '«Разобрано» снимает приостановку; продолжит спамить — новые жалобы приостановят снова.</p>' +
      '<div class="scroll"><table>' +
        '<thead><tr><th>На кого</th><th class="num">Жалоб</th><th>От кого и почему</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>';

    Array.prototype.forEach.call(box.querySelectorAll('button[data-review]'), function (button) {
      button.addEventListener('click', function () {
        button.disabled = true;
        button.textContent = 'Отмечаем…';

        fetch('/v1/platform/invite-complaints/' + encodeURIComponent(button.getAttribute('data-review')) + '/review', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + window.__platformToken }
        }).then(function (r) {
          if (!r.ok) throw new Error('status ' + r.status);
          loadComplaints();
        }).catch(function () {
          button.disabled = false;
          button.textContent = 'Не вышло — ещё раз';
        });
      });
    });
  }

  function tile(label, value) {
    return '<div class="tile"><div class="k">' + escapeHtml(label) + '</div>' +
           '<div class="v">' + escapeHtml(String(value)) + '</div></div>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
})();
`
