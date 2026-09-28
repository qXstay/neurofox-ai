<a href="https://neurofox.art"><img src="docs/cover.jpg" alt="NeuroFox AI: фото, видео, музыка и AI-чат"></a>

**NeuroFox AI** собирает популярные нейросети в одном кабинете. Пользователь пополняет баланс один раз и дальше делает фото, видео, музыку или спрашивает AI-чат, не заводя пять подписок.

<h3 align="center"><a href="https://neurofox.art">Открыть в браузере »</a>&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;<a href="https://t.me/Malinovsky_AI_bot">Бот в Telegram »</a></h3>
<p align="center"><sub>Работающий сервис заказчика, вход по email.</sub></p>

<table>
<tr>
<td width="50%"><img src="docs/01-mobile-home-chat.jpg" alt="Главная и AI-чат"></td>
<td width="50%"><img src="docs/02-mobile-photo-history.jpg" alt="Фото и история"></td>
</tr>
<tr>
<td><img src="docs/03-mobile-video-veo.jpg" alt="Видео"></td>
<td><img src="docs/04-mobile-music.jpg" alt="Музыка"></td>
</tr>
</table>

Под капотом всё, что нужно платному сервису: тарифы и оплата, баланс токенов, стартовые токены новичкам, история генераций и реферальная программа с выплатами. Одинаково удобно с телефона и с компьютера.

<details>
<summary>Для разработчиков</summary>

Здесь несколько файлов, по которым видно подход. Ключей, платежей и данных пользователей в репозитории нет.

- `backend/README.md`: как устроен сервер: модули, API, фоновые задачи, база.
- `backend/financial-policy.mjs`: деньги реферальной программы: начисления, откаты и резервы при выплатах.
- `src/pages/History.tsx`: история генераций: фото, видео и музыка в одной ленте.
- `src/test/generated-result-materialization.test.ts`: проверки, что готовые файлы от нейросетей сохраняются надёжно и без утечки ссылок.

React 18, TypeScript, Vite, Tailwind CSS, Node.js, PostgreSQL, Docker. Полный код закрыт и показывается по запросу.
</details>

Нужен похожий сервис с оплатой и личным кабинетом? Напишите в [Telegram](https://t.me/qxstay).
